/**
 * Testes da Etapa "Operação — Filtro por Objetivo" — adiciona a dimensão
 * OBJETIVO (Leads/Vendas/Seguidores/Todos) à Operação por Canal já existente
 * (Meta/Google), sem redesenhar prioridade/saúde. Cobre os 21 cenários
 * pedidos.
 *
 * Mesma limitação estrutural de `test-operation-channel-scoping.ts` (sem
 * Supabase neste ambiente): a seleção de população por canal+objetivo
 * acontece NA QUERY real (`loadOperationChannelStates`,
 * lib/operation-channel-state-data.ts — `.contains("media_channels", [channel])`
 * + `.eq("performance_goal", goal)` condicional), então aqui ela é
 * reproduzida em memória sobre fixtures (`buildPopulation` abaixo, mesma
 * regra de duas etapas: canal primeiro, objetivo depois) — e complementada
 * por checagens ESTRUTURAIS (código-fonte) confirmando que a query real
 * segue exatamente essa mesma regra, mesmo padrão já usado em
 * `test-client-registration-simplification.ts`. Todo o resto (avaliação de
 * saúde, agrupamento, contadores, filtro de gestor) usa as funções de
 * produção de verdade, nunca uma reimplementação paralela.
 *
 * Rodar: npx tsx scripts/test-operation-goal-filter.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "../src/lib/channel-spend";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "../src/lib/performance";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "../src/lib/client-plan";
import { AVAILABLE_TRAFFIC_CHANNELS, resolveClientMediaChannels, type TrafficChannel } from "../src/lib/traffic-channels";
import type { PerformanceGoal } from "../src/lib/performance-goals";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import {
  resolveOperationCpaPriorityGroup,
  groupClientsByOperationPriority,
  filterOperationTriageClients,
  summarizeOperationTriage,
} from "../src/lib/operation-triage";
import type { ClientOperationalState } from "../src/lib/client-operational-state";
import { resolveOperationChannel, resolveOperationGoal } from "../src/app/operation/page";

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
// 1 — Checagens estruturais da query real (population na query, não em
// memória; goal nunca substitui o filtro de canal; sem regra especial pra
// Seguidores).
// ---------------------------------------------------------------------------
console.log("1 — Query real: canal + objetivo compõem, goal nunca substitui canal, sem regra especial pra Seguidores\n");
{
  const loaderCode = stripComments(loadSource("src", "lib", "operation-channel-state-data.ts"));
  ok(
    "população continua filtrada por canal na query (.contains media_channels)",
    /\.contains\("media_channels", \[channel\]\)/.test(loaderCode),
  );
  ok(
    "objetivo filtra na MESMA query (.eq performance_goal), condicional a goal !== 'todos'",
    /if \(goal !== "todos"\) clientsQuery = clientsQuery\.eq\("performance_goal", goal\)/.test(loaderCode),
  );
  ok(
    "goal tem default 'todos' (nunca obrigatório só pra manter compatibilidade dos chamadores existentes)",
    /goal: PerformanceGoal \| "todos" = "todos"/.test(loaderCode),
  );
  ok(
    "nenhuma ramificação especial pra 'followers' dentro do loader (Seguidores passa pelo MESMO caminho genérico)",
    !/goal === "followers"|performance_goal === "followers"|=== "followers"/.test(loaderCode),
  );
  ok(
    "aggregatePerformanceResults continua recebendo channel (nunca 'instagram' nem nenhum canal hardcoded pra Seguidores)",
    /aggregatePerformanceResults\(performanceRowsByClient\.get\(client\.id\) \?\? \[\], client\.performance_goal, channel\)/.test(loaderCode),
  );
}

// ---------------------------------------------------------------------------
// 2 — resolveOperationGoal / resolveOperationChannel: URL como estado,
// fallback seguro, /operation sem parâmetros, valores inválidos.
// ---------------------------------------------------------------------------
console.log("\n2 — Estado na URL: fallback seguro, /operation sem parâmetros, parâmetro inválido\n");
{
  check("18/20 — sem parâmetro -> canal 'meta' (padrão já implementado)", resolveOperationChannel(undefined), "meta");
  check("18/20 — sem parâmetro -> objetivo 'todos' (padrão novo desta etapa)", resolveOperationGoal(undefined), "todos");
  check("19 — ?goal=leads -> 'leads'", resolveOperationGoal("leads"), "leads");
  check("19 — ?goal=sales -> 'sales'", resolveOperationGoal("sales"), "sales");
  check("19 — ?goal=followers -> 'followers'", resolveOperationGoal("followers"), "followers");
  check("19 — ?goal=todos -> 'todos'", resolveOperationGoal("todos"), "todos");
  check("19 — ?goal=vendas (português, valor inválido) -> cai no fallback seguro 'todos'", resolveOperationGoal("vendas"), "todos");
  check("19 — ?goal=awareness (nome que não existe na plataforma) -> cai no fallback seguro 'todos'", resolveOperationGoal("awareness"), "todos");
  check("19 — ?goal= (vazio) -> 'todos'", resolveOperationGoal(""), "todos");
  check("19 — ?channel=consolidated (valor antigo/inválido) continua caindo em 'meta'", resolveOperationChannel("consolidated"), "meta");
}

// ---------------------------------------------------------------------------
// 3 — Simulação fim-a-fim: canal + objetivo compõem população real,
// contadores/grupos refletem só a população resultante, gestor compõe por
// cima, Seguidores cai em 'sem_dados' sem virar CPL/CPA forçado.
// ---------------------------------------------------------------------------

interface FixtureClient {
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  mediaChannels: string[];
  performanceGoal: PerformanceGoal;
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[];
  records: PerformanceRecordRow[];
  planChanges: ClientPlanChangeRow[];
  legacyTarget: number | null;
}

const SPRINTS = [{ sprintId: "s1", start_date: "2026-09-01", end_date: "2026-09-30" }];
const OVERRIDES: SprintChannelSpendOverrideRow[] = [];

/** Réplica em memória da regra de DUAS ETAPAS da query real
 * (`loadOperationChannelStates`): canal primeiro (`media_channels`), depois
 * objetivo (`performance_goal`, só quando `goal !== "todos"`) — nunca a
 * ordem invertida, nunca objetivo substituindo canal. */
function selectPopulation(clients: FixtureClient[], channel: TrafficChannel, goal: PerformanceGoal | "todos"): FixtureClient[] {
  return clients
    .filter((c) => resolveClientMediaChannels(c.mediaChannels).includes(channel))
    .filter((c) => goal === "todos" || c.performanceGoal === goal);
}

/** Réplica da computação por cliente que `loadOperationChannelStates` faz —
 * mesmas funções de produção, mesmo formato de saída (`ClientOperationalState`). */
function evaluateForChannel(client: FixtureClient, channel: TrafficChannel): ClientOperationalState {
  const investmentActual = sumChannelEffectiveSpend(SPRINTS, channel, client.dailySpend, OVERRIDES);
  const investmentHasSyncedData = client.dailySpend.some((row) => row.channel === channel);
  const performanceResult = aggregatePerformanceResults(client.records, client.performanceGoal, channel);
  const costActual = computeCostPerResult(investmentHasSyncedData ? investmentActual : null, performanceResult.resultCount, performanceResult.hasAnyRecord);
  const plan = resolveClientMonthlyPlan({ channels: AVAILABLE_TRAFFIC_CHANNELS, changes: client.planChanges, selectedMonth: "2026-09-01" });
  const channelPlan = plan.byChannel[channel];
  const targetCostPerResult = resolveTargetCostPerResult({ channel, plan, legacyFallback: client.legacyTarget });

  const input: AccountHealthInput = {
    investmentActual,
    investmentPlanned: channelPlan?.investment ?? null,
    investmentHasSyncedData,
    resultActual: performanceResult.resultCount,
    resultPlanned: channelPlan?.resultCount ?? null,
    hasPerformanceData: performanceResult.hasAnyRecord,
    performanceGoalConfigured: true,
    costActual,
    costPlanned: targetCostPerResult,
    costScopeComparable: true,
    monthExpectedPct: 50,
    reviewBusinessDaysAgo: 5,
    reviewMaxBusinessDays: 10,
  };

  return {
    clientId: client.id,
    clientName: client.name,
    managerId: client.managerId,
    managerName: client.managerName,
    avatarUrl: null,
    performanceGoal: client.performanceGoal,
    evaluation: evaluateAccountHealth(input),
    overdueTasksCount: 0,
    openTasksCount: 0,
    lastDataSyncAt: null,
    performanceLatestSource: performanceResult.latestSource,
    performanceLastUpdatedAt: performanceResult.latestUpdatedAt,
    diagnostics: {
      planejamento: { items: [], isIncomplete: false },
      cpa: null,
      investment: { value: investmentActual, expected: null, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
      pendencias: { count: 0, items: [], hasPendencias: false },
      atividade: { lastActivityAt: null, hoursSinceLastActivity: null, isOverdue: false },
    },
  };
}

function buildPopulation(clients: FixtureClient[], channel: TrafficChannel, goal: PerformanceGoal | "todos"): ClientOperationalState[] {
  return selectPopulation(clients, channel, goal).map((c) => evaluateForChannel(c, channel));
}

// Cenário base: 5 clientes cobrindo leads/sales/followers, Meta/Google,
// dois gestores diferentes — reaproveitado pelos cenários 1-13.
const FIXTURE_CLIENTS: FixtureClient[] = [
  {
    id: "c1",
    name: "Clínica Vero (Leads, Meta+Google, saudável nos dois)",
    managerId: "vinicius",
    managerName: "Vinicius",
    mediaChannels: ["meta", "google"],
    performanceGoal: "leads",
    dailySpend: [
      { date: "2026-09-05", channel: "meta", spend: 300 },
      { date: "2026-09-05", channel: "google", spend: 200 },
    ],
    records: [
      { channel: "meta", resultType: "leads", resultCount: 15, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" },
      { channel: "google", resultType: "leads", resultCount: 10, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" },
    ],
    planChanges: [
      { channel: "meta", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 300, targetResultCount: 15 },
      { channel: "google", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 200, targetResultCount: 10 },
    ],
    legacyTarget: null,
  },
  {
    id: "c2",
    name: "Studio Fit (Vendas, só Meta, CPA grave)",
    managerId: "filipe",
    managerName: "Filipe",
    mediaChannels: ["meta"],
    performanceGoal: "sales",
    dailySpend: [{ date: "2026-09-05", channel: "meta", spend: 900 }],
    records: [{ channel: "meta", resultType: "sales", resultCount: 10, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" }],
    planChanges: [{ channel: "meta", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 500, targetResultCount: 10 }], // meta CPA 50, real 90 -> 80% acima, grave
    legacyTarget: null,
  },
  {
    id: "c3",
    name: "Loja Nima (Vendas, só Google, saudável)",
    managerId: "vinicius",
    managerName: "Vinicius",
    mediaChannels: ["google"],
    performanceGoal: "sales",
    dailySpend: [{ date: "2026-09-05", channel: "google", spend: 500 }],
    records: [{ channel: "google", resultType: "sales", resultCount: 10, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" }],
    planChanges: [{ channel: "google", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 500, targetResultCount: 10 }],
    legacyTarget: null,
  },
  {
    id: "c4",
    name: "Boutique Alma (Seguidores/Awareness, Meta, investimento real mas resultado vem do Instagram)",
    managerId: "filipe",
    managerName: "Filipe",
    mediaChannels: ["meta"],
    performanceGoal: "followers",
    dailySpend: [{ date: "2026-09-05", channel: "meta", spend: 352 }],
    // Resultado real de seguidores existe, mas é gravado com channel
    // "instagram" (fonte de resultado orgânico, nunca meta/google — ver
    // lib/traffic-channels.ts) — nunca bate com o filtro de canal
    // meta/google que a Operação usa.
    records: [{ channel: "instagram", resultType: "followers", resultCount: 144, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" }],
    planChanges: [],
    legacyTarget: null,
  },
  {
    id: "c5",
    name: "Padaria Trigo (Leads, só Meta, gestor Filipe)",
    managerId: "filipe",
    managerName: "Filipe",
    mediaChannels: ["meta"],
    performanceGoal: "leads",
    dailySpend: [{ date: "2026-09-05", channel: "meta", spend: 100 }],
    records: [{ channel: "meta", resultType: "leads", resultCount: 5, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" }],
    planChanges: [{ channel: "meta", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 100, targetResultCount: 5 }],
    legacyTarget: null,
  },
];

console.log("\n3 — Cenários 1-6: Canal x Objetivo (Todos/Leads/Vendas)\n");
{
  const metaTodos = buildPopulation(FIXTURE_CLIENTS, "meta", "todos");
  check("1 — Meta + Todos: c1,c2,c4,c5 (todo mundo com Meta em media_channels)", metaTodos.map((c) => c.clientId).sort(), ["c1", "c2", "c4", "c5"]);

  const googleTodos = buildPopulation(FIXTURE_CLIENTS, "google", "todos");
  check("2 — Google + Todos: c1,c3 (todo mundo com Google em media_channels)", googleTodos.map((c) => c.clientId).sort(), ["c1", "c3"]);

  const metaLeads = buildPopulation(FIXTURE_CLIENTS, "meta", "leads");
  check("3 — Meta + Leads: c1,c5 (Studio Fit/Vendas e Boutique Alma/Seguidores ficam de fora)", metaLeads.map((c) => c.clientId).sort(), ["c1", "c5"]);

  const googleLeads = buildPopulation(FIXTURE_CLIENTS, "google", "leads");
  check("4 — Google + Leads: c1 (Loja Nima é Vendas, fora)", googleLeads.map((c) => c.clientId).sort(), ["c1"]);

  const metaVendas = buildPopulation(FIXTURE_CLIENTS, "meta", "sales");
  check("5 — Meta + Vendas: c2 (Studio Fit)", metaVendas.map((c) => c.clientId).sort(), ["c2"]);

  const googleVendas = buildPopulation(FIXTURE_CLIENTS, "google", "sales");
  check("6 — Google + Vendas: c3 (Loja Nima)", googleVendas.map((c) => c.clientId).sort(), ["c3"]);
}

console.log("\n4 — Cenário 7: Seguidores/Awareness — população preservada, 'Sem dados' honesto, sem CPL/CPA forçado\n");
{
  const metaFollowers = buildPopulation(FIXTURE_CLIENTS, "meta", "followers");
  check("7 — Meta + Seguidores: c4 aparece na população (nunca some por 'não dar pra avaliar')", metaFollowers.map((c) => c.clientId), ["c4"]);

  const boutique = metaFollowers[0];
  check("7 — investimento Meta é o valor REAL sincronizado (352), nunca null/zero por falta de resultado", boutique.evaluation.dimensions.investment.actual, 352);
  check("7 — custo por resultado fica 'nenhum' (não 'grave'/'leve') — ausência de evidência nunca é performance ruim", boutique.evaluation.dimensions.cost.status, "nenhum");
  check("7 — hasPerformanceData é false: o resultado de Seguidores existe, mas sob channel='instagram', nunca visível pro recorte Meta/Google", boutique.evaluation.dimensions.results.hasPerformanceData, false);
  check("7 — balde final é 'sem_dados', nunca 'saudavel' fabricado nem CPA/CPL inventado", resolveOperationCpaPriorityGroup(boutique.evaluation), "sem_dados");

  const googleFollowers = buildPopulation(FIXTURE_CLIENTS, "google", "followers");
  check("7 — Google + Seguidores: nenhum cliente (Boutique Alma só opera Meta)", googleFollowers, []);
}

console.log("\n5 — Cenário 8-11: Canal + Objetivo + Gestor combinados, isolamento de população\n");
{
  const metaLeadsVinicius = filterOperationTriageClients(groupClientsByOperationPriority(buildPopulation(FIXTURE_CLIENTS, "meta", "leads")), {
    severity: "todos",
    managerId: "vinicius",
    query: "",
  });
  check("8 — Meta + Leads + Vinicius: só c1 (c5 é Leads/Meta mas do Filipe)", metaLeadsVinicius.map((c) => c.clientId), ["c1"]);

  const metaLeadsFilipe = filterOperationTriageClients(groupClientsByOperationPriority(buildPopulation(FIXTURE_CLIENTS, "meta", "leads")), {
    severity: "todos",
    managerId: "filipe",
    query: "",
  });
  check("8 — Meta + Leads + Filipe: só c5", metaLeadsFilipe.map((c) => c.clientId), ["c5"]);

  const googleVendasFilipe = filterOperationTriageClients(groupClientsByOperationPriority(buildPopulation(FIXTURE_CLIENTS, "google", "sales")), {
    severity: "todos",
    managerId: "filipe",
    query: "",
  });
  check("8 — Google + Vendas + Filipe: ninguém (Loja Nima/Vendas/Google é da Vinicius)", googleVendasFilipe, []);

  // 9 — cliente fora do canal não aparece: c3 (só Google) nunca aparece em nenhum recorte de Meta.
  ok("9 — c3 (só Google) nunca aparece em Meta + Todos", !buildPopulation(FIXTURE_CLIENTS, "meta", "todos").some((c) => c.clientId === "c3"));
  ok("9 — c2 (só Meta) nunca aparece em Google + Todos", !buildPopulation(FIXTURE_CLIENTS, "google", "todos").some((c) => c.clientId === "c2"));

  // 10 — cliente fora do objetivo não aparece: c2 (Vendas) nunca aparece em Meta+Leads.
  ok("10 — c2 (Vendas) nunca aparece em Meta + Leads", !buildPopulation(FIXTURE_CLIENTS, "meta", "leads").some((c) => c.clientId === "c2"));
  ok("10 — c1/c5 (Leads) nunca aparecem em Meta + Vendas", !buildPopulation(FIXTURE_CLIENTS, "meta", "sales").some((c) => c.clientId === "c1" || c.clientId === "c5"));

  // 11 — gestor de outro cliente não aparece quando gestor está filtrado.
  ok("11 — filtro Gestor=Vinicius nunca traz card do Filipe", !metaLeadsVinicius.some((c) => c.managerName === "Filipe"));
}

console.log("\n6 — Cenário 12-13: contadores e grupos refletem só a população filtrada\n");
{
  const metaLeadsPopulation = buildPopulation(FIXTURE_CLIENTS, "meta", "leads"); // c1 (saudável), c5 (saudável)
  const summary = summarizeOperationTriage(metaLeadsPopulation);
  check("12 — Meta + Leads: contador 'Todos' é 2, nunca os 4 clientes de Meta+Todos", summary.totalClients, 2);
  check("12 — Meta + Leads: nenhum crítico nesta população (Studio Fit/crítico é Vendas, fora)", summary.critico, 0);

  const metaTodosPopulation = buildPopulation(FIXTURE_CLIENTS, "meta", "todos"); // c1, c2(crítico), c4(sem dados), c5
  const summaryTodos = summarizeOperationTriage(metaTodosPopulation);
  check("12 — Meta + Todos: contador 'Todos' é 4 (a população maior, sem filtro de objetivo)", summaryTodos.totalClients, 4);
  check("12 — Meta + Todos: 1 crítico (Studio Fit)", summaryTodos.critico, 1);
  check("12 — Meta + Todos: 1 sem_dados (Boutique Alma/Seguidores)", summaryTodos.semDados, 1);

  const grouped = groupClientsByOperationPriority(metaTodosPopulation);
  check("13 — grupos refletem só a população passada — 4 cards, nunca mais", grouped.length, 4);
  check("13 — ordem: crítico primeiro (Studio Fit)", grouped[0].clientId, "c2");
  check("13 — sem_dados por último (Boutique Alma)", grouped[grouped.length - 1].clientId, "c4");
}

console.log("\n7 — Cenário 14-17: 'Sem dados', isolamento de canal, target e fallback continuam funcionando\n");
{
  const metaVendas = buildPopulation(FIXTURE_CLIENTS, "meta", "sales")[0]; // Studio Fit
  check("14/16 — Studio Fit: custo real (90) calculado corretamente a partir do investimento/resultado reais", metaVendas.evaluation.dimensions.cost.actual, 90);
  check("16 — Studio Fit: meta de custo (50) veio do plano do PRÓPRIO canal Meta, nunca inventada", metaVendas.evaluation.dimensions.cost.planned, 50);
  check("14 — Studio Fit: CPA 80% acima da meta -> 'grave' (crítico), nunca 'sem_dados' (há dado suficiente)", metaVendas.evaluation.dimensions.cost.status, "grave");

  // 17 — fallback de target: cliente sem plano de canal nenhum, só campo legado.
  const semPlano: FixtureClient = {
    ...FIXTURE_CLIENTS[1],
    id: "c6",
    name: "Cliente sem plano de canal, só legado",
    planChanges: [],
    legacyTarget: 60,
  };
  const semPlanoEval = evaluateForChannel(semPlano, "meta");
  check("17 — sem plano de canal/consolidado: meta de custo cai pro campo legado (60)", semPlanoEval.evaluation.dimensions.cost.planned, 60);
}

console.log("\n8 — Cenário 15: CPA/CPL não sofre contaminação entre canais (mesmo cliente, dois canais, dois resultados)\n");
{
  const metaEval = evaluateForChannel(FIXTURE_CLIENTS[0], "meta"); // Clínica Vero
  const googleEval = evaluateForChannel(FIXTURE_CLIENTS[0], "google");
  check("15 — investimento Meta (300) isolado do investimento Google (200)", metaEval.evaluation.dimensions.investment.actual, 300);
  check("15 — investimento Google (200) isolado do investimento Meta (300)", googleEval.evaluation.dimensions.investment.actual, 200);
  check("15 — resultado Meta (15 leads) isolado do resultado Google (10 leads)", metaEval.evaluation.dimensions.results.actual, 15);
  check("15 — resultado Google (10 leads) isolado do resultado Meta (15 leads)", googleEval.evaluation.dimensions.results.actual, 10);
  check("15 — custo Meta (300/15=20) nunca soma o investimento/resultado do Google", metaEval.evaluation.dimensions.cost.actual, 20);
  check("15 — custo Google (200/10=20) nunca soma o investimento/resultado do Meta", googleEval.evaluation.dimensions.cost.actual, 20);
}

console.log("\n9 — Cenário 21: Seguidores/Awareness nunca recebe regra de Leads/Vendas artificialmente\n");
{
  const boutique = evaluateForChannel(FIXTURE_CLIENTS[3], "meta");
  // Nunca deveria existir uma "meta de custo por seguidor" fabricada nem um
  // resultCount emprestado de outro objetivo — os dois ficam exatamente
  // como a ausência real de dado no escopo canal produz.
  check("21 — targetCostPerResult não é inventado (permanece null — sem plano de canal/consolidado/legado pra este cliente)", boutique.evaluation.dimensions.cost.planned, null);
  check("21 — resultActual é 0 (nunca emprestado de leads/vendas de outro cliente/canal)", boutique.evaluation.dimensions.results.actual, 0);
  check("21 — costActual é null (nunca um número calculado a partir de dado que não existe neste escopo)", boutique.evaluation.dimensions.cost.actual, null);
}

console.log(`\n${passed} verificações passaram.`);
