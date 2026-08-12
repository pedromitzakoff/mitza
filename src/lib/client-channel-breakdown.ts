import { inferClientChannels, sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { computePerformanceSummary, type PerformanceRecordRow, type PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Lacuna de canal do domínio novo (Etapa "Consolidação da Arquitetura —
 * Fase A"): `ClientOperationalState`/`account-health-engine.ts` só
 * enxergam o investimento/resultado/custo CONSOLIDADOS — nenhum conceito de
 * canal (Meta/Google) existe ali. Este módulo preenche essa lacuna sem
 * duplicar nenhuma fórmula: reaproveita `lib/channel-spend.ts` (investimento
 * por canal) e `lib/performance.ts` (resultado/custo por canal), os dois já
 * neutros — nem do motor legado, nem do novo.
 *
 * Ainda não é consumido por nenhuma tela: é a peça que faltava pra a Visão
 * Geral (filtro Meta/Google/Consolidado) poder migrar pra este domínio numa
 * PR futura, sem perder essa capacidade. Esta Fase A só cria a fundação.
 */
export interface ClientChannelState {
  channel: TrafficChannel;
  investmentActual: number;
  performanceSummary: PerformanceSummary | null;
}

/** Estado por canal de UM cliente — só os canais que ele de fato usa
 * (`inferClientChannels`, nunca uma lista fixa de todos os canais
 * possíveis). `performanceSummary` é `null` quando o cliente não tem
 * objetivo de performance configurado (não há `resultType` pra agregar). */
export function resolveClientChannelBreakdown(input: {
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
