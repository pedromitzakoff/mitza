import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, PerformanceGoalDb } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { listDatesInclusive } from "@/lib/monthly-budget";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { resolvePrimaryGoal, resolveChannelGoal, listClientGoalsForClients } from "@/lib/client-goals";
import { resolveClientMediaChannels, type TrafficChannel } from "@/lib/traffic-channels";
import { channelToPerformanceSource } from "@/lib/performance-queries";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries } from "@/lib/creative-analytics";
import { aggregatePerformanceResults, computeCostPerResult } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { resolveCurrentReportPeriods, type ResolvedReportPeriod } from "@/lib/weekly-reports/report-periods";
import { isPeriodFullySynced, isReportDayConfirmed } from "@/lib/weekly-reports/report-sync-completeness";
import { computeAdHighlights } from "@/lib/weekly-reports/ad-highlights";
import { DEFAULT_AD_HIGHLIGHT_THRESHOLDS } from "@/lib/weekly-reports/report-thresholds";
import { renderReportTemplate } from "@/lib/weekly-reports/report-template";
import type { WeeklyReportMetrics, WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

type AdminSupabase = SupabaseClient<Database>;
type ReportSource = Pick<Database["public"]["Tables"]["import_sources"]["Row"], "id" | "channel" | "status" | "last_success_at" | "last_imported_date">;

/**
 * Aba "Reports" (pedido, seção 1: "gere os reports após a sincronização
 * da manhã... crie um único report por cliente e período, inclusive se o
 * job rodar novamente"). Orquestração impura — cron em `vercel.json`
 * ("/api/cron/generate-weekly-reports"), mesmo formato dos demais crons
 * (`evaluateSpendPaceAlerts`): nunca para no primeiro erro de UM
 * cliente/período, cada falha fica isolada.
 *
 * Clientes ativos entram na fila mesmo se ainda precisarem de configuração
 * ou sincronização.
 *
 * `resolveCurrentReportPeriods` sempre devolve os MESMOS 2 períodos (lote
 * de segunda + lote de sexta mais recentes) não importa em que dia da
 * semana o cron rodar — por isso roda numa cadência fixa (mesma de
 * `evaluate-alerts`), sem precisar saber se "hoje é segunda ou sexta": a
 * transição aguardando_dados -> pronto_para_enviar acontece sozinha, na
 * primeira execução em que o período estiver inteiramente sincronizado.
 */
export interface WeeklyReportGenerationSummary {
  evaluated: number;
  created: number;
  markedReady: number;
  unchanged: number;
  skippedNoGoal: number;
  errors: { clientId: string; periodKind: string; message: string }[];
}

export async function generateWeeklyReports(now: Date = new Date(), supabase: AdminSupabase = createAdminClient()): Promise<WeeklyReportGenerationSummary> {
  const today = todayDateString(now);
  const periods = resolveCurrentReportPeriods(today);
  const nowIso = now.toISOString();

  const [clients, activeSources] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("id, name, performance_goal, media_channels").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).is("deleted_at", null),
      "clients:weekly-reports",
    ),
    requireQuery(supabase.from("import_sources").select("id, client_id, channel, status, last_success_at, last_imported_date").eq("enabled", true), "import_sources:weekly-reports"),
  ]);

  const sourceIds = activeSources.map((source) => source.id);
  const [goals, mappings] = await Promise.all([
    listClientGoalsForClients(supabase, clients.map((client) => client.id)),
    sourceIds.length ? requireQuery(supabase.from("metric_mappings").select("import_source_id, goal")
      .in("import_source_id", sourceIds).eq("active", true), "weekly-reports:mappings") : [],
  ]);
  const mapped = new Set(mappings.map((row) => `${row.import_source_id}:${row.goal}`));
  const coverageByPeriod = await Promise.all(periods.map(async (period) => {
    if (!sourceIds.length) return new Set<string>();
    const { data, error } = await supabase.rpc("report_sync_coverage", {
      p_source_ids: sourceIds, p_start: period.periodStart, p_end: period.periodEnd,
    });
    // A migração é aplicada separadamente. Até lá, só linhas explícitas comprovam cobertura.
    if (error && error.code !== "PGRST202") throw error;
    return new Set((data ?? []).map((row) => `${row.source_id}:${row.day}`));
  }));

  const summary: WeeklyReportGenerationSummary = {
    evaluated: 0,
    created: 0,
    markedReady: 0,
    unchanged: 0,
    skippedNoGoal: 0,
    errors: [],
  };

  for (const client of clients) {
    const clientGoals = goals.get(client.id) ?? [];
    const primary = resolvePrimaryGoal(clientGoals);
    const goal = primary?.resultType ?? client.performance_goal;
    const channels = resolveClientMediaChannels(client.media_channels);
    const goalChannels = clientGoals.length ? channels.filter((channel) => resolveChannelGoal(clientGoals, channel)?.resultType === goal) : channels;
    const sources = activeSources.filter((source) => source.client_id === client.id && channels.includes(source.channel));
    if (!goal) summary.skippedNoGoal++;
    for (const [index, period] of periods.entries()) {
      try {
        const outcome = await generateAndPersistOneReport(supabase, { client: { ...client, performance_goal: goal }, period, nowIso, sources, covered: coverageByPeriod[index], mapped, channels, goalChannels, manual: primary?.resultSource === "manual" });
        summary.evaluated++;
        summary[outcome]++;
      } catch (err) {
        summary.errors.push({ clientId: client.id, periodKind: period.periodKind, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return summary;
}

interface ExistingReportRow {
  id: string;
  status: WeeklyReportStatus;
  text_edited_at: string | null;
  updated_at: string;
  metrics: Record<string, unknown>;
  next_step: string | null;
}

async function generateAndPersistOneReport(
  supabase: AdminSupabase,
  input: { client: { id: string; name: string; performance_goal: PerformanceGoalDb | null }; period: ResolvedReportPeriod; nowIso: string; sources: ReportSource[]; covered: Set<string>; mapped: Set<string>; channels: TrafficChannel[]; goalChannels: TrafficChannel[]; manual: boolean },
): Promise<"created" | "markedReady" | "unchanged"> {
  const { client, period, nowIso, sources, covered, mapped, channels, goalChannels, manual } = input;

  const existingRows = await requireQuery(
    supabase
      .from("weekly_reports")
      .select("id, status, text_edited_at, next_step, updated_at, metrics")
      .eq("client_id", client.id)
      .eq("period_start", period.periodStart)
      .eq("period_end", period.periodEnd)
      .limit(1),
    "weekly_reports:existing",
  );
  const existing = (existingRows[0] as ExistingReportRow | undefined) ?? null;

  // Pedido, seção 4: "mantenha a versão enviada no histórico mesmo quando
  // a origem atualizar os números" — um report já enviado para de ser
  // tocado por qualquer reprocessamento automático, ponto final.
  if (existing?.status === "enviado") return "unchanged";

  const goal = client.performance_goal;
  const wait = async (reason: string): Promise<"created" | "unchanged"> => {
    if (!existing) {
      const inserted = await insertNewReport(supabase, client.id, period, "aguardando_dados", { waitingReason: reason });
      return inserted ? "created" : "unchanged";
    }
    if (existing.status !== "aguardando_dados" || existing.metrics.waitingReason !== reason) {
      await requireQuery(supabase.from("weekly_reports").update({ status: "aguardando_dados", metrics: { waitingReason: reason } })
        .eq("id", existing.id).eq("status", existing.status).eq("updated_at", existing.updated_at).select("id"), "weekly_reports:waiting");
    }
    return "unchanged";
  };
  if (!goal) return wait("Configure a métrica principal do cliente para gerar o report.");
  if (!goalChannels.length) return wait("Vincule a métrica principal a um canal de mídia do cliente.");

  const dates = listDatesInclusive(period.periodStart, period.periodEnd);
  const [spendRows, resultRows] = await Promise.all([
    requireQuery(supabase.from("daily_spend").select("date, channel, spend, synced_at").eq("client_id", client.id).in("channel", channels)
      .gte("date", period.periodStart).lte("date", period.periodEnd), "weekly-reports:spend"),
    requireQuery(supabase.from("daily_performance").select("date, channel, result_type, result_count, revenue, source_updated_at")
      .eq("client_id", client.id).in("channel", goalChannels).eq("result_type", goal)
      .gte("date", period.periodStart).lte("date", period.periodEnd), "weekly-reports:results"),
  ]);

  const confirmed = new Set(dates.filter((day) => channels.every((channel) => {
    const channelSources = sources.filter((source) => source.channel === channel);
    const usesGoal = goalChannels.includes(channel);
    const explicitSpend = spendRows.some((row) => row.channel === channel && row.date === day && todayDateString(new Date(row.synced_at)) > day);
    const explicitResult = resultRows.some((row) => row.channel === channel && row.date === day && (manual || todayDateString(new Date(row.source_updated_at)) > day));
    return isReportDayConfirmed({
      channelSources, day, covered, mapped, goal, usesGoal, manual, explicitSpend, explicitResult,
    });
  })));
  if (!isPeriodFullySynced(dates, confirmed)) {
    const missingSource = channels.some((channel) => !sources.some((source) => source.channel === channel));
    return wait(missingSource
      ? "Faltam dados diários confirmados ou uma integração habilitada em um dos canais."
      : "Aguardando confirmação da sincronização de investimento e resultados de todo o período.");
  }

  const totalInvestment = spendRows.reduce((sum, row) => sum + row.spend, 0);
  const aggregated = aggregatePerformanceResults(resultRows.map((row) => ({
    channel: row.channel, resultType: row.result_type, resultCount: row.result_count, revenue: row.revenue,
    source: channelToPerformanceSource(row.channel), sourceUpdatedAt: row.source_updated_at,
  })), goal);
  const goalInvestment = spendRows.filter((row) => goalChannels.includes(row.channel)).reduce((sum, row) => sum + row.spend, 0);
  const costPerResult = computeCostPerResult(goalInvestment, aggregated.resultCount, aggregated.hasAnyRecord);

  const creativeRows = channels.includes("meta")
    ? await getAdCreativeDailyMetricsForPeriod(supabase, client.id, { start: period.periodStart, end: period.periodEnd }) : [];
  const creativeSummaries = buildCreativeSummaries(creativeRows);
  const highlights = computeAdHighlights(creativeSummaries, goal, DEFAULT_AD_HIGHLIGHT_THRESHOLDS);

  const metrics: WeeklyReportMetrics = {
    investment: totalInvestment,
    resultCount: aggregated.resultCount,
    costPerResult,
    highlights,
    thresholds: DEFAULT_AD_HIGHLIGHT_THRESHOLDS,
    computedAt: nowIso,
  };

  const renderedText = renderReportTemplate({
    clientName: client.name,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    goal,
    investment: metrics.investment,
    resultCount: metrics.resultCount,
    costPerResult: metrics.costPerResult,
    highlights: metrics.highlights,
    nextStep: existing?.next_step ?? null,
  });

  if (!existing) {
    const inserted = await insertNewReport(supabase, client.id, period, "pronto_para_enviar", {
      performanceGoal: goal,
      metrics,
      bodyText: renderedText,
    });
    return inserted ? "created" : "unchanged";
  }

  const wasAwaiting = existing.status === "aguardando_dados";
  const patch: Database["public"]["Tables"]["weekly_reports"]["Update"] = {
    status: "pronto_para_enviar",
    performance_goal: goal,
    metrics: metrics as unknown as Record<string, unknown>,
  };
  // Pedido, seção 4: "preserve edições manuais durante reprocessamentos" —
  // o texto só é regerado automaticamente enquanto o gestor nunca o tiver
  // editado (`text_edited_at` nulo); dali pra frente, o texto é dele.
  if (!existing.text_edited_at) {
    patch.body_text = renderedText;
  }

  const updated = await requireQuery(supabase.from("weekly_reports").update(patch)
    .eq("id", existing.id).eq("status", existing.status).eq("updated_at", existing.updated_at).select("id"), "weekly_reports:update");
  if (!updated.length) return "unchanged";

  if (wasAwaiting) {
    await requireQuery(
      supabase.from("weekly_report_events").insert({ report_id: existing.id, event_type: "pronto_para_enviar" }).select("id"),
      "weekly_report_events:insert",
    );
    return "markedReady";
  }
  return "unchanged";
}

async function insertNewReport(
  supabase: AdminSupabase,
  clientId: string,
  period: ResolvedReportPeriod,
  status: WeeklyReportStatus,
  details: { performanceGoal: PerformanceGoal; metrics: WeeklyReportMetrics; bodyText: string } | { waitingReason: string },
): Promise<boolean> {
  const inserted = await requireQuery(
    supabase
      .from("weekly_reports")
      .upsert({
        client_id: clientId,
        period_kind: period.periodKind,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        status,
        ...("waitingReason" in details
          ? { metrics: { waitingReason: details.waitingReason } }
          : { performance_goal: details.performanceGoal, metrics: details.metrics as unknown as Record<string, unknown>, body_text: details.bodyText }),
      }, { onConflict: "client_id,period_start,period_end", ignoreDuplicates: true })
      .select("id"),
    "weekly_reports:insert",
  );

  const reportId = inserted[0]?.id;
  if (reportId) {
    await requireQuery(supabase.from("weekly_report_events").insert({ report_id: reportId, event_type: "gerado" }).select("id"), "weekly_report_events:insert");
  }
  return !!reportId;
}
