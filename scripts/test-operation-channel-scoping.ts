/**
 * Testes da Etapa "Operação por Canal" — cobre exatamente os pontos listados
 * na auditoria antes da implementação:
 *
 * 1. Isolamento entre canais: investimento (`sumChannelEffectiveSpend`) e
 *    resultado (`aggregatePerformanceResults`) do MESMO cliente, com dado
 *    de Meta e Google misturado no mesmo array bruto, nunca vazam um pro
 *    outro.
 * 2. Meta de custo por canal (`resolveTargetCostPerResult`) segue a cadeia
 *    de fallback aprovada (decisão do usuário): canal próprio → consolidado
 *    → legado — nunca "Sem dados" só por faltar meta própria do canal
 *    quando uma das duas fontes seguintes existe.
 * 3. Simulação fim-a-fim de UM cliente com Meta saudável e Google sem
 *    nenhum dado (o cenário real da Clarissa Ceschi que motivou esta
 *    etapa) — usando as MESMAS funções puras que `loadOperationChannelStates`
 *    (lib/operation-channel-state-data.ts) chama, montadas aqui manualmente
 *    (esta suíte não tem acesso a um Supabase de teste, então recompõe o
 *    pipeline com fixtures em vez de mockar o banco — mesmo espírito de
 *    `scripts/test-operation-priority-grouping.ts`, que também usa o motor
 *    de verdade sobre fixtures em vez de um cliente real). Confirma que
 *    Google vira 'sem_dados' e Meta continua 'saudavel' ao mesmo tempo, pro
 *    MESMO cliente — nenhuma contaminação entre as duas avaliações.
 * 4. População por canal: `resolveClientMediaChannels` (a mesma fonte que
 *    `clients.media_channels` alimenta) — um cliente sem o canal configurado
 *    nunca deveria ser candidato a aparecer nesse canal (espelha o filtro
 *    `.contains("media_channels", [channel])` da query real).
 * 5. `resolveOperationChannel` (app/operation/page.tsx) — nunca produz
 *    "consolidated"; padrão é sempre Meta; só "google" explícito na
 *    querystring muda o canal.
 *
 * Rodar: npx tsx scripts/test-operation-channel-scoping.ts
 */
import assert from "node:assert/strict";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "../src/lib/channel-spend";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "../src/lib/performance";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "../src/lib/client-plan";
import { resolveClientMediaChannels } from "../src/lib/traffic-channels";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import { resolveOperationCpaPriorityGroup, describeOperationCpaReason } from "../src/lib/operation-triage";
import { resolveOperationChannel } from "../src/app/operation/page";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("Isolamento entre canais (investimento e resultado)\n");

{
  // Mesmo cliente, mesmo array bruto de `daily_spend` — Meta e Google
  // misturados, exatamente como a query real devolve antes de ser
  // recortada por canal.
  const sprints = [{ sprintId: "s1", start_date: "2026-09-01", end_date: "2026-09-30" }];
  const dailySpend = [
    { date: "2026-09-05", channel: "meta" as const, spend: 300 },
    { date: "2026-09-15", channel: "meta" as const, spend: 300 },
    { date: "2026-09-10", channel: "google" as const, spend: 150 },
  ];
  const overrides: SprintChannelSpendOverrideRow[] = [];

  check("investimento Meta soma só as linhas de Meta (600)", sumChannelEffectiveSpend(sprints, "meta", dailySpend, overrides), 600);
  check("investimento Google soma só as linhas de Google (150), nunca soma Meta", sumChannelEffectiveSpend(sprints, "google", dailySpend, overrides), 150);
}

{
  const records: PerformanceRecordRow[] = [
    { channel: "meta", resultType: "leads", resultCount: 30, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" },
    { channel: "google", resultType: "leads", resultCount: 8, source: "manual", sourceUpdatedAt: "2026-09-14T09:00:00Z" },
    // "sales" nunca deveria contar pra um cliente de leads — cobre o filtro por `resultType` junto do de `channel`.
    { channel: "meta", resultType: "sales", resultCount: 99, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" },
  ];

  const metaResult = aggregatePerformanceResults(records, "leads", "meta");
  const googleResult = aggregatePerformanceResults(records, "leads", "google");
  check("resultado Meta conta só as 30 linhas de Meta/leads, nunca as vendas nem o Google", metaResult.resultCount, 30);
  check("resultado Google conta só as 8 linhas de Google/leads, nunca vaza da Meta", googleResult.resultCount, 8);
}

console.log("\nMeta de custo por canal — cadeia de fallback (canal próprio → consolidado → legado)\n");

{
  const changes: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 600, targetResultCount: 30 },
    // Google sem nenhuma versão de plano lançada pra este mês.
  ];
  const plan = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-09-01" });

  check("Meta tem meta própria: 600/30 = 20", plan.byChannel.meta?.cpa, 20);
  check("Google não tem meta própria (byChannel.google.cpa é null)", plan.byChannel.google?.cpa, null);
  check("consolidado soma só o que tem plano (Meta) — 20", plan.consolidated.cpa, 20);

  check(
    "meta de custo do canal Meta usa a própria (20), nunca cai pro consolidado/legado",
    resolveTargetCostPerResult({ channel: "meta", plan, legacyFallback: 999 }),
    20,
  );
  check(
    "meta de custo do canal Google, sem meta própria, cai pro CONSOLIDADO (20) — nunca pula direto pro legado",
    resolveTargetCostPerResult({ channel: "google", plan, legacyFallback: 999 }),
    20,
  );
}

{
  // Nenhum canal tem plano nenhum — única fonte restante é o campo legado do cliente.
  const plan = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes: [], selectedMonth: "2026-09-01" });
  check("sem nenhum plano em nenhum canal, consolidado.cpa é null", plan.consolidated.cpa, null);
  check(
    "meta de custo cai pro campo legado (25) quando nem canal nem consolidado existem",
    resolveTargetCostPerResult({ channel: "google", plan, legacyFallback: 25 }),
    25,
  );
  check(
    "sem plano nenhum E sem legado, meta de custo é null (ausência real, nunca fabricada)",
    resolveTargetCostPerResult({ channel: "meta", plan, legacyFallback: null }),
    null,
  );
}

console.log("\nSimulação fim-a-fim: Meta saudável e Google sem dados, mesmo cliente, nenhuma contaminação\n");

{
  // Réplica fiel do cenário real que motivou esta etapa (Clarissa Ceschi):
  // Google tem orçamento PLANEJADO mas nenhum dado real lançado ainda; Meta
  // está com investimento/resultado sincronizados e dentro da meta.
  const sprints = [{ sprintId: "s1", start_date: "2026-09-01", end_date: "2026-09-30" }];
  const dailySpend = [
    { date: "2026-09-05", channel: "meta" as const, spend: 300 },
    { date: "2026-09-15", channel: "meta" as const, spend: 300 },
    // Google: nenhuma linha de `daily_spend` — nunca sincronizado, nunca lançado manualmente.
  ];
  const overrides: SprintChannelSpendOverrideRow[] = [];
  const records: PerformanceRecordRow[] = [
    { channel: "meta", resultType: "leads", resultCount: 30, source: "manual", sourceUpdatedAt: "2026-09-16T12:00:00Z" },
    // Google: nenhum registro de performance.
  ];
  const planChanges: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-09-01", changedAt: "2026-08-25T00:00:00Z", investment: 600, targetResultCount: 30 },
    // Google não tem NENHUMA versão de plano — nem orçamento configurado ainda.
  ];
  const legacyFallback = 25;
  const clientMonthlyPlan = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes: planChanges, selectedMonth: "2026-09-01" });

  function evaluateChannel(channel: "meta" | "google") {
    const investmentActual = sumChannelEffectiveSpend(sprints, channel, dailySpend, overrides);
    const investmentHasSyncedData = dailySpend.some((row) => row.channel === channel);
    const performanceResult = aggregatePerformanceResults(records, "leads", channel);
    const costActual = computeCostPerResult(investmentHasSyncedData ? investmentActual : null, performanceResult.resultCount, performanceResult.hasAnyRecord);
    const channelPlan = clientMonthlyPlan.byChannel[channel];
    const targetCostPerResult = resolveTargetCostPerResult({ channel, plan: clientMonthlyPlan, legacyFallback });

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
    return evaluateAccountHealth(input);
  }

  const metaEvaluation = evaluateChannel("meta");
  const googleEvaluation = evaluateChannel("google");

  check("Meta: dataQuality sem lacuna (tudo sincronizado/configurado)", metaEvaluation.dimensions.dataQuality.status, "nenhum");
  check("Meta: CPA em cima da meta -> balde 'saudavel'", resolveOperationCpaPriorityGroup(metaEvaluation), "saudavel");
  check("Meta: sem motivo de alerta (conta saudável)", describeOperationCpaReason(metaEvaluation), null);

  check("Google: dataQuality COM lacuna (sem investimento sincronizado, sem plano próprio, sem performance)", googleEvaluation.dimensions.dataQuality.status, "grave");
  check("Google: balde 'sem_dados' — nunca 'critico', mesmo com meta de custo (fallback) presente", resolveOperationCpaPriorityGroup(googleEvaluation), "sem_dados");
  check(
    "Google: mesmo cliente da Meta saudável — a lacuna de um canal nunca contamina a avaliação do outro",
    resolveOperationCpaPriorityGroup(metaEvaluation) !== resolveOperationCpaPriorityGroup(googleEvaluation),
    true,
  );
}

console.log("\nPopulação por canal — cliente sem o canal configurado nunca é candidato\n");

{
  check("cliente só com Meta configurado não inclui Google", resolveClientMediaChannels(["meta"]).includes("google"), false);
  check("cliente com Meta e Google configurados inclui os dois", resolveClientMediaChannels(["meta", "google"]).includes("google"), true);
  check(
    "cliente sem nenhum canal válido cadastrado cai pro fallback ['meta'] (nunca ['google'] fabricado)",
    resolveClientMediaChannels([]),
    ["meta"],
  );
}

console.log("\nresolveOperationChannel (app/operation/page.tsx) — nunca 'consolidated', padrão Meta\n");

{
  check("sem parâmetro na URL -> 'meta' (padrão da tela)", resolveOperationChannel(undefined), "meta");
  check("?channel=google -> 'google'", resolveOperationChannel("google"), "google");
  check("?channel=meta -> 'meta'", resolveOperationChannel("meta"), "meta");
  check("valor inválido/antigo (?channel=consolidated) nunca é aceito -> cai pro padrão 'meta'", resolveOperationChannel("consolidated"), "meta");
}

console.log(`\n${passed} verificações passaram.`);
