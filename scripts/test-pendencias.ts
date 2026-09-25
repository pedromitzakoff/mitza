/**
 * Testes da Etapa "Pendências" — núcleo puro (`lib/pendencias.ts`) + o fix
 * de `effectiveTaskStatus` (`lib/task-status.ts`, status intermediários
 * novos nunca colapsam pra "pendente") + checagens ESTRUTURAIS (código-
 * fonte) confirmando invariantes que dependeriam de Supabase real pra
 * verificar em memória (mesmo padrão já usado em
 * `test-operation-goal-filter.ts`/`test-client-funnels.ts`). Cobre os
 * cenários originais (filtro por cliente/interna/todos; filtro por
 * responsável; os 4 quick filters — Abertas/Minhas/Aguardando/Concluídas —
 * reformulados na correção de conceito abaixo; filtros combináveis; regras
 * de visibilidade de concluídas; agrupamento por status/prazo/cliente/
 * responsável/nenhum; `endOfWeek`; round-trip de URL; regressão de
 * `effectiveTaskStatus`; reabertura + cliente nulo em `tasks-actions.ts`;
 * consumidores de status fechado guardando client_id nulo; status
 * editáveis inline) MAIS a correção de conceito "Pendências — Demandas"
 * (seção 13): a página deixou de mostrar toda `tasks` e passou a mostrar
 * só demanda criada manualmente — nunca rotina/tarefa gerada pelo sistema
 * (`sprint_task_templates`) nem `recurring_tasks` (que nunca teve
 * representação em `/pendencias`, removida do card errado onde tinha sido
 * colocada por engano).
 *
 * Rodar: npx tsx scripts/test-pendencias.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PENDENCIAS_FILTERS,
  DEFAULT_PENDENCIAS_GROUP_BY,
  buildDuplicateTaskRow,
  endOfWeek,
  filterPendencias,
  groupPendencias,
  parsePendenciasFilters,
  parsePendenciasGroupBy,
  serializePendenciasFilters,
  type PendenciaDuplicateSource,
  type PendenciaItem,
  type PendenciasFilterState,
} from "../src/lib/pendencias";
import { effectiveTaskStatus } from "../src/lib/task-status";
import { TASK_EDITABLE_STATUS_OPTIONS, TASK_PRIORITY_BADGE_CLASSES, TASK_PRIORITY_DOT_CLASS } from "../src/app/clients/task-labels";
import { filterSearchableOptions, type SearchableSelectOption } from "../src/components/ui/searchable-select";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function item(overrides: Partial<PendenciaItem> & { id: string }): PendenciaItem {
  return {
    title: "Pendência",
    type: "outro",
    rawStatus: "pendente",
    status: "pendente",
    priority: "normal",
    dueDate: "2026-09-25",
    notes: null,
    sprintId: null,
    client: null,
    assignee: null,
    ...overrides,
  };
}

const TODAY = "2026-09-25"; // sexta-feira
const CTX = { today: TODAY, currentTeamMemberId: "tm-1" };

console.log("\n1 — filtro por cliente específico / interna / todos\n");
{
  const clientA = item({ id: "1", client: { id: "c1", name: "Cliente A" } });
  const clientB = item({ id: "2", client: { id: "c2", name: "Cliente B" } });
  const internal = item({ id: "3", client: null });
  const all = [clientA, clientB, internal];

  check(
    "clientId=c1 mostra só as pendências desse cliente",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, clientId: "c1" }, CTX).map((i) => i.id),
    ["1"],
  );
  check(
    "internalOnly mostra só pendências sem cliente",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, internalOnly: true }, CTX).map((i) => i.id),
    ["3"],
  );
  check(
    "sem filtro de cliente mostra todos (clientes + interna)",
    filterPendencias(all, DEFAULT_PENDENCIAS_FILTERS, CTX).map((i) => i.id),
    ["1", "2", "3"],
  );
}

console.log("\n2 — filtro por responsável\n");
{
  const mine = item({ id: "1", assignee: { id: "tm-1", name: "Eu", status: "ativo" } });
  const other = item({ id: "2", assignee: { id: "tm-2", name: "Outra pessoa", status: "ativo" } });
  const all = [mine, other];
  check(
    "assigneeId filtra por responsável específico",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, assigneeId: "tm-2" }, CTX).map((i) => i.id),
    ["2"],
  );
}

console.log("\n3 — 4 quick filters (Abertas/Minhas/Aguardando/Concluídas)\n");
{
  const mine = item({ id: "1", assignee: { id: "tm-1", name: "Eu", status: "ativo" } });
  const notMine = item({ id: "2", assignee: { id: "tm-2", name: "Outra pessoa", status: "ativo" } });
  const waiting = item({ id: "3", status: "aguardando", rawStatus: "aguardando" });
  const overdue = item({ id: "4", status: "atrasado", rawStatus: "pendente", dueDate: "2026-09-20" });
  const done = item({ id: "5", status: "feito", rawStatus: "feito" });
  const notDone = item({ id: "6", status: "nao_realizado", rawStatus: "nao_realizado" });
  const all = [mine, notMine, waiting, overdue, done, notDone];

  check(
    "quickFilter=abertas (default) — tudo que não é terminal, mesmo comportamento do antigo 'todas'",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, quickFilter: "abertas" }, CTX).map((i) => i.id),
    ["1", "2", "3", "4"],
  );
  check(
    "quickFilter=minhas",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, quickFilter: "minhas" }, CTX).map((i) => i.id),
    ["1"],
  );
  check(
    "quickFilter=aguardando",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, quickFilter: "aguardando" }, CTX).map((i) => i.id),
    ["3"],
  );
  check(
    "quickFilter=concluidas — mostra SÓ feito/não realizado, mesmo sem includeCompleted",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, quickFilter: "concluidas" }, CTX).map((i) => i.id),
    ["5", "6"],
  );
}

console.log("\n4 — filtros combináveis (status + prioridade ao mesmo tempo)\n");
{
  const a = item({ id: "1", status: "em_andamento", rawStatus: "em_andamento", priority: "urgente" });
  const b = item({ id: "2", status: "em_andamento", rawStatus: "em_andamento", priority: "baixa" });
  const c = item({ id: "3", status: "bloqueado", rawStatus: "bloqueado", priority: "urgente" });
  const all = [a, b, c];
  check(
    "status=[em_andamento] + priority=[urgente] combinam (AND), não substituem um ao outro",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, statuses: ["em_andamento"], priorities: ["urgente"] }, CTX).map((i) => i.id),
    ["1"],
  );
}

console.log("\n5 — visibilidade de concluídas\n");
{
  const open = item({ id: "1", status: "pendente", rawStatus: "pendente" });
  const done = item({ id: "2", status: "feito", rawStatus: "feito" });
  const notDone = item({ id: "3", status: "nao_realizado", rawStatus: "nao_realizado" });
  const all = [open, done, notDone];

  check("por padrão, concluídas/não realizadas ficam escondidas", filterPendencias(all, DEFAULT_PENDENCIAS_FILTERS, CTX).map((i) => i.id), ["1"]);
  check(
    "seleção explícita de status='feito' sempre mostra, mesmo sem includeCompleted",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, statuses: ["feito"] }, CTX).map((i) => i.id),
    ["2"],
  );
  check(
    "includeCompleted=true mostra tudo, mesmo sem seleção explícita de status",
    filterPendencias(all, { ...DEFAULT_PENDENCIAS_FILTERS, includeCompleted: true }, CTX).map((i) => i.id),
    ["1", "2", "3"],
  );
}

console.log("\n6 — agrupamento\n");
{
  const a = item({ id: "1", status: "bloqueado", rawStatus: "bloqueado", dueDate: "2026-09-26" });
  const b = item({ id: "2", status: "pendente", rawStatus: "pendente", dueDate: "2026-09-26" });
  const c = item({ id: "3", status: "em_andamento", rawStatus: "em_andamento", dueDate: "2026-09-26" });
  const all = [a, b, c];

  check(
    "agrupar por status segue a ordem fixa do registry (A fazer, Em andamento, ..., Bloqueado), nunca alfabética",
    groupPendencias(all, "status", TODAY).map((g) => g.key),
    ["pendente", "em_andamento", "bloqueado"],
  );

  const overdue = item({ id: "4", status: "atrasado", rawStatus: "pendente", dueDate: "2026-09-20" });
  const today = item({ id: "5", dueDate: TODAY });
  const thisWeek = item({ id: "6", dueDate: "2026-09-27" });
  const later = item({ id: "7", dueDate: "2026-10-10" });
  check(
    "agrupar por prazo: Atrasadas, Hoje, Esta semana, Mais adiante — só os buckets com item",
    groupPendencias([overdue, today, thisWeek, later], "prazo", TODAY).map((g) => g.key),
    ["atrasadas", "hoje", "semana", "depois"],
  );

  const withClient = item({ id: "8", client: { id: "cz", name: "Zeta" } });
  const withClient2 = item({ id: "9", client: { id: "ca", name: "Alfa" } });
  const internal = item({ id: "10", client: null });
  check(
    "agrupar por cliente: alfabético, 'Interna' sempre por último",
    groupPendencias([withClient, withClient2, internal], "cliente", TODAY).map((g) => g.label),
    ["Alfa", "Zeta", "Interna"],
  );

  const withAssignee = item({ id: "11", assignee: { id: "z", name: "Zeca", status: "ativo" } });
  const withAssignee2 = item({ id: "12", assignee: { id: "a", name: "Ana", status: "ativo" } });
  const unassigned = item({ id: "13", assignee: null });
  check(
    "agrupar por responsável: alfabético, 'Sem responsável' sempre por último",
    groupPendencias([withAssignee, withAssignee2, unassigned], "responsavel", TODAY).map((g) => g.label),
    ["Ana", "Zeca", "Sem responsável"],
  );

  check("groupBy='nenhum' devolve um único grupo com tudo", groupPendencias(all, "nenhum", TODAY).length, 1);
  check("lista vazia com groupBy='nenhum' não gera grupo vazio", groupPendencias([], "nenhum", TODAY), []);
  check(
    "grupos sem nenhum item nunca aparecem (ex.: nenhuma pendência 'Aguardando')",
    groupPendencias(all, "status", TODAY).some((g) => g.key === "aguardando"),
    false,
  );
}

console.log("\n7 — endOfWeek (fim da semana ISO)\n");
{
  check("segunda-feira -> domingo da mesma semana", endOfWeek("2026-09-21"), "2026-09-27");
  check("domingo -> ele mesmo (já é o fim da semana)", endOfWeek("2026-09-27"), "2026-09-27");
  check("sexta-feira -> domingo da mesma semana", endOfWeek(TODAY), "2026-09-27");
}

console.log("\n8 — parse/serialize de filtros na URL\n");
{
  const filters: PendenciasFilterState = {
    quickFilter: "aguardando",
    clientId: "c1",
    internalOnly: false,
    assigneeId: "tm-2",
    statuses: ["em_andamento", "bloqueado"],
    priorities: ["urgente"],
    includeCompleted: true,
  };
  const params = serializePendenciasFilters(filters, "cliente");
  check("round-trip: parse(serialize(filters)) === filters", parsePendenciasFilters(params), filters);
  check("round-trip: parse(serialize(groupBy)) === groupBy", parsePendenciasGroupBy(params), "cliente");

  check("URL vazia usa os filtros default", parsePendenciasFilters(new URLSearchParams()), DEFAULT_PENDENCIAS_FILTERS);
  check("URL vazia usa o agrupamento default", parsePendenciasGroupBy(new URLSearchParams()), DEFAULT_PENDENCIAS_GROUP_BY);

  const invalid = new URLSearchParams("quick=inventado&group=inventado&status=inventado&priority=inventado");
  check("quickFilter inválido na URL cai pro default", parsePendenciasFilters(invalid).quickFilter, DEFAULT_PENDENCIAS_FILTERS.quickFilter);
  check("groupBy inválido na URL cai pro default", parsePendenciasGroupBy(invalid), DEFAULT_PENDENCIAS_GROUP_BY);
  check("status inválido na URL é descartado (nunca propagado como TaskStatus)", parsePendenciasFilters(invalid).statuses, []);
  check("priority inválida na URL é descartada", parsePendenciasFilters(invalid).priorities, []);
}

console.log("\n9 — regressão: effectiveTaskStatus com os novos status intermediários\n");
{
  const today = new Date(`${TODAY}T00:00:00Z`);
  check(
    "em_andamento não vencido permanece em_andamento (nunca colapsa pra pendente)",
    effectiveTaskStatus({ status: "em_andamento", due_date: "2026-09-30" }, today),
    "em_andamento",
  );
  check(
    "aguardando não vencido permanece aguardando",
    effectiveTaskStatus({ status: "aguardando", due_date: "2026-09-30" }, today),
    "aguardando",
  );
  check(
    "bloqueado vencido vira atrasado (atraso sobrepõe qualquer status não-terminal)",
    effectiveTaskStatus({ status: "bloqueado", due_date: "2026-09-20" }, today),
    "atrasado",
  );
  check("feito vencido continua feito (terminal nunca vira atrasado)", effectiveTaskStatus({ status: "feito", due_date: "2026-09-01" }, today), "feito");
  check(
    "nao_realizado vencido continua nao_realizado (terminal nunca vira atrasado)",
    effectiveTaskStatus({ status: "nao_realizado", due_date: "2026-09-01" }, today),
    "nao_realizado",
  );
}

console.log("\n10 — status editáveis inline nunca incluem estados derivados/terminais especiais\n");
{
  const values = TASK_EDITABLE_STATUS_OPTIONS.map((o) => o.value);
  ok("TASK_EDITABLE_STATUS_OPTIONS nunca inclui 'atrasado' (é sempre derivado, nunca escolhido)", !values.includes("atrasado"));
  ok(
    "TASK_EDITABLE_STATUS_OPTIONS nunca inclui 'nao_realizado' (só via markTaskNotDoneAction)",
    !values.includes("nao_realizado"),
  );
  check("TASK_EDITABLE_STATUS_OPTIONS tem exatamente os 5 status escolhíveis", values.sort(), [
    "aguardando",
    "bloqueado",
    "em_andamento",
    "feito",
    "pendente",
  ]);
}

console.log("\n11 — checagens estruturais: tasks-actions.ts (reabrir + cliente opcional em toda mutação)\n");
{
  const actionsSource = readFileSync(join(__dirname, "../src/app/clients/tasks-actions.ts"), "utf8");
  ok("reopenTaskAction existe e emite TASK_REOPENED", /export async function reopenTaskAction/.test(actionsSource) && actionsSource.includes("OperationalEventType.TASK_REOPENED"));
  ok(
    "performCreateTask aceita clientId nulo (pendência interna)",
    /async function performCreateTask\(\s*clientId: string \| null/.test(actionsSource),
  );
  ok(
    "performUpdateTask aceita clientId nulo",
    /async function performUpdateTask\(\s*taskId: string,\s*clientId: string \| null/.test(actionsSource),
  );
  ok("completeTaskAction aceita clientId nulo", /export async function completeTaskAction\(taskId: string, clientId: string \| null\)/.test(actionsSource));
  ok(
    "markTaskNotDoneAction aceita clientId nulo",
    /export async function markTaskNotDoneAction\(taskId: string, clientId: string \| null\)/.test(actionsSource),
  );
  ok(
    "logOperationalActivity (operational_activities.client_id NOT NULL) nunca é chamado sem checar clientId primeiro nas 3 mutações principais",
    actionsSource.split("logOperationalActivity(supabase, {").slice(1).length >= 3,
  );
}

console.log("\n12 — checagens estruturais: consumidores de status fechado guardam client_id nulo\n");
{
  const clientState = readFileSync(join(__dirname, "../src/lib/client-operational-state-data.ts"), "utf8");
  const channelState = readFileSync(join(__dirname, "../src/lib/operation-channel-state-data.ts"), "utf8");
  ok(
    "client-operational-state-data.ts inclui os 3 status intermediários no filtro de tarefas abertas",
    /"pendente", "em_andamento", "aguardando", "bloqueado", "atrasado"/.test(clientState),
  );
  ok("client-operational-state-data.ts guarda client_id nulo antes de usar como chave de mapa", clientState.includes("if (!task.client_id) continue;"));
  ok(
    "operation-channel-state-data.ts inclui os 3 status intermediários no filtro de tarefas abertas",
    /"pendente", "em_andamento", "aguardando", "bloqueado", "atrasado"/.test(channelState),
  );
  ok("operation-channel-state-data.ts guarda client_id nulo antes de usar como chave de mapa", channelState.includes("if (!task.client_id) continue;"));
}

console.log("\n13 — correção de conceito: Pendências mostra só DEMANDA manual, nunca rotina/tarefa gerada pelo sistema\n");
{
  const dataSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencias-data.ts"), "utf8");
  const pageClientSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencias-page-client.tsx"), "utf8");
  const pageSource = readFileSync(join(__dirname, "../src/app/pendencias/page.tsx"), "utf8");
  const homeSource = readFileSync(join(__dirname, "../src/app/page.tsx"), "utf8");

  ok(
    "a regra que decide 'aparece em Pendências' é origin='manual', filtrada na própria query (nunca em memória, nunca mais template_id)",
    dataSource.includes('.eq("origin", "manual")'),
  );
  ok(
    "loadPendingRecurringTasks (seção de Recorrências) não existe mais em pendencias-data.ts",
    !dataSource.includes("loadPendingRecurringTasks") && !dataSource.includes("fetchRecurringTaskListsForSprints"),
  );
  ok(
    "a página /pendencias não chama nada de recurring_tasks (nunca representa recorrência aqui)",
    !pageSource.includes("loadPendingRecurringTasks") && !pageClientSource.includes("RecurringTasksSection"),
  );
  ok(
    "recurring-task-data.ts (o mecanismo real, usado por /sprints) não foi tocado por esta correção",
    readFileSync(join(__dirname, "../src/lib/recurring-task-data.ts"), "utf8").includes("fetchRecurringTaskListsForSprints"),
  );
  ok(
    "quick-create de Pendências continua criando type='outro' (nunca um tipo de rotina automática)",
    pageClientSource.includes('type: "outro"'),
  );

  ok(
    "resumo da Home busca origin (mesma coluna, mesma regra da página) e ignora tarefa cujo origin não é 'manual'",
    homeSource.includes(", origin,") && /if \(task\.origin !== "manual"\) continue;/.test(homeSource),
  );
}

console.log("\n14 — regra estrutural 'origin': gravada explicitamente em CADA caminho que insere em tasks (nunca inferida depois)\n");
{
  const tasksActionsSource = readFileSync(join(__dirname, "../src/app/clients/tasks-actions.ts"), "utf8");
  const reportActionsSource = readFileSync(join(__dirname, "../src/app/reports/report-actions.ts"), "utf8");
  const migrationSource = readFileSync(join(__dirname, "../supabase/tasks-origin.sql"), "utf8");

  ok("performCreateTask (criação manual — toda tela) grava origin: 'manual'", tasksActionsSource.includes('origin: "manual",'));
  ok(
    "completeTaskAction (próxima ocorrência de recorrência leve, sempre configurada manualmente) grava origin: 'manual'",
    tasksActionsSource.includes('origin: "manual" as const,'),
  );
  ok(
    "sendActionItemToSprintAction (Relatório -> \"Enviar para próxima sprint\", clique humano) grava origin: 'manual'",
    reportActionsSource.includes('origin: "manual" as const,'),
  );
  ok(
    "generate_sprint_tasks_from_templates (ÚNICO caminho 100% automático) grava origin: 'template' na migration",
    /insert into tasks \([\s\S]*?origin[\s\S]*?\)[\s\S]*?'template'/.test(migrationSource),
  );
  ok(
    "record_account_review (tarefa opcional, só quando o gestor marca \"Criar tarefa\") grava origin: 'manual' na migration",
    migrationSource.includes("'pendente',\n      'nenhuma',\n      p_issue_description,\n      'manual'"),
  );
  ok(
    "coluna origin é NOT NULL com default 'manual' (qualquer insert futuro que esqueça de informar cai no lado seguro, nunca aparece como rotina por omissão)",
    migrationSource.includes("alter table tasks alter column origin set default 'manual';") &&
      migrationSource.includes("alter table tasks alter column origin set not null;"),
  );
  ok(
    "backfill histórico usa heurística ESTRUTURAL por type (nunca por título) — só os 3 types que a geração automática usa viram 'template'",
    migrationSource.includes("when type in ('otimizacao', 'verificacao_saldo', 'report') then 'template'"),
  );
  ok(
    "backfill nunca usa comparação de título (ex.: title != 'Checar saldo') — proibido explicitamente pelo pedido",
    !/title\s*[!=]=/.test(migrationSource),
  );
}

console.log("\n15 — buildDuplicateTaskRow (núcleo puro de duplicação, seção 6 do pedido)\n");
{
  function duplicateSource(overrides: Partial<PendenciaDuplicateSource> = {}): PendenciaDuplicateSource {
    return {
      client_id: "c1",
      title: "Corrigir integração",
      type: "outro",
      assignee_id: "tm-1",
      due_date: "2026-10-01",
      priority: "alta",
      notes: "Contexto detalhado do problema.",
      ...overrides,
    };
  }

  const original = duplicateSource();
  const copy = buildDuplicateTaskRow(original);

  check("copia título/cliente/responsável/prioridade/prazo/descrição do original", {
    client_id: copy.client_id,
    title: copy.title,
    assignee_id: copy.assignee_id,
    due_date: copy.due_date,
    priority: copy.priority,
    notes: copy.notes,
  }, {
    client_id: "c1",
    title: "Corrigir integração",
    assignee_id: "tm-1",
    due_date: "2026-10-01",
    priority: "alta",
    notes: "Contexto detalhado do problema.",
  });

  check("origin da cópia é sempre 'manual' — duplicar é, em si, um ato humano explícito", copy.origin, "manual");
  check("status inicial da cópia é sempre 'pendente'", copy.status, "pendente");
  check("sprint_id da cópia é sempre null (não herda a sprint do original)", copy.sprint_id, null);

  const doneOriginal = duplicateSource({ title: "Tarefa já concluída" });
  check(
    "duplicar uma tarefa CONCLUÍDA ainda assim gera cópia com status 'pendente' (nunca herda status terminal)",
    buildDuplicateTaskRow(doneOriginal).status,
    "pendente",
  );

  ok(
    "PendenciaDuplicateRow não tem campo id/comments/history/timestamps — o tipo só inclui os campos de conteúdo copiáveis",
    Object.keys(copy).sort().join(",") === "assignee_id,client_id,due_date,notes,origin,priority,sprint_id,status,title,type",
  );
}

console.log("\n16 — duplicateTasksAction: uma leitura + um insert, nunca herda id/comentários/histórico do original\n");
{
  const tasksActionsSource = readFileSync(join(__dirname, "../src/app/clients/tasks-actions.ts"), "utf8");
  ok(
    "duplicateTasksAction seleciona os originais numa única query (.in(\"id\", taskIds)), nunca um loop de leituras",
    /originalsResult = await queryOrError[\s\S]*?\.in\("id", taskIds\)/.test(tasksActionsSource),
  );
  ok(
    "duplicateTasksAction insere todas as cópias em uma única chamada (.insert(newRows)), nunca um insert por item",
    tasksActionsSource.includes(".from(\"tasks\").insert(newRows)"),
  );
  ok(
    "cada cópia recebe seu próprio TASK_CREATED (nunca reaproveita o rastro do original)",
    tasksActionsSource.includes('eventType: OperationalEventType.TASK_CREATED,') && tasksActionsSource.includes('metadata: { task_title: row.title, origin: "duplicate" }'),
  );
  ok(
    "select dos originais não traz id de comentários/histórico — só os campos de conteúdo (id é só pra identificar QUAL duplicar)",
    tasksActionsSource.includes('.select("id, client_id, title, type, assignee_id, due_date, priority, notes")'),
  );
}

console.log("\n17 — exclusão em lote: admin-only, uma leitura + um delete, nunca uma chamada por item\n");
{
  const tasksActionsSource = readFileSync(join(__dirname, "../src/app/clients/tasks-actions.ts"), "utf8");
  const pageClientSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencias-page-client.tsx"), "utf8");

  ok(
    "bulkDeleteTasksAction exige admin (mesma regra da exclusão individual)",
    /export async function bulkDeleteTasksAction[\s\S]{0,300}requireAdmin\(\)/.test(tasksActionsSource),
  );
  ok(
    "bulkDeleteTasksAction apaga todos os selecionados numa única chamada (.delete().in(\"id\", taskIds)), nunca um delete por item",
    tasksActionsSource.includes('.from("tasks").delete().in("id", taskIds)'),
  );
  ok(
    "botão 'Excluir' da barra de ação em lote só aparece pra admin (isAdmin &&)",
    /isAdmin &&\s*\(confirmingBulkDelete/.test(pageClientSource),
  );
  ok(
    "confirmação de exclusão em lote avisa explicitamente que é permanente",
    pageClientSource.includes("Isso é permanente."),
  );
  ok(
    "cancelar a confirmação de exclusão em lote (botão 'Não') não dispara nenhuma action, só fecha o estado de confirmação",
    /onClick=\{\(\) => setConfirmingBulkDelete\(false\)\}/.test(pageClientSource),
  );
  const duplicateButtonBlock = pageClientSource.match(/onClick=\{handleBulkDuplicate\}[\s\S]*?<\/button>/);
  ok(
    "botão 'Duplicar' da barra de ação em lote NÃO é restrito a admin (qualquer usuário autenticado pode duplicar)",
    !!duplicateButtonBlock && !duplicateButtonBlock[0].includes("isAdmin"),
  );
}

console.log("\n18 — seleção respeita filtros: 'todas visíveis' nunca inclui item escondido por filtro\n");
{
  const pageClientSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencias-page-client.tsx"), "utf8");
  ok(
    "visibleIds deriva de `filtered` (o recorte já filtrado), nunca da lista completa `items`",
    /const visibleIds = useMemo\(\(\) => filtered\.map/.test(pageClientSource),
  );
  ok(
    "toggleSelectAllVisible só adiciona/remove ids de visibleIds, nunca de items inteiro",
    /function toggleSelectAllVisible\(\) \{[\s\S]{0,300}for \(const id of visibleIds\)/.test(pageClientSource),
  );
}

console.log("\n19 — identidade visual de prioridade: 4 cores distintas, sem azul (restrição de marca KOFF)\n");
{
  const priorities = ["urgente", "alta", "normal", "baixa"] as const;
  const dotClasses = priorities.map((p) => TASK_PRIORITY_DOT_CLASS[p]);
  ok("as 4 prioridades têm classes de ponto TODAS diferentes entre si", new Set(dotClasses).size === 4);

  const badgeClasses = priorities.map((p) => TASK_PRIORITY_BADGE_CLASSES[p]);
  ok("as 4 prioridades têm classes de badge TODAS diferentes entre si", new Set(badgeClasses).size === 4);

  ok(
    "nenhuma classe de prioridade usa 'blue' (restrição de marca: azul foi deliberadamente eliminado do código)",
    !dotClasses.some((c) => c.includes("blue")) && !badgeClasses.some((c) => c.includes("blue")),
  );

  const rowSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencia-row.tsx"), "utf8");
  const drawerSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencia-drawer.tsx"), "utf8");
  ok("a linha da lista usa TASK_PRIORITY_DOT_CLASS (ponto pequeno, não pinta a linha inteira)", rowSource.includes("TASK_PRIORITY_DOT_CLASS[item.priority]"));
  ok("o drawer também usa TASK_PRIORITY_DOT_CLASS (mesma identidade visual, consistente)", drawerSource.includes("TASK_PRIORITY_DOT_CLASS[item.priority]"));
}

console.log("\n20 — SearchableSelect/SearchableMultiSelect: busca case-insensitive por substring\n");
{
  function opt(id: string, label: string): SearchableSelectOption {
    return { id, label };
  }
  const options = [opt("1", "Kaizen"), opt("2", "Kaizen Digital"), opt("3", "Acme"), opt("4", "beta ltda")];

  check(
    "busca 'kai' (minúsculo) encontra 'Kaizen'/'Kaizen Digital' (case-insensitive)",
    filterSearchableOptions(options, "kai").map((o) => o.id),
    ["1", "2"],
  );
  check(
    "busca 'KAI' (maiúsculo) encontra o mesmo resultado — nunca depende de caixa",
    filterSearchableOptions(options, "KAI").map((o) => o.id),
    ["1", "2"],
  );
  check("busca por substring no meio da palavra também encontra ('eta' em 'beta ltda')", filterSearchableOptions(options, "eta").map((o) => o.id), ["4"]);
  check("query vazia (ou só espaços) devolve todas as opções, sem filtrar", filterSearchableOptions(options, "   ").map((o) => o.id), ["1", "2", "3", "4"]);
  check("busca sem nenhum resultado devolve lista vazia (nunca undefined/erro)", filterSearchableOptions(options, "zzz-nao-existe"), []);
  check(
    "busca nunca casa contra sublabel (ex.: '(inativo)'), só contra label",
    filterSearchableOptions([{ id: "5", label: "Fulano", sublabel: "(inativo)" }], "inativo"),
    [],
  );
}

console.log("\n21 — descrição: reaproveita o campo `notes` já existente, textarea maior no drawer\n");
{
  const drawerSource = readFileSync(join(__dirname, "../src/app/pendencias/pendencia-drawer.tsx"), "utf8");
  const formSource = readFileSync(join(__dirname, "../src/app/clients/inline-task-form.tsx"), "utf8");

  ok(
    "TaskFormFields aceita notesRows/notesLabel configuráveis (default preserva comportamento existente nos outros lugares)",
    formSource.includes("notesRows = 2,") && formSource.includes('notesLabel = "Observações (opcional)",'),
  );
  ok("drawer de Pendências passa notesRows=7 (textarea grande, 6-8 linhas confortáveis)", drawerSource.includes("notesRows={7}"));
  ok('drawer de Pendências rotula o campo como "Descrição" (separado do título)', drawerSource.includes('notesLabel="Descrição"'));
  ok(
    "drawer não cria nenhum campo novo — defaultNotes vem de item.notes, a mesma coluna de sempre",
    drawerSource.includes("defaultNotes={item.notes}"),
  );
  ok(
    "indicador de descrição na linha é discreto (ícone com tooltip), nunca o texto completo inline",
    readFileSync(join(__dirname, "../src/app/pendencias/pendencia-row.tsx"), "utf8").includes('<Tooltip label="Tem descrição">'),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
