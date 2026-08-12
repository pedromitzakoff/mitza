import type { SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { computePerformanceSummary, type PerformanceRecordRow, type PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { resolveClientMonthlyActuals } from "@/lib/client-actuals";

/**
 * Lacuna de canal do domínio novo (Etapa "Consolidação da Arquitetura —
 * Fase A"): `ClientOperationalState`/`account-health-engine.ts` só
 * enxergam o investimento/resultado/custo CONSOLIDADOS — nenhum conceito de
 * canal (Meta/Google) existe ali. Este módulo preenche essa lacuna sem
 * duplicar nenhuma fórmula: reaproveita `lib/performance.ts` (custo por
 * canal contra a meta) e, desde a Etapa "Fundação Compartilhada", o
 * investimento aditivo por canal já resolvido por `resolveClientMonthlyActuals`
 * (lib/client-actuals.ts) — nunca uma segunda soma de `daily_spend`/overrides
 * por conta própria.
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

/** Estado por canal de UM cliente — só os canais que ele de fato usa (mesmos
 * canais que `resolveClientMonthlyActuals` resolveu em `byChannel`, nunca
 * uma lista fixa de todos os canais possíveis). `performanceSummary` é
 * `null` quando o cliente não tem objetivo de performance configurado (não
 * há `resultType` pra agregar). */
export function resolveClientChannelBreakdown(input: {
  sprints: { sprintId: string; start_date: string; end_date: string }[];
  dailySpendChannel: { date: string; channel: TrafficChannel; spend: number }[];
  channelSpendOverrides: SprintChannelSpendOverrideRow[];
  performanceRecords: PerformanceRecordRow[];
  performanceGoal: PerformanceGoal | null;
  targetCostPerResult: number | null;
}): ClientChannelState[] {
  const { sprints, dailySpendChannel, channelSpendOverrides, performanceRecords, performanceGoal, targetCostPerResult } = input;

  const actuals = resolveClientMonthlyActuals({
    sprints,
    dailySpendChannel,
    channelSpendOverrides,
    performanceRecords,
    performanceGoal,
  });
  const channels = Object.keys(actuals.byChannel) as TrafficChannel[];

  return channels.map((channel) => {
    // Investimento sempre resolvido (nunca `null`) pra um canal que
    // `resolveClientMonthlyActuals` já confirmou ter dado — mesma garantia
    // que `sumChannelEffectiveSpend` já dava antes desta etapa.
    const investmentActual = actuals.byChannel[channel]?.investment ?? 0;

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
