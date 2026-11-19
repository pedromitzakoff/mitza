import { persistAlertEvaluation } from "@/lib/alerts/persist-alert-evaluation";
import type { AlertCandidate } from "@/lib/alerts/alert-types";
import { listDatesInclusive } from "@/lib/monthly-budget";
import { DIRECT_SYNC_WINDOW_DAYS } from "@/lib/meta-api-direct-sync";
import { findCampaignDataGaps, resolveGapScanWindow } from "@/lib/meta-api-gap-detection";
import { requireQuery } from "@/lib/require-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayDateString } from "@/lib/today";
import type { TrafficChannel } from "@/lib/traffic-channels";

const COVERAGE_LOOKBACK_DAYS = 7 + DIRECT_SYNC_WINDOW_DAYS - 1;

interface SyncIssue {
  missingDates: Set<string>;
  failedDates: Set<string>;
  partialDates: Set<string>;
}

export async function evaluateSyncIssueAlerts(now = new Date(), supabase = createAdminClient()) {
  const today = todayDateString(now);
  const { windowStart, windowEnd } = resolveGapScanWindow(today, COVERAGE_LOOKBACK_DAYS, DIRECT_SYNC_WINDOW_DAYS);
  const dates = listDatesInclusive(windowStart, windowEnd);

  const [sources, openAlerts, gaps] = await Promise.all([
    requireQuery(
      supabase.from("import_sources").select("id, client_id, channel, created_at, clients!inner(id)")
        .eq("enabled", true).eq("provider", "meta_api").is("clients.deleted_at", null),
      "import_sources:sync-alerts",
    ),
    requireQuery(
      supabase.from("alerts").select("client_id, channel").eq("alert_type", "sync_issue")
        .eq("period_kind", "full_day").neq("status", "resolvido"),
      "alerts:open-sync-issues",
    ),
    findCampaignDataGaps(supabase, 60, today),
  ]);

  const byClient = new Map<string, { clientId: string; channel: TrafficChannel; issue: SyncIssue }>();
  function getIssue(clientId: string, channel: TrafficChannel) {
    const key = `${clientId}:${channel}`;
    let entry = byClient.get(key);
    if (!entry) {
      entry = { clientId, channel, issue: { missingDates: new Set(), failedDates: new Set(), partialDates: new Set() } };
      byClient.set(key, entry);
    }
    return entry.issue;
  }

  for (const alert of openAlerts) getIssue(alert.client_id, alert.channel);
  for (const gap of gaps) {
    const issue = getIssue(gap.clientId, "meta");
    for (const date of gap.missingDates) issue.missingDates.add(date);
  }

  await Promise.all(sources.map(async (source) => {
    const [latestRuns, coverage] = await Promise.all([
      requireQuery(
        supabase.from("data_sync_runs").select("status, started_at").eq("import_source_id", source.id)
          .in("status", ["success", "empty", "failed", "partial"])
          .order("started_at", { ascending: false }).order("id", { ascending: false }).limit(1),
        "data_sync_runs:latest-finished",
      ),
      supabase.rpc("report_sync_coverage", {
        p_source_ids: [source.id], p_start: windowStart, p_end: windowEnd,
      }),
    ]);

    const latest = latestRuns[0];
    if (latest?.status === "failed" || latest?.status === "partial") {
      const issue = getIssue(source.client_id, source.channel);
      const issueDates = latest.status === "failed" ? issue.failedDates : issue.partialDates;
      issueDates.add(todayDateString(new Date(latest.started_at)));
    }

    // Instalações sem a função de cobertura ainda usam os gaps confirmados
    // de campanhas e o estado das execuções para identificar problemas.
    if (coverage.error?.code === "PGRST202") return;
    if (coverage.error) throw new Error(`[report_sync_coverage:sync-alerts] ${coverage.error.message}`);

    const coveredDates = new Set(coverage.data.map((row) => row.day));
    const createdOn = todayDateString(new Date(source.created_at));
    for (const date of dates) {
      if (date > createdOn && !coveredDates.has(date)) {
        getIssue(source.client_id, source.channel).missingDates.add(date);
      }
    }
  }));

  const outcomes = await Promise.all([...byClient.values()].map(({ clientId, channel, issue }) =>
    persistAlertEvaluation(
      supabase, { clientId, channel, alertType: "sync_issue", periodKind: "full_day" },
      buildSyncIssueCandidate(issue), now.toISOString(),
    ),
  ));
  return {
    created: outcomes.filter((outcome) => outcome === "created").length,
    updated: outcomes.filter((outcome) => outcome === "updated").length,
    resolved: outcomes.filter((outcome) => outcome === "resolved").length,
  };
}

function buildSyncIssueCandidate(issue: SyncIssue): AlertCandidate<null> | null {
  const missingDates = [...issue.missingDates].sort();
  const failedDates = [...issue.failedDates].sort();
  const partialDates = [...issue.partialDates].sort();
  const dates = [...missingDates, ...failedDates, ...partialDates].sort();
  if (dates.length === 0) return null;

  const formatDates = (values: string[]) => values.map((date) => date.split("-").reverse().join("/")).join(", ");
  const explanation = [
    failedDates.length ? `Falha na última sincronização em ${formatDates(failedDates)}.` : "",
    partialDates.length ? `Última sincronização parcial em ${formatDates(partialDates)}.` : "",
    missingDates.length ? `Dados faltantes em ${formatDates(missingDates)}.` : "",
  ].filter(Boolean).join(" ");

  return {
    severity: failedDates.length ? "critico" : "atencao",
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    observedValue: null,
    referenceValue: null,
    diffPercent: null,
    referenceIsEstimate: false,
    referenceSource: null,
    explanation,
    detail: { missingDates, failedDates, partialDates },
  };
}
