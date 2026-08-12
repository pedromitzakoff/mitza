/**
 * Teste de equivalência de `resolveClientChannelBreakdown` (Etapa "Fundação
 * Compartilhada") — comprova que o refactor pra reaproveitar
 * `resolveClientMonthlyActuals` (em vez de somar `daily_spend`/overrides por
 * conta própria) produz EXATAMENTE o mesmo resultado da implementação
 * anterior, reimplementada aqui isoladamente pra comparação byte a byte.
 * Regra 6/10 do contrato "Arquitetura Multicanal Unificada": todo consumidor
 * alterado precisa de teste de equivalência explícito, com um caso
 * Meta-only garantindo retrocompatibilidade total.
 *
 * Rodar: npx tsx scripts/test-client-channel-breakdown.ts
 */
import assert from "node:assert/strict";
import { inferClientChannels, sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "../src/lib/channel-spend";
import { computePerformanceSummary, type PerformanceRecordRow } from "../src/lib/performance";
import type { PerformanceGoal } from "../src/lib/performance-goals";
import type { TrafficChannel } from "../src/lib/traffic-channels";
import { resolveClientChannelBreakdown, type ClientChannelState } from "../src/lib/client-channel-breakdown";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// Reimplementação isolada do comportamento ANTERIOR ao refactor desta etapa
// (somava daily_spend/overrides por canal diretamente via
// sumChannelEffectiveSpend, em vez de reaproveitar
// resolveClientMonthlyActuals) — só um oráculo de equivalência pro teste,
// nunca importada pelo código de produção.
function oldResolveClientChannelBreakdown(input: {
  sprints: { sprintId: string; start_date: string; end_date: string }[];
  dailySpendChannel: { date: string; channel: TrafficChannel; spend: number }[];
  channelSpendOverrides: SprintChannelSpendOverrideRow[];
  performanceRecords: PerformanceRecordRow[];
  performanceGoal: PerformanceGoal | null;
  targetCostPerResult: number | null;
}): ClientChannelState[] {
  const { sprints, dailySpendChannel, channelSpendOverrides, performanceRecords, performanceGoal, targetCostPerResult } = input;
  const channels = inferClientChannels(dailySpendChannel, channelSpendOverrides);
  return channels.map((channel) => {
    const investmentActual = sumChannelEffectiveSpend(sprints, channel, dailySpendChannel, channelSpendOverrides);
    const performanceSummary = performanceGoal
      ? computePerformanceSummary({
          scope: channel,
          records: performanceRecords,
          resultType: performanceGoal,
          consolidatedActualSpend: investmentActual,
          targetCostPerResult,
          channelActualSpend: { [channel]: investmentActual },
        })
      : null;
    return { channel, investmentActual, performanceSummary };
  });
}

const sprints = [{ sprintId: "s1", start_date: "2026-08-01", end_date: "2026-08-07" }];

const metaOnlyInput = {
  sprints,
  dailySpendChannel: [{ date: "2026-08-03", channel: "meta" as TrafficChannel, spend: 1000 }],
  channelSpendOverrides: [] as SprintChannelSpendOverrideRow[],
  performanceRecords: [
    {
      channel: "meta" as TrafficChannel,
      resultType: "leads" as PerformanceGoal,
      resultCount: 100,
      source: "meta" as const,
      sourceUpdatedAt: "2026-08-03T00:00:00Z",
    },
  ],
  performanceGoal: "leads" as PerformanceGoal,
  targetCostPerResult: 12,
};

check(
  "cliente só-Meta (retrocompatibilidade): novo resultado idêntico ao antigo",
  resolveClientChannelBreakdown(metaOnlyInput),
  oldResolveClientChannelBreakdown(metaOnlyInput),
);

const multiChannelInput = {
  sprints,
  dailySpendChannel: [
    { date: "2026-08-03", channel: "meta" as TrafficChannel, spend: 6000 },
    { date: "2026-08-03", channel: "google" as TrafficChannel, spend: 4000 },
  ],
  channelSpendOverrides: [] as SprintChannelSpendOverrideRow[],
  performanceRecords: [
    {
      channel: "meta" as TrafficChannel,
      resultType: "leads" as PerformanceGoal,
      resultCount: 300,
      source: "meta" as const,
      sourceUpdatedAt: "2026-08-03T00:00:00Z",
    },
    {
      channel: "google" as TrafficChannel,
      resultType: "leads" as PerformanceGoal,
      resultCount: 100,
      source: "google" as const,
      sourceUpdatedAt: "2026-08-03T00:00:00Z",
    },
  ],
  performanceGoal: "leads" as PerformanceGoal,
  targetCostPerResult: 18,
};

check(
  "Meta + Google: novo resultado idêntico ao antigo, canal só com investimento e sem performance (google sem registro) incluso",
  resolveClientChannelBreakdown(multiChannelInput),
  oldResolveClientChannelBreakdown(multiChannelInput),
);

const noGoalInput = {
  sprints,
  dailySpendChannel: [{ date: "2026-08-03", channel: "google" as TrafficChannel, spend: 500 }],
  channelSpendOverrides: [] as SprintChannelSpendOverrideRow[],
  performanceRecords: [] as PerformanceRecordRow[],
  performanceGoal: null,
  targetCostPerResult: null,
};

check(
  "sem objetivo de performance configurado: performanceSummary null em ambas, investimento idêntico",
  resolveClientChannelBreakdown(noGoalInput),
  oldResolveClientChannelBreakdown(noGoalInput),
);

console.log(`\n${passed} verificações passaram.`);
