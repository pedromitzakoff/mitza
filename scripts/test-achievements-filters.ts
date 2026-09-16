/**
 * Testes da Etapa "Filtros de Gestor/Objetivo" — adiciona Gestor
 * (`clients.primary_manager_id`) e Objetivo (`clients.performance_goal`) à
 * aba Cliente de `/achievements`, reaproveitando exatamente as mesmas
 * fontes canônicas e padrões já usados na Operação (`resolveOperationGoal`,
 * `PERFORMANCE_GOALS`) — nunca uma classificação nova/paralela.
 *
 * Mesma limitação estrutural dos demais testes desta sessão (sem Supabase):
 * a resolução real (`resolveClientIdsForManagerAndGoal`,
 * `achievements-data.ts`) acontece NA QUERY (duas colunas de `clients`,
 * nunca duplicadas no metadata do evento) — aqui ela é reproduzida em
 * memória sobre fixtures (mesmo padrão de `test-operation-goal-filter.ts`),
 * complementada por checagens ESTRUTURAIS confirmando que a query real
 * segue exatamente essa mesma regra.
 *
 * Rodar: npx tsx scripts/test-achievements-filters.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAchievementGoal, resolveAchievementLevel } from "../src/app/achievements/page";
import type { AchievementLevel } from "../src/lib/achievement-types";
import type { PerformanceGoal } from "../src/lib/performance-goals";

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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1 — resolveAchievementGoal: mesmo padrão de resolveOperationGoal/
// resolveAchievementLevel — fallback seguro, valores inválidos.
// ---------------------------------------------------------------------------
console.log("1 — resolveAchievementGoal: URL como estado, fallback seguro\n");
{
  check("sem parâmetro -> 'todos'", resolveAchievementGoal(undefined), "todos");
  check("?goal=leads -> 'leads'", resolveAchievementGoal("leads"), "leads");
  check("?goal=sales -> 'sales'", resolveAchievementGoal("sales"), "sales");
  check("?goal=followers -> 'followers' (Awareness → followers, mesmo mapeamento da Operação)", resolveAchievementGoal("followers"), "followers");
  check("?goal=todos -> 'todos'", resolveAchievementGoal("todos"), "todos");
  check("?goal=vendas (português, valor inválido) -> fallback seguro 'todos'", resolveAchievementGoal("vendas"), "todos");
  check("?goal=awareness (nome que não é o valor de banco) -> fallback seguro 'todos'", resolveAchievementGoal("awareness"), "todos");
  check("?goal= (vazio) -> 'todos'", resolveAchievementGoal(""), "todos");
  check("resolveAchievementLevel continua intocado (regressão)", resolveAchievementLevel("campaign"), "campaign");
}

// ---------------------------------------------------------------------------
// 2 — Checagens estruturais: fonte canônica direta (clients.primary_manager_id/
// performance_goal), nunca duplicada no metadata; mesma função reaproveitada
// pelo feed E pelo resumo; rótulo "Seguidores" (nunca "Awareness").
// ---------------------------------------------------------------------------
console.log("\n2 — Query real: fonte canônica direta, nunca duplicada no evento\n");
{
  const dataCode = stripComments(loadSource("src", "lib", "achievements-data.ts"));
  ok("resolve Gestor direto de clients.primary_manager_id", /\.eq\("primary_manager_id", managerId\)/.test(dataCode));
  ok("resolve Objetivo direto de clients.performance_goal", /\.eq\("performance_goal", goal\)/.test(dataCode));
  ok(
    "nenhum filtro por Gestor/Objetivo passa pelo metadata do evento (sempre client_id resolvido via clients)",
    !/metadata->>manager|metadata->>performance_goal|metadata->>primary_manager/.test(dataCode),
  );
  const resolverCalls = dataCode.match(/await resolveClientIdsForManagerAndGoal\(/g) ?? [];
  check("resolveClientIdsForManagerAndGoal é chamada exatamente 2x — fetchAchievements e fetchClientAchievementsMonthSummary, nunca duas implementações", resolverCalls.length, 2);
  ok("curto-circuito seguro quando Gestor+Objetivo não batem em nenhum cliente (nunca um .in([]) ambíguo)", /managerGoalClientIds\.length === 0/.test(dataCode));
  ok("resumo mensal (fetchClientAchievementsMonthSummary) agora recebe filtros (Cliente/Gestor/Objetivo/Tipo/Nível)", /AchievementMonthSummaryFilters/.test(dataCode));

  const filterBarCode = stripComments(loadSource("src", "app", "achievements", "achievements-filter-bar.tsx"));
  ok("rótulo do terceiro objetivo reaproveita PERFORMANCE_GOALS.followers.label ('Seguidores')", /PERFORMANCE_GOALS\.followers\.label/.test(filterBarCode));
  ok('nunca introduz "Awareness" como rótulo de interface (decisão já documentada em performance-goals.ts)', !/Awareness/.test(filterBarCode));

  const pageCode = stripComments(loadSource("src", "app", "achievements", "page.tsx"));
  const teamMembersQueries = pageCode.match(/\.from\("team_members"\)/g) ?? [];
  check("Gestor reaproveita a MESMA query de team_members já usada pela aba Pessoa — nenhuma consulta nova", teamMembersQueries.length, 1);
  ok("Gestor/Objetivo só existem (são calculados) na aba Cliente — nunca vazam pra Agência/Pessoa", /managerId = scope === "client" \? \(params\.manager \?\? "todos"\) : "todos"/.test(pageCode));
  ok("Objetivo também só existe na aba Cliente", /goalId = scope === "client" \? resolveAchievementGoal\(params\.goal\) : "todos"/.test(pageCode));
}

// ---------------------------------------------------------------------------
// 3 — Simulação fim-a-fim: fixtures em memória reproduzindo a MESMA regra de
// duas etapas da query real (Gestor+Objetivo resolvem client_id primeiro,
// os demais filtros combinam por cima).
// ---------------------------------------------------------------------------
interface FixtureClient {
  id: string;
  name: string;
  managerId: string;
  goal: PerformanceGoal;
}

interface FixtureEvent {
  id: string;
  clientId: string;
  family: string;
  level: AchievementLevel;
}

const CLIENTS: FixtureClient[] = [
  { id: "c1", name: "Clínica Vero", managerId: "vinicius", goal: "leads" },
  { id: "c2", name: "Studio Fit", managerId: "filipe", goal: "sales" },
  { id: "c3", name: "Boutique Alma", managerId: "filipe", goal: "followers" },
  { id: "c4", name: "Padaria Trigo", managerId: "vinicius", goal: "sales" },
];

const EVENTS: FixtureEvent[] = [
  { id: "e1", clientId: "c1", family: "consistencia", level: "account" },
  { id: "e2", clientId: "c1", family: "destaque", level: "campaign" },
  { id: "e3", clientId: "c2", family: "evolucao", level: "account" },
  { id: "e4", clientId: "c3", family: "evolucao", level: "account" },
  { id: "e5", clientId: "c4", family: "evolucao", level: "account" },
  { id: "e6", clientId: "c4", family: "destaque", level: "creative" },
];

/** Réplica em memória de `resolveClientIdsForManagerAndGoal` — mesma regra:
 * `null` = nenhum dos dois filtros ativo (não restringe); array (possivelmente
 * vazio) = interseção de Gestor E Objetivo. */
function resolveClientIds(clients: FixtureClient[], managerId: string | null, goal: PerformanceGoal | null): string[] | null {
  if (!managerId && !goal) return null;
  return clients.filter((c) => (!managerId || c.managerId === managerId) && (!goal || c.goal === goal)).map((c) => c.id);
}

/** Réplica em memória de `fetchAchievements` (query real) — mesma ordem de
 * composição: Gestor+Objetivo resolvem o conjunto de clientes primeiro,
 * Cliente/Tipo/Nível filtram por cima, exatamente como a query real faz. */
function filterEvents(
  events: FixtureEvent[],
  filters: { clientId?: string | null; managerId?: string | null; goal?: PerformanceGoal | null; family?: string | null; level?: AchievementLevel | null },
): FixtureEvent[] {
  const scopeIds = resolveClientIds(CLIENTS, filters.managerId ?? null, filters.goal ?? null);
  return events.filter((e) => {
    if (scopeIds !== null && !scopeIds.includes(e.clientId)) return false;
    if (filters.clientId && e.clientId !== filters.clientId) return false;
    if (filters.family && e.family !== filters.family) return false;
    if (filters.level && e.level !== filters.level) return false;
    return true;
  });
}

console.log("\n3 — Todos os gestores / gestor específico\n");
{
  check("Todos os gestores: nenhuma restrição, os 6 eventos aparecem", filterEvents(EVENTS, {}).length, 6);
  const vinicius = filterEvents(EVENTS, { managerId: "vinicius" });
  check("Gestor Vinicius: eventos de c1 e c4 (e1,e2,e5,e6)", vinicius.map((e) => e.id).sort(), ["e1", "e2", "e5", "e6"]);
  ok("cliente de outro gestor (Filipe) nunca aparece com Gestor=Vinicius", !vinicius.some((e) => e.clientId === "c2" || e.clientId === "c3"));
}

console.log("\n4 — Todos os objetivos / Leads / Vendas / Awareness (followers)\n");
{
  check("Todos os objetivos: nenhuma restrição, 6 eventos", filterEvents(EVENTS, { goal: undefined }).length, 6);

  const leads = filterEvents(EVENTS, { goal: "leads" });
  check("Objetivo Leads: só eventos de c1 (único cliente Leads)", leads.map((e) => e.id).sort(), ["e1", "e2"]);
  ok("cliente de outro objetivo (Vendas/Seguidores) nunca aparece com Objetivo=Leads", !leads.some((e) => e.clientId !== "c1"));

  const vendas = filterEvents(EVENTS, { goal: "sales" });
  check("Objetivo Vendas: eventos de c2 e c4", vendas.map((e) => e.id).sort(), ["e3", "e5", "e6"]);

  const awareness = filterEvents(EVENTS, { goal: "followers" });
  check("Objetivo Awareness (followers): só evento de c3", awareness.map((e) => e.id), ["e4"]);
}

console.log("\n5 — Gestor + Objetivo, e combinações com Cliente/Tipo/Nível\n");
{
  const filipeVendas = filterEvents(EVENTS, { managerId: "filipe", goal: "sales" });
  check("Gestor Filipe + Objetivo Vendas: só c2 (c3 é Filipe mas Seguidores, fica de fora)", filipeVendas.map((e) => e.id), ["e3"]);

  const viniciusVendasC4 = filterEvents(EVENTS, { managerId: "vinicius", goal: "sales", clientId: "c4" });
  check("Gestor Vinicius + Objetivo Vendas + Cliente c4: os 2 eventos de c4", viniciusVendasC4.map((e) => e.id).sort(), ["e5", "e6"]);

  const viniciusVendasDestaqueCreative = filterEvents(EVENTS, { managerId: "vinicius", goal: "sales", family: "destaque", level: "creative" });
  check("Gestor + Objetivo + Tipo (destaque) + Nível (criativo): só e6", viniciusVendasDestaqueCreative.map((e) => e.id), ["e6"]);

  const semNinguem = filterEvents(EVENTS, { managerId: "vinicius", goal: "followers" });
  check("Gestor Vinicius + Objetivo Seguidores: ninguém satisfaz os dois juntos (curto-circuito seguro)", semNinguem, []);
}

// ---------------------------------------------------------------------------
// 4 — URL state: preserva todos os filtros, ordem correta na barra, limpar
// filtros zera Gestor/Objetivo também.
// ---------------------------------------------------------------------------
console.log("\n6 — URL state: preserva Gestor/Objetivo, combina com os demais, limpar filtros\n");
{
  const filterBarCode = stripComments(loadSource("src", "app", "achievements", "achievements-filter-bar.tsx"));
  ok("buildUrl grava manager na querystring quando ativo", /next\.set\("manager", managerId\)/.test(filterBarCode));
  ok("buildUrl grava goal na querystring quando ativo", /next\.set\("goal", goalId\)/.test(filterBarCode));
  ok(
    "trocar Gestor nunca reseta Objetivo (buildUrl reconstrói TODOS os filtros atuais antes de aplicar o override)",
    /if \(scope === "client" && managerId !== "todos"\) next\.set\("manager", managerId\);[\s\S]*if \(scope === "client" && goalId !== "todos"\) next\.set\("goal", goalId\);/.test(
      filterBarCode,
    ),
  );
  ok("Limpar filtros zera Gestor e Objetivo também", /navigate\(\{ client: "todos", manager: "todos", goal: "todos"/.test(filterBarCode));

  const pageCode = stripComments(loadSource("src", "app", "achievements", "page.tsx"));
  ok("pageHref (paginação/troca de aba) também preserva manager/goal", /nextManager = overrides\.manager \?\? managerId/.test(pageCode) && /nextGoal = overrides\.goal \?\? goalId/.test(pageCode));
  ok("troca de aba (Cliente/Agência/Pessoa) reseta Gestor/Objetivo (não fazem sentido fora da aba Cliente)", /manager: "todos", goal: "todos"/.test(pageCode));

  // Ordem visual pedida: Cliente | Gestor | Objetivo | Tipo | Nível.
  const clientIdx = filterBarCode.indexOf('aria-label="Filtrar por cliente"');
  const managerIdx = filterBarCode.indexOf('aria-label="Filtrar por gestor"');
  const goalIdx = filterBarCode.indexOf('aria-label="Filtrar por objetivo"');
  const typeIdx = filterBarCode.indexOf('aria-label="Filtrar por tipo"');
  const levelIdx = filterBarCode.indexOf('aria-label="Filtrar por nível"');
  ok("ordem dos filtros no desktop: Cliente < Gestor < Objetivo < Tipo < Nível", clientIdx < managerIdx && managerIdx < goalIdx && goalIdx < typeIdx && typeIdx < levelIdx);
}

// ---------------------------------------------------------------------------
// 5 — Resumo superior: coerente com a população filtrada (Gestor/Objetivo E
// os filtros que já existiam antes).
// ---------------------------------------------------------------------------
console.log("\n7 — Resumo superior acompanha a população filtrada (todos os filtros, não só os novos)\n");
{
  const pageCode = stripComments(loadSource("src", "app", "achievements", "page.tsx"));
  ok(
    "fetchClientAchievementsMonthSummary recebe os MESMOS filtros do feed (clientFilters), nunca um total global dissociado",
    /fetchClientAchievementsMonthSummary\(supabase, profile\.organizationId, monthRangeFor\(now\), clientFilters\)/.test(pageCode),
  );

  // Réplica funcional: o resumo (total/distinctClients) recalculado sobre a
  // MESMA população filtrada do feed precisa bater com o que o feed mostra —
  // nunca dois números divergentes pro mesmo filtro.
  function summarize(events: FixtureEvent[]) {
    return { total: events.length, distinctClients: new Set(events.map((e) => e.clientId)).size };
  }
  const filipeVendasEvents = filterEvents(EVENTS, { managerId: "filipe", goal: "sales" });
  check("resumo (Gestor=Filipe, Objetivo=Vendas): 1 conquista, 1 cliente — bate com o feed filtrado", summarize(filipeVendasEvents), { total: 1, distinctClients: 1 });

  const viniciusEvents = filterEvents(EVENTS, { managerId: "vinicius" });
  check("resumo (Gestor=Vinicius): 4 conquistas, 2 clientes — bate com o feed filtrado", summarize(viniciusEvents), { total: 4, distinctClients: 2 });
}

console.log(`\n${passed} verificações passaram.`);
