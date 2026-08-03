import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { PerformanceRecordRow, PerformanceSummary } from "@/lib/performance";
import { resolvePerformanceSummaryForGoal } from "@/lib/instagram-metrics";
import {
  channelToPerformanceSource,
  getClientIdsWithActiveImportSource,
  getDailyPerformanceRowsForPeriod,
  getDailySpendRowsForPeriod,
  getPerformanceRecordsForPeriod,
} from "@/lib/performance-queries";
import { buildAnalyticsChannelRows, buildAnalyticsTrend, type AnalyticsChannelRow, type AnalyticsTrend } from "@/lib/analytics";
import { previousEquivalentPeriod } from "@/lib/period-comparison";
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
  /** Mesmo cálculo de `summary`, mas pro período anterior de MESMA duração
   * (`lib/period-comparison.ts`) — alimenta a variação do Hero (Etapa
   * "Analytics Instagramável"). `null` só quando `performanceGoal` também é
   * `null` (sem objetivo, nada a comparar) — nunca uma segunda consulta
   * feita por quem consome este dado (a orquestração, `AnalyticsSection`,
   * chama `buildAnalyticsHero`/`buildExecutiveSummaryNarrative` com isso já
   * pronto, mesmo padrão de `summary`). */
  previousSummary: PerformanceSummary | null;
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
  /** Integração Google Ads (seletor de plataforma): quando presente, filtra
   * `dailySpendRows`/`records`/`dailyPerformanceRows` (período atual E
   * anterior) pra ESSE canal antes de qualquer agregação — nunca dentro das
   * funções puras de `lib/analytics.ts`, que continuam recebendo dado já
   * escopado, exatamente como sempre receberam. `undefined` = consolidado
   * (comportamento anterior, inalterado). */
  channel?: TrafficChannel,
): Promise<ClientAnalyticsData> {
  const [clientRows, dailySpendRowsAllChannels, activeImportClientIds] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("performance_goal, target_cost_per_result").eq("id", clientId),
      "clients:analytics",
    ),
    getDailySpendRowsForPeriod(supabase, clientId, { firstDay: period.start, lastDay: period.end }),
    getClientIdsWithActiveImportSource(supabase, [clientId]),
  ]);

  const dailySpendRows = channel ? dailySpendRowsAllChannels.filter((row) => row.channel === channel) : dailySpendRowsAllChannels;

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
  const dailyPerformanceRowsAllChannels = hasActiveIntegration ? await getDailyPerformanceRowsForPeriod(supabase, clientId, dateRange) : [];
  const dailyPerformanceRows = channel
    ? dailyPerformanceRowsAllChannels.filter((row) => row.channel === channel)
    : dailyPerformanceRowsAllChannels;
  const recordsAllChannels: PerformanceRecordRow[] = hasActiveIntegration
    ? dailyPerformanceRowsAllChannels.map((r) => ({
        channel: r.channel,
        resultType: r.resultType,
        resultCount: r.resultCount,
        revenue: r.revenue,
        source: channelToPerformanceSource(r.channel),
        sourceUpdatedAt: r.date,
      }))
    : await getPerformanceRecordsForPeriod(supabase, clientId, dateRange);
  const records = channel ? recordsAllChannels.filter((r) => r.channel === channel) : recordsAllChannels;

  const spendByChannel: Partial<Record<TrafficChannel, number>> = {};
  const dailySpendByDate = new Map<string, number>();
  for (const row of dailySpendRows) {
    spendByChannel[row.channel] = (spendByChannel[row.channel] ?? 0) + row.spend;
    dailySpendByDate.set(row.date, (dailySpendByDate.get(row.date) ?? 0) + row.spend);
  }

  // Etapa Integração Instagram: "followers" usa investimento só de Meta Ads
  // (escopo por canal), nunca o consolidado de todos os canais — qualquer
  // outro objetivo continua exatamente como antes (consolidado). Mesma
  // função usada por Reports (`client-report-data.ts`), nunca uma segunda
  // versão do cálculo.
  const summary = performanceGoal
    ? resolvePerformanceSummaryForGoal({ goal: performanceGoal, records, totalActualSpend: actualSpend, spendByChannel, targetCostPerResult })
    : null;

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

  // Etapa "Analytics Instagramável": comparação vs. período anterior de
  // MESMA duração — só buscada quando existe objetivo configurado (sem
  // objetivo, não há Hero pra alimentar, então nenhuma consulta extra).
  // Reaproveita exatamente as mesmas funções de consulta já usadas acima
  // pro período atual, nenhuma segunda fonte de dado.
  let previousSummary: PerformanceSummary | null = null;
  if (performanceGoal) {
    const previousPeriod = previousEquivalentPeriod(period);
    const previousDateRange = { firstDay: previousPeriod.start, lastDay: previousPeriod.end };

    const [previousDailySpendRowsAllChannels, previousRecordsAllChannels] = await Promise.all([
      getDailySpendRowsForPeriod(supabase, clientId, previousDateRange),
      hasActiveIntegration
        ? getDailyPerformanceRowsForPeriod(supabase, clientId, previousDateRange).then((rows) =>
            rows.map(
              (r): PerformanceRecordRow => ({
                channel: r.channel,
                resultType: r.resultType,
                resultCount: r.resultCount,
                revenue: r.revenue,
                source: channelToPerformanceSource(r.channel),
                sourceUpdatedAt: r.date,
              }),
            ),
          )
        : getPerformanceRecordsForPeriod(supabase, clientId, previousDateRange),
    ]);
    const previousDailySpendRows = channel
      ? previousDailySpendRowsAllChannels.filter((row) => row.channel === channel)
      : previousDailySpendRowsAllChannels;
    const previousRecords = channel ? previousRecordsAllChannels.filter((r) => r.channel === channel) : previousRecordsAllChannels;

    const previousActualSpend = previousDailySpendRows.reduce((sum, row) => sum + row.spend, 0);
    const previousSpendByChannel: Partial<Record<TrafficChannel, number>> = {};
    for (const row of previousDailySpendRows) {
      previousSpendByChannel[row.channel] = (previousSpendByChannel[row.channel] ?? 0) + row.spend;
    }

    previousSummary = resolvePerformanceSummaryForGoal({
      goal: performanceGoal,
      records: previousRecords,
      totalActualSpend: previousActualSpend,
      spendByChannel: previousSpendByChannel,
      targetCostPerResult,
    });
  }

  return { performanceGoal, actualSpend, summary, channelRows, trend, previousSummary };
}
