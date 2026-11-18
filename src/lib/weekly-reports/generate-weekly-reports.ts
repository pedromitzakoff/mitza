import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, PerformanceGoalDb } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { listDatesInclusive } from "@/lib/monthly-budget";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { getDailySpendRowsForPeriod, getDailyPerformanceForPeriod } from "@/lib/performance-queries";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries } from "@/lib/creative-analytics";
import { aggregatePerformanceResults, computeCostPerResult } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { resolveCurrentReportPeriods, type ResolvedReportPeriod } from "@/lib/weekly-reports/report-periods";
import { isPeriodFullySynced } from "@/lib/weekly-reports/report-sync-completeness";
import { computeAdHighlights } from "@/lib/weekly-reports/ad-highlights";
import { DEFAULT_AD_HIGHLIGHT_THRESHOLDS } from "@/lib/weekly-reports/report-thresholds";
import { renderReportTemplate } from "@/lib/weekly-reports/report-template";
import type { WeeklyReportMetrics, WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

type AdminSupabase = SupabaseClient<Database>;

/**
 * Aba "Reports" (pedido, seção 1: "gere os reports após a sincronização
 * da manhã... crie um único report por cliente e período, inclusive se o
 * job rodar novamente"). Orquestração impura — cron em `vercel.json`
 * ("/api/cron/generate-weekly-reports"), mesmo formato dos demais crons
 * (`evaluateSpendPaceAlerts`): nunca para no primeiro erro de UM
 * cliente/período, cada falha fica isolada.
 *
 * Escopo (decisão confirmada com o usuário via pergunta explícita nesta
 * entrega): só cliente ATIVO (`WORKSPACE_ACTIVE_CONTRACT_STATUS`) com
 * integração automática Meta habilitada (`import_sources`) E objetivo de
 * performance configurado (`clients.performance_goal`) — sem os dois, não
 * há como calcular investimento/resultado/destaques de anúncio por um
 * período arbitrário de poucos dias com confiança (cliente só-manual não
 * tem granularidade diária nenhuma; sem objetivo, não há "métrica
 * principal" pra resolver). Nenhum report fabricado pra esses casos — eles
 * simplesmente não aparecem na aba.
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

  const [clients, metaSources] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("id, name, performance_goal").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).is("deleted_at", null),
      "clients:weekly-reports",
    ),
    requireQuery(supabase.from("import_sources").select("client_id").eq("channel", "meta").eq("enabled", true), "import_sources:weekly-reports"),
  ]);

  const integratedClientIds = new Set(metaSources.map((s) => s.client_id));
  const eligibleClients = clients.filter((c) => integratedClientIds.has(c.id) && c.performance_goal !== null);

  const summary: WeeklyReportGenerationSummary = {
    evaluated: 0,
    created: 0,
    markedReady: 0,
    unchanged: 0,
    skippedNoGoal: clients.filter((c) => integratedClientIds.has(c.id) && c.performance_goal === null).length,
    errors: [],
  };

  for (const client of eligibleClients) {
    for (const period of periods) {
      try {
        const outcome = await generateAndPersistOneReport(supabase, { client, period, nowIso });
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
  next_step: string | null;
}

async function generateAndPersistOneReport(
  supabase: AdminSupabase,
  input: { client: { id: string; name: string; performance_goal: PerformanceGoalDb | null }; period: ResolvedReportPeriod; nowIso: string },
): Promise<"created" | "markedReady" | "unchanged"> {
  const { client, period, nowIso } = input;

  const existingRows = await requireQuery(
    supabase
      .from("weekly_reports")
      .select("id, status, text_edited_at, next_step")
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

  const periodDates = listDatesInclusive(period.periodStart, period.periodEnd);

  const [spendRows, perfRecords, creativeRows] = await Promise.all([
    getDailySpendRowsForPeriod(supabase, client.id, { firstDay: period.periodStart, lastDay: period.periodEnd }),
    getDailyPerformanceForPeriod(supabase, client.id, { firstDay: period.periodStart, lastDay: period.periodEnd }),
    getAdCreativeDailyMetricsForPeriod(supabase, client.id, { start: period.periodStart, end: period.periodEnd }),
  ]);

  const syncedDates = new Set(spendRows.map((r) => r.date));
  const fullySynced = isPeriodFullySynced(periodDates, syncedDates);

  if (!fullySynced) {
    if (existing) return "unchanged"; // continua aguardando — nada novo a calcular/gravar ainda.
    await insertNewReport(supabase, client.id, period, "aguardando_dados");
    return "created";
  }

  const goal = client.performance_goal as PerformanceGoal;
  const totalInvestment = spendRows.reduce((sum, r) => sum + r.spend, 0);
  const aggregated = aggregatePerformanceResults(perfRecords, goal);
  const costPerResult = computeCostPerResult(totalInvestment, aggregated.resultCount, aggregated.hasAnyRecord);

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
    await insertNewReport(supabase, client.id, period, "pronto_para_enviar", {
      performanceGoal: goal,
      metrics,
      bodyText: renderedText,
    });
    return "created";
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

  await requireQuery(supabase.from("weekly_reports").update(patch).eq("id", existing.id).select("id"), "weekly_reports:update");

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
  ready?: { performanceGoal: PerformanceGoal; metrics: WeeklyReportMetrics; bodyText: string },
): Promise<void> {
  const inserted = await requireQuery(
    supabase
      .from("weekly_reports")
      .insert({
        client_id: clientId,
        period_kind: period.periodKind,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        status,
        ...(ready
          ? { performance_goal: ready.performanceGoal, metrics: ready.metrics as unknown as Record<string, unknown>, body_text: ready.bodyText }
          : {}),
      })
      .select("id"),
    "weekly_reports:insert",
  );

  const reportId = inserted[0]?.id;
  if (reportId) {
    await requireQuery(supabase.from("weekly_report_events").insert({ report_id: reportId, event_type: "gerado" }).select("id"), "weekly_report_events:insert");
  }
}
