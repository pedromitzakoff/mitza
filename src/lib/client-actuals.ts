import { sumChannelEffectiveSpend, inferClientChannels, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { aggregatePerformanceResults, safeDivide, computeRoas, type PerformanceRecordRow } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { consolidateChannelMetrics, type ChannelMetrics, type ClientChannelMetrics } from "@/lib/channel-metrics";

/**
 * Primeiro dos dois resolvedores canônicos da plataforma no formato
 * `ClientChannelMetrics` (lib/channel-metrics.ts) — Etapa "Arquitetura
 * Multicanal Unificada" (o segundo é `resolveClientMonthlyPlan`,
 * lib/client-plan.ts, pro lado Planejado). Nunca reimplementa
 * investimento/resultado/receita: só reempacota `sumChannelEffectiveSpend`
 * (lib/channel-spend.ts) e `aggregatePerformanceResults` (lib/performance.ts),
 * as mesmas fontes já validadas, no objeto `{byChannel, consolidated}` que
 * passa a ser o único formato que qualquer tela deveria consumir.
 *
 * Consumido diretamente por `resolveClientChannelBreakdown`
 * (lib/client-channel-breakdown.ts, Etapa "Fundação Compartilhada") pro
 * investimento por canal — os loops por canal ainda próprios de
 * `operation-data.ts`/`analytics.ts` continuam fora desta etapa: cada um tem
 * nuances próprias (ex.: `metaAdAccountId` em `operation-data.ts`) que
 * precisam ser conferidas individualmente antes da troca.
 */
export function resolveClientMonthlyActuals(input: {
  sprints: { sprintId: string; start_date: string; end_date: string }[];
  dailySpendChannel: { date: string; channel: TrafficChannel; spend: number }[];
  channelSpendOverrides: SprintChannelSpendOverrideRow[];
  performanceRecords: PerformanceRecordRow[];
  performanceGoal: PerformanceGoal | null;
}): ClientChannelMetrics {
  const { sprints, dailySpendChannel, channelSpendOverrides, performanceRecords, performanceGoal } = input;

  // Mesma regra de sempre: só os canais que o cliente de fato usa (dado
  // sincronizado ou override manual), nunca uma lista fixa de canais
  // possíveis.
  const channels = inferClientChannels(dailySpendChannel, channelSpendOverrides);

  const byChannel: Partial<Record<TrafficChannel, ChannelMetrics>> = {};
  for (const channel of channels) {
    const investment = sumChannelEffectiveSpend(sprints, channel, dailySpendChannel, channelSpendOverrides);
    const aggregated = performanceGoal ? aggregatePerformanceResults(performanceRecords, performanceGoal, channel) : null;
    // `hasAnyRecord: false` vira `resultCount: null` aqui (nunca o `0` que
    // `aggregatePerformanceResults` usa como valor de preenchimento interno)
    // — "sem nenhum registro" e "0 resultados registrados" continuam
    // estados diferentes, agora dentro do objeto canônico.
    const resultCount = aggregated?.hasAnyRecord ? aggregated.resultCount : null;
    const revenue = aggregated?.hasAnyRecord ? aggregated.revenue : null;

    byChannel[channel] = {
      investment,
      resultCount,
      revenue,
      cpa: safeDivide(investment, resultCount),
      roas: computeRoas(revenue, investment),
    };
  }

  return {
    byChannel,
    consolidated: consolidateChannelMetrics(channels, byChannel),
  };
}
