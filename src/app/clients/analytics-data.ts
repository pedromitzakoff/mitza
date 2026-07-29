import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { computePerformanceSummary, type PerformanceRecordRow, type PerformanceSummary } from "@/lib/performance";
import {
  channelToPerformanceSource,
  getClientIdsWithActiveImportSource,
  getDailyPerformanceRowsForPeriod,
  getPerformanceRecordsForPeriod,
} from "@/lib/performance-queries";
import { buildAnalyticsChannelRows, buildAnalyticsTrend, type AnalyticsChannelRow, type AnalyticsTrend } from "@/lib/analytics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface ClientAnalyticsData {
  performanceGoal: PerformanceGoal | null;
  actualSpend: number;
  /** `null` só quando `performanceGoal` também é `null` (sem objetivo
   * configurado, nada a resumir). */
  summary: PerformanceSummary | null;
  /** Detalhamento por canal (ver `lib/analytics.ts` pro porquê de canal e
   * não campanha) — vazio quando o cliente não tem objetivo configurado ou
   * não usa mais de um canal (a própria tabela decide se aparece). */
  channelRows: AnalyticsChannelRow[];
  /** `null` quando não há dias suficientes de investimento no período — a
   * seção de gráfico mostra a mensagem discreta nesse caso. */
  trend: AnalyticsTrend | null;
}

/**
 * UMA consulta consolidada por card/seção (pedido explícito do usuário:
 * "não fazer uma requisição diferente para cada card") — reaproveita 100%
 * do núcleo já usado por Reports/Visão Geral (`computePerformanceSummary`,
 * `getPerformanceRecordsForPeriod`, `getDailyPerformanceForPeriod`, decisão
 * manual/Stract via `getClientIdsWithActiveImportSource`), nunca uma
 * segunda fonte de verdade pro mesmo dado. Investimento é sempre a soma
 * direta de `daily_spend` no período (mesmo padrão já usado por
 * `client-report-data.ts` — Analytics e Reports leem a mesma fonte).
 */
export async function fetchClientAnalyticsData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<ClientAnalyticsData> {
  const [clientRows, dailySpendRows, activeImportClientIds] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("performance_goal, target_cost_per_result").eq("id", clientId),
      "clients:analytics",
    ),
    requireQuery(
      supabase
        .from("daily_spend")
        .select("date, channel, spend")
        .eq("client_id", clientId)
        .gte("date", period.start)
        .lte("date", period.end),
      "daily_spend:analytics",
    ),
    getClientIdsWithActiveImportSource(supabase, [clientId]),
  ]);

  const performanceGoal = clientRows[0]?.performance_goal ?? null;
  const targetCostPerResult = clientRows[0]?.target_cost_per_result ?? null;
  const hasActiveIntegration = activeImportClientIds.has(clientId);
  const actualSpend = dailySpendRows.reduce((sum, row) => sum + row.spend, 0);

  const dateRange = { firstDay: period.start, lastDay: period.end };
  // Clientes com integração Stract ativa têm granularidade DIÁRIA de
  // resultado (`daily_performance`, com `date`) — a mesma consulta alimenta
  // tanto o resumo (`computePerformanceSummary`) quanto o gráfico de
  // evolução, nunca duas buscas nessa tabela pro mesmo período. Clientes só
  // manuais (`performance_records`) não têm essa granularidade — só por
  // sprint/período — por isso o gráfico de resultado nunca existe pra eles
  // (limitação real do que a MITZA armazena hoje).
  const dailyPerformanceRows = hasActiveIntegration ? await getDailyPerformanceRowsForPeriod(supabase, clientId, dateRange) : [];
  const records: PerformanceRecordRow[] = hasActiveIntegration
    ? dailyPerformanceRows.map((r) => ({
        channel: r.channel,
        resultType: r.resultType,
        resultCount: r.resultCount,
        revenue: r.revenue,
        source: channelToPerformanceSource(r.channel),
        sourceUpdatedAt: r.date,
      }))
    : await getPerformanceRecordsForPeriod(supabase, clientId, dateRange);

  const summary = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records,
        resultType: performanceGoal,
        consolidatedActualSpend: actualSpend,
        targetCostPerResult,
      })
    : null;

  const spendByChannel: Partial<Record<TrafficChannel, number>> = {};
  const dailySpendByDate = new Map<string, number>();
  for (const row of dailySpendRows) {
    spendByChannel[row.channel] = (spendByChannel[row.channel] ?? 0) + row.spend;
    dailySpendByDate.set(row.date, (dailySpendByDate.get(row.date) ?? 0) + row.spend);
  }

  const channelRows = performanceGoal ? buildAnalyticsChannelRows(performanceGoal, records, spendByChannel) : [];

  let dailyResultByDate: Map<string, number> | null = null;
  if (hasActiveIntegration && performanceGoal) {
    dailyResultByDate = new Map();
    for (const row of dailyPerformanceRows) {
      if (row.resultType !== performanceGoal) continue;
      dailyResultByDate.set(row.date, (dailyResultByDate.get(row.date) ?? 0) + row.resultCount);
    }
  }

  const trend = buildAnalyticsTrend(performanceGoal, dailySpendByDate, dailyResultByDate);

  return { performanceGoal, actualSpend, summary, channelRows, trend };
}
