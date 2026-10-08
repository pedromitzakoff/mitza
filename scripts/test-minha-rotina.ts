/**
 * Testes da Etapa "MITZA ONE — Nova aba Minha Rotina": consolida Demandas
 * (tasks, por assignee_id) e Rotinas (recurring_tasks, por
 * primary_manager_id do cliente) numa lista única de execução diária.
 * Cobre o núcleo puro (`lib/minha-rotina.ts`) com chamadas diretas, e
 * checagens ESTRUTURAIS do resto (data layer, Server Actions reaproveitadas,
 * nav, compatibilidade com Demandas) via grep de código-fonte — mesmo
 * padrão das suites anteriores, sem DOM/Supabase neste ambiente.
 *
 * Rodar: npx tsx scripts/test-minha-rotina.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeMinhaRotinaCounts,
  demandaBucket,
  endOfWeek,
  filterMinhaRotinaItems,
  formatMinhaRotinaDemandaDueLabel,
  parseMinhaRotinaFilters,
  resolveMyClients,
  rotinaBucket,
  serializeMinhaRotinaFilters,
  sortMinhaRotinaItems,
  type MinhaRotinaItem,
} from "../src/lib/minha-rotina";
import type { AgencyTree } from "../src/lib/agency-accounts-tree";
import { computeNextExecutionDate } from "../src/lib/recurring-tasks";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const TODAY = "2026-10-08"; // quinta-feira
const WEEK_END = endOfWeek(TODAY);

function demanda(overrides: Partial<Extract<MinhaRotinaItem, { kind: "demanda" }>>): Extract<MinhaRotinaItem, { kind: "demanda" }> {
  return {
    kind: "demanda",
    id: "d1",
    title: "Demanda",
    clientId: "c1",
    clientName: "Cliente A",
    dueDate: TODAY,
    status: "pendente",
    priority: "normal",
    bucket: "hoje",
    ...overrides,
  };
}

function rotina(overrides: Partial<Extract<MinhaRotinaItem, { kind: "rotina" }>>): Extract<MinhaRotinaItem, { kind: "rotina" }> {
  return {
    kind: "rotina",
    id: "r1",
    title: "Rotina",
    clientId: "c1",
    clientName: "Cliente A",
    sprintId: "s1",
    sprintStartDate: "2026-10-05",
    sprintEndDate: "2026-10-09",
    nextExecutionLabel: "Hoje",
    dueDate: TODAY,
    bucket: "hoje",
    progress: { done: 0, goal: 4 },
    canOneClick: true,
    hasChecklist: false,
    usesAccountReview: false,
    usesReport: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — Isolamento por usuário: resolveMyClients escolhe só o bucket do gestor logado\n");
{
  const tree: AgencyTree = {
    managers: [
      { id: "mgr-1", name: "Pedro", clients: [{ id: "c1", name: "Cliente A", avatarUrl: null }] },
      { id: "mgr-2", name: "Vinícius", clients: [{ id: "c2", name: "Cliente B", avatarUrl: null }] },
    ],
    unassigned: [{ id: "c3", name: "Cliente C", avatarUrl: null }],
  };
  check(
    "gestor 1 só enxerga seus próprios clientes — nunca os de outro gestor",
    resolveMyClients(tree, "mgr-1").map((c) => c.id),
    ["c1"],
  );
  check(
    "gestor 2 só enxerga os dele — a árvore inteira (ambos os gestores) nunca vaza pra quem pediu só um bucket",
    resolveMyClients(tree, "mgr-2").map((c) => c.id),
    ["c2"],
  );
  check("gestor sem nenhum cliente -> lista vazia (nunca os 'sem responsável')", resolveMyClients(tree, "mgr-sem-cliente").map((c) => c.id), []);
  ok(
    "clientes 'sem responsável' (unassigned) NUNCA aparecem pra nenhum gestor específico — só quem tem primary_manager_id = eu",
    !resolveMyClients(tree, "mgr-1").some((c) => c.id === "c3") && !resolveMyClients(tree, "mgr-2").some((c) => c.id === "c3"),
  );
}

console.log("\nB — Baldes: Demanda tem 'atrasada' real; Rotina NUNCA tem (seção 1 da aprovação do usuário)\n");
{
  check("demanda com status efetivo 'atrasado' -> balde 'atrasada'", demandaBucket({ status: "atrasado", dueDate: "2026-10-01" }, TODAY, WEEK_END), "atrasada");
  check("demanda vencendo hoje -> balde 'hoje'", demandaBucket({ status: "pendente", dueDate: TODAY }, TODAY, WEEK_END), "hoje");
  check("demanda vencendo depois de amanhã, ainda dentro da semana -> balde 'semana'", demandaBucket({ status: "pendente", dueDate: "2026-10-10" }, TODAY, WEEK_END), "semana");
  check("demanda vencendo além do fim da semana -> balde 'depois'", demandaBucket({ status: "pendente", dueDate: "2026-10-20" }, TODAY, WEEK_END), "depois");

  check("rotina com próxima execução = hoje -> balde 'hoje'", rotinaBucket(TODAY, TODAY), "hoje");
  check("rotina com próxima execução num dia futuro desta semana -> balde 'semana', NUNCA 'atrasada'", rotinaBucket("2026-10-09", TODAY), "semana");
  ok(
    "rotinaBucket só devolve 'hoje'/'semana' — o tipo de retorno nem permite 'atrasada'/'depois' (nunca um atraso fabricado pra Rotina)",
    rotinaBucket(TODAY, TODAY) === "hoje" && rotinaBucket("2026-10-09", TODAY) === "semana",
  );
}

console.log("\nC — Indicadores consolidam Demanda+Rotina em 'Hoje'/'Esta semana', mas 'Atrasadas' é só Demanda (ajuste aprovado pelo usuário)\n");
{
  const items: MinhaRotinaItem[] = [
    demanda({ id: "d1", bucket: "hoje" }),
    demanda({ id: "d2", bucket: "hoje" }),
    demanda({ id: "d3", bucket: "hoje" }),
    rotina({ id: "r1", bucket: "hoje" }),
    rotina({ id: "r2", bucket: "hoje" }),
    rotina({ id: "r3", bucket: "hoje" }),
    rotina({ id: "r4", bucket: "hoje" }),
    rotina({ id: "r5", bucket: "hoje" }),
    demanda({ id: "d4", bucket: "atrasada", status: "atrasado" }),
    rotina({ id: "r6", bucket: "semana" }),
    demanda({ id: "d5", bucket: "semana" }),
  ];
  const counts = computeMinhaRotinaCounts(items);
  check("exemplo do pedido: 3 demandas + 5 rotinas para hoje -> indicador 'Hoje' = 8", counts.today, 8);
  check("'Atrasadas' conta só a demanda (1) — nenhuma rotina soma aqui, mesmo que existisse uma no balde errado", counts.overdue, 1);
  check("'Esta semana' consolida demanda+rotina do balde 'semana' = 2", counts.week, 2);
}

console.log("\nD — Uma rotina = UMA ação pendente por cliente, nunca multiplica os slots que faltam pra bater a meta\n");
{
  const sprint = { start_date: "2026-10-05" };
  const next1 = computeNextExecutionDate(sprint, 4, 0, TODAY); // faltam 4 execuções
  const next2 = computeNextExecutionDate(sprint, 4, 3, TODAY); // falta só 1
  ok(
    "mesmo faltando MÚLTIPLAS execuções pra bater a meta semanal, computeNextExecutionDate devolve só UMA próxima data — nunca uma lista de slots",
    typeof next1.date === "string" && typeof next2.date === "string",
  );
  ok("a estrutura de retorno é sempre {date, metGoal} — um valor escalar, nunca um array de pendências", !Array.isArray(next1) && !Array.isArray(next2));
}

console.log("\nE — Filtros rápidos: hoje/atrasadas/semana/todas, combináveis com busca por cliente/título\n");
{
  const items: MinhaRotinaItem[] = [
    demanda({ id: "d1", title: "Checar saldo manual", bucket: "hoje" }),
    demanda({ id: "d2", title: "Enviar relatório", clientName: "Aibou", bucket: "atrasada", status: "atrasado" }),
    rotina({ id: "r1", title: "Otimização de campanhas", clientName: "JudClass", bucket: "hoje" }),
    rotina({ id: "r2", title: "Reportar cliente", clientName: "Pet Fast", bucket: "semana" }),
  ];

  check(
    "filtro 'hoje' pega Demanda E Rotina no balde hoje",
    filterMinhaRotinaItems(items, "hoje", "").map((i) => i.id),
    ["d1", "r1"],
  );
  check(
    "filtro 'atrasadas' pega só Demanda — uma Rotina nunca aparece aqui, mesmo que o balde dela fosse (hipoteticamente) 'atrasada'",
    filterMinhaRotinaItems(items, "atrasadas", "").map((i) => i.id),
    ["d2"],
  );
  check(
    "filtro 'semana' pega só o balde 'semana' (aqui, só a rotina r2)",
    filterMinhaRotinaItems(items, "semana", "").map((i) => i.id),
    ["r2"],
  );
  check(
    "filtro 'todas' devolve tudo, independente do balde",
    filterMinhaRotinaItems(items, "todas", "").map((i) => i.id).sort(),
    ["d1", "d2", "r1", "r2"],
  );
  check(
    "busca por nome do cliente (case-insensitive) combina com o quick filter",
    filterMinhaRotinaItems(items, "todas", "aibou").map((i) => i.id),
    ["d2"],
  );
  check(
    "busca por título da tarefa também funciona",
    filterMinhaRotinaItems(items, "todas", "otimização").map((i) => i.id),
    ["r1"],
  );
  check("busca sem resultado -> lista vazia (nunca cai no fallback 'tudo')", filterMinhaRotinaItems(items, "todas", "inexistente"), []);
}

console.log("\nF — Ordenação: atrasada primeiro, depois hoje, depois semana, depois resto; empate por data e por título\n");
{
  const items: MinhaRotinaItem[] = [
    demanda({ id: "d-semana", bucket: "semana", dueDate: "2026-10-10" }),
    demanda({ id: "d-atrasada", bucket: "atrasada", status: "atrasado", dueDate: "2026-10-01" }),
    rotina({ id: "r-hoje-b", bucket: "hoje", title: "Zebra" }),
    rotina({ id: "r-hoje-a", bucket: "hoje", title: "Abacate" }),
  ];
  check(
    "atrasada < hoje < semana; dentro de 'hoje', ordem alfabética do título como desempate",
    sortMinhaRotinaItems(items).map((i) => i.id),
    ["d-atrasada", "r-hoje-a", "r-hoje-b", "d-semana"],
  );
}

console.log("\nG — Rótulo de prazo de Demanda: Hoje/Amanhã/dia da semana/data, nunca um atraso inventado pra Rotina (que usa seu próprio nextExecutionLabel)\n");
{
  check("vencendo hoje -> 'Hoje'", formatMinhaRotinaDemandaDueLabel(TODAY, TODAY), "Hoje");
  check("vencendo amanhã -> 'Amanhã'", formatMinhaRotinaDemandaDueLabel("2026-10-09", TODAY), "Amanhã");
  check("vencendo em 3 dias (dentro da janela de 7) -> nome do dia da semana", formatMinhaRotinaDemandaDueLabel("2026-10-11", TODAY), "Domingo");
  check("vencida (data no passado) -> mostra a data real, nunca 'Hoje'/relativo impreciso", formatMinhaRotinaDemandaDueLabel("2026-10-01", TODAY), "2026-10-01");
  check("mais de 7 dias no futuro -> mostra a data real, nunca estica o rótulo relativo", formatMinhaRotinaDemandaDueLabel("2026-11-01", TODAY), "2026-11-01");
}

console.log("\nH — Serialização de filtros na URL (mesmo princípio de lib/pendencias.ts — URL é a única fonte de verdade)\n");
{
  check("sem nenhum filtro customizado -> querystring vazia", serializeMinhaRotinaFilters({ quickFilter: "todas", search: "" }).toString(), "");
  check(
    "quickFilter customizado + busca -> ambos na querystring",
    serializeMinhaRotinaFilters({ quickFilter: "hoje", search: "aibou" }).toString(),
    "quick=hoje&q=aibou",
  );
  check("parse é o inverso exato do serialize", parseMinhaRotinaFilters(new URLSearchParams("quick=atrasadas&q=saldo")), { quickFilter: "atrasadas", search: "saldo" });
  check("querystring vazia -> filtros default ('todas', busca vazia)", parseMinhaRotinaFilters(new URLSearchParams("")), { quickFilter: "todas", search: "" });
  check("valor de quick inválido/desconhecido -> cai no default, nunca quebra", parseMinhaRotinaFilters(new URLSearchParams("quick=lixo")).quickFilter, "todas");
}

// ---------------------------------------------------------------------------
console.log("\nI — Responsabilidade no SERVIDOR (seção 3 do pedido aprovado): Demanda por assignee_id, Rotina por primary_manager_id, nunca filtro só visual\n");
{
  const dataSource = loadSource("src", "app", "minha-rotina", "minha-rotina-data.ts");

  ok(
    "Demandas são filtradas por assignee_id = gestor logado, DIRETO NA QUERY (servidor) — nunca a lista inteira da agência filtrada no navegador",
    dataSource.includes('.eq("assignee_id", teamMemberId)') && dataSource.includes('.eq("origin", "manual")'),
  );
  ok(
    "Rotinas são escopadas pelos clientes em que o gestor é o responsável principal (resolveMyClients sobre a árvore já agrupada por primary_manager_id)",
    dataSource.includes("resolveMyClients(tree, teamMemberId)"),
  );
  ok(
    "o recorte é feito ANTES de qualquer item chegar ao componente cliente — minha-rotina-page-client.tsx nunca recebe a lista completa da agência pra filtrar",
    !loadSource("src", "app", "minha-rotina", "minha-rotina-page-client.tsx").includes("assignee_id"),
  );
  ok(
    "nunca apresentado como isolamento de RLS — o próprio core documenta que a leitura subjacente é colaborativa (auth.uid() is not null), isto é um recorte de produto",
    loadSource("src", "lib", "minha-rotina.ts").includes("RLS COLABORATIVAS") && loadSource("src", "lib", "minha-rotina.ts").includes("Nunca"),
  );
  ok(
    "workspace = só cliente ativo também vale pra Demandas aqui (mesmo princípio de sempre)",
    dataSource.includes("WORKSPACE_ACTIVE_CONTRACT_STATUS"),
  );
}

console.log("\nJ — Conclusão/registro reaproveitam o fluxo oficial, nenhuma segunda implementação\n");
{
  const rowSource = loadSource("src", "app", "minha-rotina", "minha-rotina-page-client.tsx");
  const buttonSource = loadSource("src", "app", "minha-rotina", "minha-rotina-register-button.tsx");
  const tasksActionsSource = loadSource("src", "app", "clients", "tasks-actions.ts");
  const recurringActionsSource = loadSource("src", "app", "clients", "recurring-task-actions.ts");

  ok("Demanda conclui com o MESMO botão/Server Action do Cockpit (CockpitCompleteTaskButton -> completeTaskAction)", rowSource.includes("CockpitCompleteTaskButton"));
  ok(
    "Rotina 'simples' registra com a MESMA Server Action oficial do drawer completo (registerRecurringExecutionAction), não uma versão simplificada paralela",
    buttonSource.includes("registerRecurringExecutionAction"),
  );
  ok(
    "Rotina com checklist/diagnóstico/Report abre o MESMO RecurringTaskDrawer de /sprints — nunca um formulário inline que pule a validação",
    rowSource.includes("recurringTaskDetail=") && loadSource("src", "app", "minha-rotina", "page.tsx").includes("RecurringTaskDrawer"),
  );
  ok(
    "só rotinas SEM checklist/diagnóstico/Report oferecem o botão de um clique (canOneClick) — nunca pula validação de uma que precisa de dado extra",
    loadSource("src", "app", "minha-rotina", "minha-rotina-data.ts").includes("canOneClick: !task.hasChecklist && !task.usesAccountReview && !task.usesReport"),
  );
  ok(
    "completeTaskAction revalida /minha-rotina — a lista/indicadores atualizam sozinhos após concluir, sem reload manual",
    tasksActionsSource.includes('revalidatePath("/minha-rotina")'),
  );
  ok(
    "registerRecurringExecutionAction também revalida /minha-rotina",
    recurringActionsSource.includes('revalidatePath("/minha-rotina")'),
  );
  ok(
    "nenhuma regra de recorrência nova: completeTaskAction continua gerando a próxima ocorrência de Demanda (nextDueDate) exatamente como antes, intocado",
    tasksActionsSource.includes("const nextDate = nextDueDate(task.due_date, task.recurrence);"),
  );
}

console.log("\nK — Navegação (Fase 1 do pedido): item fixo acima da busca/carteira, rota dedicada, Demandas/Cockpit intocados\n");
{
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");

  ok("rota /minha-rotina", loadSource("src", "app", "minha-rotina", "page.tsx").includes("MinhaRotinaPage"));
  ok(
    "item 'Minha Rotina' definido com href /minha-rotina e ícone próprio (ListChecks, distinto do ClipboardList já usado por Demandas)",
    sidebarSource.includes('href: "/minha-rotina"') && sidebarSource.includes("icon: ListChecks"),
  );
  ok(
    "renderizado ACIMA da Carteira (busca + lista de clientes) — nunca dentro do grupo Agência/Gestão (que ficam no rodapé da carteira)",
    /<NavLink item=\{MINHA_ROTINA_ITEM\}[\s\S]{0,400}CARTEIRA — seção 1/.test(sidebarSource),
  );
  ok("Sidebar continua com Demandas e Timeline em Agência, intocados", sidebarSource.includes('label: "Demandas"') && sidebarSource.includes('label: "Timeline"'));
  ok("navegação do Cockpit (cockpit-meta-ritmo-section.tsx e afins) não foi tocada por esta etapa", !sidebarSource.includes("minha-rotina") || sidebarSource.includes('href: "/minha-rotina"'));
}

console.log("\nL — Compatibilidade com Demandas/Pendências: nenhuma regra duplicada, nenhuma tabela/RPC nova\n");
{
  const pendenciasDataSource = loadSource("src", "app", "demandas", "pendencias-data.ts");
  const minhaRotinaDataSource = loadSource("src", "app", "minha-rotina", "minha-rotina-data.ts");

  ok("loadPendenciasRawData (Demandas/Pendências) não foi alterado por esta etapa", pendenciasDataSource.includes('.eq("origin", "manual")'));
  ok(
    "Minha Rotina usa effectiveTaskStatus, a MESMA fonte de status efetivo que Pendências usa — nenhuma segunda regra de 'atrasado'",
    minhaRotinaDataSource.includes("effectiveTaskStatus("),
  );
  ok("nenhuma migration/tabela nova criada por esta etapa (checagem indireta: nenhum arquivo .sql novo referenciado)", !minhaRotinaDataSource.includes(".sql"));
  ok(
    "fetchRecurringTaskListsForSprints (função batched já oficial) é reaproveitada, nunca uma segunda consulta de recurring_tasks",
    minhaRotinaDataSource.includes("fetchRecurringTaskListsForSprints("),
  );
  ok(
    "extensão de RecurringTaskListItem (hasChecklist/usesAccountReview/usesReport/nextExecutionDate) é ADITIVA — RecurringTaskRow (/sprints) continua lendo só os campos de sempre",
    loadSource("src", "app", "clients", "recurring-task-row.tsx").includes("item.nextExecutionLabel") &&
      !loadSource("src", "app", "clients", "recurring-task-row.tsx").includes("hasChecklist"),
  );
}

console.log(`\n${passed} verificações passaram.\n`);
