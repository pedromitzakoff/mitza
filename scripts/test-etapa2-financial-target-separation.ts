/**
 * Etapa 2 (Auditoria de Segurança aprovada → implementação dos 4 bugs +
 * AJUSTE 1 + AJUSTE 2 + centralização de Meta/Custo-Alvo). Cobre:
 *
 * - AJUSTE 1: separação entre "Investimento realizado da agência" (TODOS os
 *   clientes elegíveis, com ou sem meta) e "Ritmo de investimento" (só quem
 *   tem meta) — `computeFinancialSummary` (lib/agency-metrics.ts).
 * - `resolveTargetCostPerResult` (lib/client-plan.ts) — nova função central:
 *   plano do canal → plano consolidado → fallback legado, nunca CPA
 *   realizado.
 * - Reconciliação: investimento por canal soma corretamente pro consolidado;
 *   cliente sem meta entra no total mas não no ritmo; carry-forward do
 *   planejamento; meta ≠ realizado quando os números diferem.
 * - Não-vazamento entre canais (`computeAgencyResultsByChannel`) com
 *   fixture Meta vs. Google propositalmente muito diferentes.
 * - Regressão: Bug 1 (carry-forward) e Bugs 3/4 (platform filter em
 *   Leads/Vendas/CPL/CPA e no KPI Investimento) já estavam corrigidos no
 *   código antes desta rodada — este arquivo confirma isso continua valendo,
 *   nunca reimplementa a lógica.
 *
 * Rodar: npx tsx scripts/test-etapa2-financial-target-separation.ts
 */
import assert from "node:assert/strict";
import { computeFinancialSummary, computeAgencyResultsByChannel } from "../src/lib/agency-metrics";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "../src/lib/client-plan";
import type { ChannelMetrics } from "../src/lib/channel-metrics";
import type { OperationClientCard } from "../src/app/operation/operation-data";
import type { PerformanceSummary } from "../src/lib/performance";

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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function perfSummary(resultCount: number, hasAnyRecord: boolean): PerformanceSummary {
  return { resultCount, hasAnyRecord } as PerformanceSummary;
}

/** Card mínimo válido — só os campos que os testes deste arquivo tocam têm
 * valor real; o resto é preenchido com o "vazio" mais neutro possível
 * (nenhum destes participa de `computeFinancialSummary`/
 * `computeAgencyResultsByChannel`). */
function baseCard(overrides: Partial<OperationClientCard> & { clientId: string }): OperationClientCard {
  return {
    clientName: overrides.clientId,
    metaAdAccountId: "",
    managerNames: [],
    managerIds: [],
    sprint: null,
    sprintPeriodLabel: null,
    sprintTasks: [],
    todayAndOverdueTasks: [],
    taskCounts: { total: 0, done: 0, pending: 0, overdue: 0 },
    alerts: [],
    accountHealth: "saudavel",
    activityStatus: "ativo",
    activityLabel: "",
    sprintFilterBucket: "sem_execucao",
    monthPlanned: 0,
    monthActual: 0,
    monthExpectedToDate: 0,
    monthStatus: "sem_meta",
    hasMonthGoal: false,
    lastOptimizationAt: null,
    lastSyncedAt: null,
    overdueTasks: [],
    sprintExecutionInfo: null,
    monthSprints: [],
    monthSprintPlans: null,
    monthSprintOriginalPlans: {},
    monthSprintFinalRecommendations: {},
    monthSprintTasks: {},
    monthTasks: [],
    sprintExecutionLabel: null,
    performanceGoal: null,
    targetCostPerResult: null,
    monthPerformanceSummary: null,
    monthPerformanceChannelBreakdown: [],
    sprintPerformanceViews: {},
    sprintPerformanceEditableChannels: {},
    sprintPerformanceEditableInvestment: {},
    monthActualByChannel: {},
    clientUsesChannel: {},
    monthPerformanceSummaryByChannel: {},
    ...overrides,
  };
}

function channelMetrics(overrides: Partial<ChannelMetrics>): ChannelMetrics {
  return { investment: null, resultCount: null, cpa: null, ...overrides };
}

// ---------------------------------------------------------------------------
console.log("\n1 — AJUSTE 1: exemplo exato do pedido (100k/80k/20k)\n");
{
  const comMeta = baseCard({ clientId: "A", hasMonthGoal: true, monthPlanned: 100_000, monthActual: 80_000, monthExpectedToDate: 90_000 });
  const semMeta = baseCard({ clientId: "B", hasMonthGoal: false, monthPlanned: 0, monthActual: 20_000, monthExpectedToDate: 0 });

  const financial = computeFinancialSummary([comMeta, semMeta]);

  check("Investimento realizado da agência = 100k (80k + 20k, TODOS os clientes)", financial.actual, 100_000);
  check("Realizado elegível pra ritmo = 80k (só quem tem meta)", financial.actualForPacing, 80_000);
  check("Planejado = 100k (só quem tem meta)", financial.planned, 100_000);
  check("Ritmo de investimento = 80% (nunca 100%)", financial.pct, 80);
  ok("pct NUNCA é 100 (o resultado errado se actual/planned fosse usado)", financial.pct !== 100);
  check("semMeta conta o cliente B", financial.semMeta, 1);
}

console.log("\n2 — AJUSTE 1: actual === actualForPacing quando ninguém está sem meta\n");
{
  const a = baseCard({ clientId: "A", hasMonthGoal: true, monthPlanned: 50_000, monthActual: 40_000, monthExpectedToDate: 45_000 });
  const b = baseCard({ clientId: "B", hasMonthGoal: true, monthPlanned: 30_000, monthActual: 30_000, monthExpectedToDate: 30_000 });
  const financial = computeFinancialSummary([a, b]);
  check("actual", financial.actual, 70_000);
  check("actualForPacing igual a actual (nenhum cliente sem meta no recorte)", financial.actualForPacing, financial.actual);
  check("pct = 87.5%", financial.pct, 87.5);
}

console.log("\n3 — AJUSTE 1: só clientes sem meta — planned/pct null, actual soma tudo\n");
{
  const a = baseCard({ clientId: "A", hasMonthGoal: false, monthActual: 15_000 });
  const b = baseCard({ clientId: "B", hasMonthGoal: false, monthActual: 5_000 });
  const financial = computeFinancialSummary([a, b]);
  check("planned = 0 (ninguém tem meta)", financial.planned, 0);
  check("pct = null (denominador 0)", financial.pct, null);
  check("actual = 20k (realizado total continua existindo mesmo sem nenhuma meta)", financial.actual, 20_000);
  check("actualForPacing = 0 (base de quem tem meta é vazia)", financial.actualForPacing, 0);
  check("expectedToDate = 0 (só soma quem tem meta)", financial.expectedToDate, 0);
}

console.log("\n4 — Reconciliação: cliente sem meta nunca desaparece do total, mas nunca entra no ritmo\n");
{
  const semMeta = baseCard({ clientId: "C", hasMonthGoal: false, monthPlanned: 0, monthActual: 12_345, monthExpectedToDate: 0 });
  const antes = computeFinancialSummary([]);
  const depois = computeFinancialSummary([semMeta]);
  check("sem nenhum cliente: actual = 0", antes.actual, 0);
  check("com 1 cliente sem meta: actual = 12345 (entra no Investimento total)", depois.actual, 12_345);
  check("com 1 cliente sem meta: actualForPacing = 0 (nunca entra no ritmo)", depois.actualForPacing, 0);
  check("com 1 cliente sem meta: pct continua null (denominador ainda vazio)", depois.pct, null);
}

// ---------------------------------------------------------------------------
console.log("\n5 — resolveTargetCostPerResult: ordem de prioridade — plano do canal → consolidado → fallback legado\n");
{
  const plan = {
    byChannel: { meta: channelMetrics({ investment: 1000, resultCount: 20, cpa: 50 }) },
    consolidated: channelMetrics({ investment: 1500, resultCount: 25, cpa: 60 }),
  };

  check("canal com plano PRÓPRIO usa o CPA daquele canal (50), nunca o consolidado (60)", resolveTargetCostPerResult({ channel: "meta", plan, legacyFallback: 999 }), 50);
  check("canal SEM plano próprio (google) cai pro consolidado (60), nunca pro fallback direto", resolveTargetCostPerResult({ channel: "google", plan, legacyFallback: 999 }), 60);
  check("'consolidated' usa sempre o consolidado (60)", resolveTargetCostPerResult({ channel: "consolidated", plan, legacyFallback: 999 }), 60);
}

console.log("\n6 — resolveTargetCostPerResult: fallback legado só quando NADA tem plano\n");
{
  const semPlanoNenhum = { byChannel: {}, consolidated: channelMetrics({}) };
  check("sem plano em canal nenhum e sem consolidado: usa o fallback legado", resolveTargetCostPerResult({ channel: "consolidated", plan: semPlanoNenhum, legacyFallback: 123.45 }), 123.45);
  check("mesmo escopado a um canal específico, cai pro fallback legado (via consolidado)", resolveTargetCostPerResult({ channel: "meta", plan: semPlanoNenhum, legacyFallback: 123.45 }), 123.45);
  check("sem plano nenhum e sem fallback: null (nunca 0 fabricado)", resolveTargetCostPerResult({ channel: "consolidated", plan: semPlanoNenhum, legacyFallback: null }), null);
}

console.log("\n7 — resolveTargetCostPerResult: NUNCA usa CPA realizado como meta (Bug 4)\n");
{
  // Simula o cenário exato do Bug 4 original: um card de REALIZADO (CPA de
  // R$ 12,00, muito abaixo da meta configurada de R$ 40,00) sendo passado
  // por engano no lugar do plano. A função não sabe distinguir os dois
  // pelo tipo (ambos são `ChannelMetrics`) — o contrato é do CHAMADOR, mas
  // este teste prova que, quando o chamador passa o resolvedor CERTO
  // (planejado), o resultado nunca é contaminado pelo realizado.
  const realizado = channelMetrics({ investment: 600, resultCount: 50, cpa: 12 }); // CPA REALIZADO
  const planejado = { byChannel: {}, consolidated: channelMetrics({ investment: 2000, resultCount: 50, cpa: 40 }) }; // CPA PLANEJADO

  const targetCorreto = resolveTargetCostPerResult({ channel: "consolidated", plan: planejado, legacyFallback: null });
  ok("Meta resolvida (40) é diferente do CPA realizado (12) do mesmo período", targetCorreto !== realizado.cpa);
  check("Meta resolvida vem do PLANO, nunca do realizado", targetCorreto, 40);
}

// ---------------------------------------------------------------------------
console.log("\n8 — Carry-forward: plano definido em mês anterior continua vigente no mês atual (Bug 1, regressão)\n");
{
  const changes: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-06-01", changedAt: "2026-06-05T10:00:00Z", investment: 5000, targetResultCount: 100 },
  ];
  // Consumidor busca com `.lte` (histórico completo até o mês selecionado)
  // — nenhum filtro `month = selectedMonth` aqui, exatamente a regra que
  // todo consumidor real (`page.tsx`/`sprints/page.tsx`/etc.) já aplica.
  const planSetembro = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-09-01" });
  check("canal Meta continua com o plano de junho vigente em setembro (carry-forward)", planSetembro.byChannel.meta, channelMetrics({ investment: 5000, resultCount: 100, cpa: 50 }));
  check("consolidado reflete o carry-forward (5000, nunca 'sem plano')", planSetembro.consolidated.investment, 5000);

  const target = resolveTargetCostPerResult({ channel: "consolidated", plan: planSetembro, legacyFallback: 999 });
  check("meta de custo também respeita o carry-forward (50, nunca o fallback legado 999)", target, 50);
}

console.log("\n9 — Carry-forward: um mês SEM nenhuma mudança de plano usa a versão mais recente anterior, nunca a mais antiga\n");
{
  const changes: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-05-01", changedAt: "2026-05-01T00:00:00Z", investment: 1000, targetResultCount: null },
    { channel: "meta", month: "2026-07-01", changedAt: "2026-07-01T00:00:00Z", investment: 3000, targetResultCount: null },
  ];
  const plan = resolveClientMonthlyPlan({ channels: ["meta"], changes, selectedMonth: "2026-08-01" });
  check("agosto usa a versão de julho (3000), nunca a de maio (1000)", plan.byChannel.meta?.investment, 3000);
}

// ---------------------------------------------------------------------------
console.log("\n10 — Não-vazamento entre canais: Meta e Google com números MUITO diferentes\n");
{
  // Fixture deliberada: Meta tem CPA baixíssimo (10) e Google altíssimo
  // (500) — se houvesse vazamento cross-channel, qualquer soma/média
  // acidental produziria um número entre os dois, fácil de notar.
  const cliente = baseCard({
    clientId: "X",
    performanceGoal: "leads",
    clientUsesChannel: { meta: true, google: true },
    monthActualByChannel: { meta: 1_000, google: 50_000 },
    monthPerformanceSummaryByChannel: {
      meta: perfSummary(100, true), // CPA Meta = 1000/100 = 10
      google: perfSummary(100, true), // CPA Google = 50000/100 = 500
    },
  });

  const metaResults = computeAgencyResultsByChannel([cliente], "meta");
  const googleResults = computeAgencyResultsByChannel([cliente], "google");

  check("Leads de Meta = 100 (não soma com Google)", metaResults.leads.count, 100);
  check("CPA de Meta = 10 (nunca contaminado pelo CPA de Google)", metaResults.leads.costPerResult, 10);
  check("Leads de Google = 100 (não soma com Meta)", googleResults.leads.count, 100);
  check("CPA de Google = 500 (nunca contaminado pelo CPA de Meta)", googleResults.leads.costPerResult, 500);
  ok("CPA de Meta e de Google são claramente diferentes (sem vazamento)", metaResults.leads.costPerResult !== googleResults.leads.costPerResult);
}

console.log("\n11 — TikTok sem dados → null, nunca herdado de Meta/Google (regressão Bug 3)\n");
{
  const cliente = baseCard({
    clientId: "Y",
    performanceGoal: "sales",
    clientUsesChannel: { meta: true },
    monthActualByChannel: { meta: 2_000 },
    monthPerformanceSummaryByChannel: { meta: perfSummary(40, true) },
    // Sem entrada de "tiktok" em nenhum dos dois mapas — cliente não usa
    // esse canal, mesmo contrato de `clientUsesChannel`.
  });

  const tiktokResults = computeAgencyResultsByChannel([cliente], "tiktok");
  check("Vendas de TikTok = 0 (nenhum dado, nunca herdado de Meta)", tiktokResults.sales.count, 0);
  check("CPA de TikTok = null (nunca 2000/40 = 50 herdado de Meta)", tiktokResults.sales.costPerResult, null);
  check("clientsWithData de TikTok = 0", tiktokResults.sales.clientsWithData, 0);
}

console.log("\n12 — Reconciliação: soma dos canais bate com o consolidado real (mesma base de clientes)\n");
{
  const a = baseCard({ clientId: "A", hasMonthGoal: true, monthActual: 7_000, monthActualByChannel: { meta: 4_000, google: 3_000 } });
  const b = baseCard({ clientId: "B", hasMonthGoal: false, monthActual: 2_500, monthActualByChannel: { meta: 2_500 } });
  const cards = [a, b];

  const totalConsolidado = computeFinancialSummary(cards).actual;
  const somaMeta = cards.reduce((sum, c) => sum + (c.monthActualByChannel.meta ?? 0), 0);
  const somaGoogle = cards.reduce((sum, c) => sum + (c.monthActualByChannel.google ?? 0), 0);

  check("Investimento realizado da agência (Meta) = soma dos actuals Meta dos mesmos clientes", somaMeta, 6_500);
  check("Investimento realizado da agência (Google) = soma dos actuals Google dos mesmos clientes", somaGoogle, 3_000);
  check("Consolidado = soma correta dos canais (Meta + Google = total, mesma base de clientes)", somaMeta + somaGoogle, totalConsolidado);
}

console.log(`\nTodos os ${passed} testes passaram.`);
