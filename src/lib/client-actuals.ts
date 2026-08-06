import { sumChannelEffectiveSpend, inferClientChannels, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { aggregatePerformanceResults, safeDivide, computeRoas, type PerformanceRecordRow } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { consolidateChannelMetrics, type ChannelMetrics, type ClientMetrics } from "@/lib/channel-metrics";

/**
 * Primeiro resolvedor do domínio Realizado no formato canônico
 * (`ClientMetrics`, lib/channel-metrics.ts) — Etapa "Arquitetura Multicanal
 * Unificada". Nunca reimplementa investimento/resultado/receita: só
 * reempacota `sumChannelEffectiveSpend` (lib/channel-spend.ts) e
 * `aggregatePerformanceResults` (lib/performance.ts), as mesmas fontes já
 * validadas, no objeto `{byChannel, consolidated}` que passa a ser o único
 * formato que qualquer tela deveria consumir.
 *
 * Convivência com o código existente: esta função é ADITIVA — não substitui
 * `resolveClientChannelBreakdown` (lib/client-channel-breakdown.ts, hoje
 * consumido pela Visão Geral pra diagnóstico "Prioridades de hoje") nem os
 * loops por canal já existentes em `operation-data.ts`. Migrar cada
 * consumidor pra este resolvedor é trabalho de uma etapa seguinte, um de
 * cada vez — cada um tem nuances próprias de "quais canais mostrar" que
 * precisam ser conferidas individualmente antes da troca.
 */
export function resolveClientActuals(input: {
  sprints: { sprintId: string; start_date: string; end_date: string }[];
  dailySpendChannel: { date: string; channel: TrafficChannel; spend: number }[];
  channelSpendOverrides: SprintChannelSpendOverrideRow[];
  performanceRecords: PerformanceRecordRow[];
  performanceGoal: PerformanceGoal | null;
}): ClientMetrics {
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
