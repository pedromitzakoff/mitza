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
import { AVAILABLE_TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import { firstDayOfMonth } from "@/lib/achievement-dates";
import { todayDateString } from "@/lib/today";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Uma linha por DATA com pelo menos um sinal real (investimento OU
 * resultado) no período — Etapa "Resultado Diário" (Relatório de
 * Performance). Nunca fabrica dado: cada campo é `null` quando a linha de
 * origem correspondente simplesmente não existe pra aquela data.
 *
 * `resultCount` tem uma exceção deliberada, MESMA regra já usada por
 * `lib/daily-results.ts` (`buildDailyResultSeries`, Visão Geral): quando a
 * fonte tem integração ativa e a data JÁ TEM uma linha de `daily_spend`
 * (sinal de que o pipeline sincronizou aquele dia) mas nenhuma linha de
 * `daily_performance` pro objetivo, o resultado vira `0` CONFIRMADO — não
 * "sem dado", porque o dia foi sincronizado e simplesmente não teve
 * resultado. Sem esse sinal de sincronização, o dia fica genuinamente
 * desconhecido e `resultCount` é `null`. `revenue` NUNCA usa essa mesma
 * inferência (fica `null` sempre que não houver uma linha explícita com
 * receita) — receita é opcional mesmo em dias confirmadamente sincronizados
 * (nem todo objetivo/fonte rastreia receita), então um `0` aqui seria uma
 * fabricação, não uma confirmação.
 */
export interface ClientAnalyticsDailyRow {
  date: string;
  /** `null` = nenhuma linha de `daily_spend` pra essa data (nunca `0`
   * fabricado — dia sem sinal de sincronização). */
  spend: number | null;
  /** Ver regra completa no comentário da interface. */
  resultCount: number | null;
  /** `null` = nenhuma linha com receita pra essa data (nunca inferido a
   * partir de `resultCount`). */
  revenue: number | null;
}

/**
 * Núcleo PURO de `ClientAnalyticsDailyRow` — extraído de
 * `fetchClientAnalyticsData` pra ser testável sem banco (Etapa "Resultado
 * Diário"). Recebe os MESMOS mapas por data que `fetchClientAnalyticsData`
 * já monta a partir de `dailySpendRows`/`dailyPerformanceRows` (nunca uma
 * segunda consulta) e devolve uma linha esparsa por data com pelo menos um
 * sinal. Ver o comentário completo da regra de "zero confirmado vs. sem
 * dado" em `ClientAnalyticsDailyRow`.
 */
export function buildClientAnalyticsDailyRows(
  dailySpendByDate: Map<string, number>,
  dailyResultByDate: Map<string, number> | null,
  dailyRevenueByDate: Map<string, number> | null,
): ClientAnalyticsDailyRow[] {
  const dailyDates = new Set<string>([...dailySpendByDate.keys(), ...(dailyResultByDate?.keys() ?? [])]);
  return Array.from(dailyDates)
    .sort()
    .map((date): ClientAnalyticsDailyRow => {
      const hasSpendSignal = dailySpendByDate.has(date);
      let resultCount: number | null = null;
      if (dailyResultByDate) {
        if (dailyResultByDate.has(date)) resultCount = dailyResultByDate.get(date)!;
        else if (hasSpendSignal) resultCount = 0;
      }
      return {
        date,
        spend: hasSpendSignal ? dailySpendByDate.get(date)! : null,
        resultCount,
        revenue: dailyRevenueByDate?.has(date) ? dailyRevenueByDate.get(date)! : null,
      };
    });
}

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
   * feita por quem consome este dado, mesmo padrão de `summary`. */
  previousSummary: PerformanceSummary | null;
  /** Etapa "Resultado Diário": as MESMAS linhas de `daily_spend`/
   * `daily_performance` já buscadas acima pra `actualSpend`/`summary`, só
   * reagrupadas por data em vez de somadas num total só — nunca uma segunda
   * consulta. Esparso (só datas com algum sinal); quem consome decide se
   * preenche os dias faltantes do intervalo (isso é decisão de
   * apresentação, não de dado). Ordenado por data crescente. */
  dailyRows: ClientAnalyticsDailyRow[];
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
  const [clientRows, dailySpendRowsAllChannels, activeImportClientIds, planChangeRows] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("performance_goal, target_cost_per_result").eq("id", clientId),
      "clients:analytics",
    ),
    getDailySpendRowsForPeriod(supabase, clientId, { firstDay: period.start, lastDay: period.end }),
    getClientIdsWithActiveImportSource(supabase, [clientId]),
    // Etapa "Meta/Custo-Alvo: Centralizar a Regra" — `targetCostPerResult`
    // deixa de vir só de `clients.target_cost_per_result` (fallback legado
    // sem plano por canal) e passa a checar primeiro o planejamento mensal
    // vigente, mesma regra de `clients/[id]/page.tsx`/Sprints/Motor de
    // Saúde/Conquistas (`resolveTargetCostPerResult`). `.lte` (não `.eq`):
    // carry-forward do mês vigente, nunca uma segunda regra de vigência.
    // Sem filtro de `result_type` no SQL (o objetivo principal só é
    // conhecido depois que `clientRows` resolve, abaixo) — filtrado em
    // JavaScript com a mesma semântica de `primaryGoalResultTypeFilter`.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, result_type, month, changed_at, new_amount, target_result_count")
        .eq("client_id", clientId)
        .lte("month", firstDayOfMonth(todayDateString())),
      "monthly_budget_changes:target",
    ),
  ]);

  const dailySpendRows = channel ? dailySpendRowsAllChannels.filter((row) => row.channel === channel) : dailySpendRowsAllChannels;

  const performanceGoal = clientRows[0]?.performance_goal ?? null;
  // Meta de custo é fato de CONTA (Analytics/Performance Report nunca têm
  // seletor de canal separado do Consolidado/Meta/Google já embutido em
  // `channel` acima) — nunca CPA REALIZADO (auditoria "Fase 1", Bug 4).
  const planChanges: ClientPlanChangeRow[] = planChangeRows
    .filter((row) => row.result_type == null || row.result_type === performanceGoal)
    .map((row) => ({
      channel: row.channel as TrafficChannel,
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
    }));
  const clientMonthlyPlan = resolveClientMonthlyPlan({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: planChanges,
    selectedMonth: firstDayOfMonth(todayDateString()),
  });
  const targetCostPerResult = resolveTargetCostPerResult({
    channel: channel ?? "consolidated",
    plan: clientMonthlyPlan,
    legacyFallback: clientRows[0]?.target_cost_per_result ?? null,
  });
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
  let dailyRevenueByDate: Map<string, number> | null = null;
  if (hasActiveIntegration && performanceGoal) {
    dailyResultByDate = new Map();
    dailyRevenueByDate = new Map();
    for (const row of dailyPerformanceRows) {
      if (row.resultType !== performanceGoal) continue;
      dailyResultByDate.set(row.date, (dailyResultByDate.get(row.date) ?? 0) + row.resultCount);
      if (row.revenue !== null) dailyRevenueByDate.set(row.date, (dailyRevenueByDate.get(row.date) ?? 0) + row.revenue);
    }
  }

  const trend = buildAnalyticsTrend(performanceGoal, dailySpendByDate, dailyResultByDate);

  const dailyRows = buildClientAnalyticsDailyRows(dailySpendByDate, dailyResultByDate, dailyRevenueByDate);

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

  return { performanceGoal, actualSpend, summary, channelRows, trend, previousSummary, dailyRows };
}
