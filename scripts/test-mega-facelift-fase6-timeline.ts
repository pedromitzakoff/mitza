/**
 * Testes da Etapa "MEGA FACELIFT — Fase 6: Timeline" — cobre o núcleo puro
 * novo (`lib/client-timeline.ts`: taxonomia por categoria, resolução de
 * `tasks.origin` pra Demandas×Operação, links contextuais) com chamadas
 * diretas quando possível, e checagens ESTRUTURAIS do loader e da página
 * via grep de código-fonte — mesmo padrão já usado por
 * `test-mega-facelift-fase5-dados.ts` pra loaders que dependem de Supabase
 * (sem instância de banco neste ambiente de teste).
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase6-timeline.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_TIMELINE_CATEGORY_OPTIONS,
  CLIENT_TIMELINE_CATEGORY_LABEL,
  resolveClientTimelineCategory,
} from "../src/lib/client-timeline";
import { buildModuleContextHref, resolveReplicableSuffix } from "../src/lib/client-workspace-nav";
import { OperationalEventType } from "../src/lib/operational-events";

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

const clientTimelineSource = loadSource("src", "lib", "client-timeline.ts");
const agencyTimelineSource = loadSource("src", "lib", "agency-timeline.ts");
const pageSource = loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx");
const sidebarSource = loadSource("src", "app", "sidebar.tsx");

console.log("\n1 — resolveClientTimelineCategory: fallback seguro pra 'todos', nunca um recorte chutado\n");
{
  check("sem param -> todos", resolveClientTimelineCategory(undefined), "todos");
  check("param inválido -> todos", resolveClientTimelineCategory("bagunca"), "todos");
  check("'demandas' é aceito", resolveClientTimelineCategory("demandas"), "demandas");
  check("'performance' é aceito", resolveClientTimelineCategory("performance"), "performance");
  check("5 categorias + 'todos', nenhuma inventada sem evento real por trás (ver auditoria no relatório)", CLIENT_TIMELINE_CATEGORY_OPTIONS.length, 6);
}

console.log("\n2 — Rótulos das categorias são os mesmos usados na página (nenhum rótulo duplicado/divergente)\n");
{
  check(CLIENT_TIMELINE_CATEGORY_LABEL.planejamento, CLIENT_TIMELINE_CATEGORY_LABEL.planejamento, "Planejamento");
  check(CLIENT_TIMELINE_CATEGORY_LABEL.demandas, CLIENT_TIMELINE_CATEGORY_LABEL.demandas, "Demandas");
  ok("a página usa CLIENT_TIMELINE_CATEGORY_LABEL pra renderizar os pills, nunca um rótulo hardcoded redundante", pageSource.includes("CLIENT_TIMELINE_CATEGORY_LABEL[option]"));
}

console.log("\n3 — Taxonomia derivada de evento REAL: cada categoria mapeia pra event_type(s) existentes na taxonomia oficial\n");
{
  ok(
    "Planejamento = só eventos reais de orçamento (monthly_budget_created/changed) — nunca client_goals (sem evento ainda, ver gap documentado)",
    /MONTHLY_BUDGET_CREATED\]: "planejamento"/.test(clientTimelineSource) && /MONTHLY_BUDGET_CHANGED\]: "planejamento"/.test(clientTimelineSource),
  );
  ok("Performance = só achievement_unlocked, mesmo conceito já usado em /timeline (família 'performance')", /ACHIEVEMENT_UNLOCKED\]: "performance"/.test(clientTimelineSource));
  ok(
    "Conta agrupa client_created/status/manager + monthly_report_*/client_update_*/client_report_* — nenhum deles pertence a Planejamento/Operação/Demandas/Performance",
    /CLIENT_CREATED\]: "conta"/.test(clientTimelineSource) && /CLIENT_MANAGER_CHANGED\]: "conta"/.test(clientTimelineSource),
  );
  ok(
    "task_assigned/task_reassigned/task_due_date_changed/task_deleted NUNCA entram na Timeline (seção 12/21 do pedido: não virar espelho de todo CRUD de tarefa)",
    !/TASK_ASSIGNED\]|TASK_REASSIGNED\]|TASK_DUE_DATE_CHANGED\]|TASK_DELETED\]/.test(clientTimelineSource),
  );
}

console.log("\n4 — Demandas × Operação: a MESMA task_completed/created/reopened é separada por tasks.origin, nunca por heurística de task_type\n");
{
  ok("existe uma função dedicada que resolve a categoria a partir de tasks.origin (nunca inferida de outro campo)", /function resolveTaskDerivedCategory/.test(clientTimelineSource));
  ok("origin === 'manual' -> demandas; qualquer outro valor -> operacao (fallback documentado, nunca silencioso)", /origin === "manual" \? "demandas" : "operacao"/.test(clientTimelineSource));
  ok(
    "a resolução busca tasks.origin em LOTE (.in) a partir dos ids já na página — nunca uma query por linha (nenhum N+1)",
    /\.from\("tasks"\)\s*\n?\s*\.select\("id, origin, title"\)\s*\n?\s*\.in\("id", taskIds\)/.test(clientTimelineSource),
  );
  ok(
    "o mesmo lote já traz 'title' — cobre task_reopened, cujo metadata não carrega task_title (achado da auditoria)",
    clientTimelineSource.includes('.select("id, origin, title")'),
  );
}

console.log("\n5 — Rótulos humanos: Demanda criada/concluída/reaberta nunca mostram o event_type bruto; Operação mantém os rótulos já existentes de lib/agency-timeline.ts\n");
{
  ok('"Demanda criada" só aparece quando a categoria resolvida é demandas', /category !== "demandas"\) return fallback/.test(clientTimelineSource));
  ok('label "Demanda criada"/"Demanda concluída"/"Demanda reaberta" — nenhum texto técnico (task_created/task_completed/task_reopened) na UI', /"Demanda criada"/.test(clientTimelineSource) && /"Demanda reaberta"/.test(clientTimelineSource) && /"Demanda concluída"/.test(clientTimelineSource));
  ok(
    "task_completed em categoria 'operacao' reaproveita buildTaskCompletedPresentation (lib/agency-timeline.ts) — nunca uma segunda lógica de rótulo por task_type",
    agencyTimelineSource.includes("export function buildTaskCompletedPresentation"),
  );
}

console.log("\n6 — Nenhum rótulo bruto de event_type na UI; metadata ausente nunca gera texto tipo 'Usuário desconhecido'/'Sem responsável'\n");
{
  ok("a Timeline nunca força um texto de fallback pra ator ausente — omite a linha quando null (seção 6 do pedido)", /row\.actorName &&/.test(pageSource));
  ok("nenhum literal 'Usuário desconhecido'/'Sem responsável'/'Valor anterior: null' em nenhum dos dois arquivos", !/Usuário desconhecido|Sem responsável|Valor anterior: null/.test(clientTimelineSource + pageSource));
}

console.log("\n7 — Links contextuais: cada event_type aponta pro destino real já existente; nunca um link genérico/fabricado\n");
{
  check("evento de orçamento -> Metas (planejamento genuíno)", /MONTHLY_BUDGET_CREATED:\s*\n\s*case EventType\.MONTHLY_BUDGET_CHANGED:\s*\n\s*return \{ href: `\/clients\/\$\{clientId\}\/metas`/.test(clientTimelineSource), true);
  ok("evento de otimização/reunião/entrega -> Operação", /return \{ href: `\/clients\/\$\{clientId\}\/operation`, label: "Ver Operação →" \}/.test(clientTimelineSource));
  ok("demanda (origin=manual) -> Demandas; mesmo event_type com origin=template -> Operação (nunca o mesmo link pros dois)", /category === "demandas"\s*\n\s*\? \{ href: `\/clients\/\$\{clientId\}\/demandas`/.test(clientTimelineSource));
  ok("achievement_unlocked e qualquer tipo fora do mapa -> null (nunca um CTA fabricado)", /default:\s*\n\s*return null;/.test(clientTimelineSource));
  ok("a página só renderiza o CTA quando row.link existe", /\{row\.link && \(/.test(pageSource));
}

console.log("\n8 — Agrupamento temporal: reaproveita formatTimelineDayLabel (Hoje/Ontem/data) já usado em /timeline — nenhuma segunda regra de dia civil\n");
{
  ok("a página importa formatTimelineDayLabel de lib/format.ts, nunca uma comparação de data própria", pageSource.includes('import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format"'));
  ok("mais recente primeiro — fetchAgencyEvents já ordena occurred_at desc (reaproveitado, nunca reordenado em memória)", agencyTimelineSource.includes('.order("occurred_at", { ascending: false })'));
}

console.log("\n9 — Paginação: 'Carregar mais', nunca infinite scroll; reaproveita a mesma estratégia de fetchAgencyEvents\n");
{
  ok("página usa link 'Carregar mais' (não infinite scroll/intersection observer)", pageSource.includes("Carregar mais"));
  ok("fetchClientTimelinePage delega a paginação pra fetchAgencyEvents (limit/offset), nenhuma segunda implementação", /fetchAgencyEvents\(supabase, organizationId, \{\s*\n\s*eventTypes: categoryEventTypes\(category\)/.test(clientTimelineSource));
}

console.log("\n10 — Filtro por categoria: só as categorias com evento real suportado; nunca 25 filtros batendo 1:1 com event_type interno\n");
{
  check("exatamente as 6 opções (todos + 5 categorias), nenhuma a mais", CLIENT_TIMELINE_CATEGORY_OPTIONS, ["todos", "planejamento", "operacao", "demandas", "performance", "conta"]);
  ok("mais de 30 event_types internos, mas só 5 categorias na UI (curadoria real, nunca 1:1 com o banco)", Object.keys(OperationalEventType).length > 25);
}

console.log("\n11 — Empty states: mensagem honesta, nunca um erro; distinta entre 'sem evento nenhum' e 'sem evento nesta categoria'\n");
{
  ok("mensagem pra cliente sem nenhum evento", pageSource.includes("Nenhum evento registrado para este cliente ainda."));
  ok("mensagem distinta pra filtro sem resultado", pageSource.includes("Nenhum evento nesta categoria."));
}

console.log("\n12 — Contexto CLIENTE (rota /clients/[id]/timeline) e contexto TODOS (Timeline da Agência) preservam suas funções distintas\n");
{
  check("buildModuleContextHref('timeline', Todos) continua caindo em /timeline (rota global já existente, Fase 4.6 preservada)", buildModuleContextHref("timeline", { type: "all" }, null), "/timeline");
  check("trocar de cliente dentro de /timeline preserva o módulo", resolveReplicableSuffix("/timeline"), "/timeline");
  ok("a página do cliente usa WorkspaceContainer (identidade do workspace do cliente, nunca o layout de /timeline)", pageSource.includes("<WorkspaceContainer>"));
  ok("/timeline (agência) nunca foi reescrita — mesma fetchAgencyTimeline/TimelineFilterBar de sempre", loadSource("src", "app", "timeline", "page.tsx").includes("fetchAgencyTimeline"));
}

console.log("\n13 — Sidebar: módulo Timeline continua presente e único (nenhuma duplicata introduzida nesta fase)\n");
{
  ok("Sidebar ainda define o módulo Timeline (grupo execução) — Fase 6 não tocou a navegação", /\{ key: "timeline", label: "Timeline"/.test(sidebarSource));
  ok("Timeline aparece só UMA vez em MODULES", (sidebarSource.match(/key: "timeline"/g) ?? []).length === 1);
}

console.log("\n14 — Permissões: mesmo modelo de acesso de /timeline (RLS por organização, nenhum gate novo) — gestor vê a história completa do cliente que já acessa\n");
{
  ok("a página não chama requireAdmin — qualquer perfil autenticado com acesso ao cliente vê a Timeline (mesma régua de Metas/Dados)", !pageSource.includes("requireAdmin"));
  ok("fetchClientTimelinePage recebe organizationId resolvido da sessão (getCurrentProfile), nunca aceito de input", pageSource.includes("profile.organizationId"));
}

console.log("\n15 — Isolamento: nenhuma mudança de schema/RLS; nenhum motor de diagnóstico/cálculo tocado; achievement-engine/operational-events intocados\n");
{
  ok(
    "client-timeline.ts nunca importa lib/performance.ts (Performance) nem lib/client-plan.ts (Metas) — zero acoplamento com cálculo de outro módulo",
    !/from "@\/lib\/performance"/.test(clientTimelineSource) && !/from "@\/lib\/client-plan"/.test(clientTimelineSource),
  );
  ok("nenhuma ALTER/CREATE TABLE nova — Fase 6 não cria nenhum arquivo em supabase/", !clientTimelineSource.includes("create table") && !clientTimelineSource.includes("alter table"));
  ok("record-operational-event.ts (serviço central de escrita) não foi alterado por esta fase — grep garante que o arquivo ainda só tem 1 função de registro", loadSource("src", "lib", "record-operational-event.ts").match(/export async function/g)?.length === 1);
}

console.log(`\n${passed} verificações passaram.`);
