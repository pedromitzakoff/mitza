import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { reduceAlertEvaluation, shouldKeepManualResolution } from "@/lib/alerts/alert-persistence";
import type { AlertCandidate, AlertPeriodKind, AlertType } from "@/lib/alerts/alert-types";

export async function persistAlertEvaluation(
  supabase: SupabaseClient<Database>,
  key: { clientId: string; channel: TrafficChannel; alertType: AlertType; periodKind: AlertPeriodKind },
  candidate: AlertCandidate<number | null> | null,
  nowIso: string,
): Promise<"created" | "updated" | "resolved" | "ignored"> {
  const existingRows = await requireQuery(
    supabase
      .from("alerts")
      .select("id, status, period_end, detail, resolved_at, last_evaluated_at, updated_at")
      .eq("client_id", key.clientId)
      .eq("channel", key.channel)
      .eq("alert_type", key.alertType)
      .eq("period_kind", key.periodKind)
      .limit(1),
    "alerts:existing",
  );
  const existing = existingRows[0] ?? null;

  if (existing && candidate && shouldKeepManualResolution(existing, candidate, key.alertType)) return "ignored";

  const transition = reduceAlertEvaluation(existing ? { status: existing.status } : null, candidate !== null);
  if (transition.action === "ignore") return "ignored";

  const patch: Database["public"]["Tables"]["alerts"]["Update"] = {
    status: transition.nextStatus,
    last_evaluated_at: nowIso,
    resolved_at: transition.action === "resolve" ? nowIso : null,
    ...(transition.resetFirstDetected ? { first_detected_at: nowIso } : {}),
  };

  if (candidate) {
    Object.assign(patch, {
      severity: candidate.severity,
      period_start: candidate.periodStart,
      period_end: candidate.periodEnd,
      observed_value: candidate.observedValue,
      reference_value: candidate.referenceValue,
      diff_percent: candidate.diffPercent,
      reference_is_estimate: candidate.referenceIsEstimate,
      reference_source: candidate.referenceSource,
      explanation: candidate.explanation,
      detail: candidate.detail,
    });
  }

  let alertId: string | null = existing?.id ?? null;

  if (transition.action === "create") {
    const inserted = await requireQuery(
      supabase
        .from("alerts")
        .insert({ client_id: key.clientId, channel: key.channel, alert_type: key.alertType, period_kind: key.periodKind, ...patch } as Database["public"]["Tables"]["alerts"]["Insert"])
        .select("id"),
      "alerts:insert",
    );
    alertId = inserted[0]?.id ?? null;
  } else if (existing) {
    const updated = await requireQuery(
      supabase.from("alerts").update(patch).eq("id", existing.id).eq("updated_at", existing.updated_at).select("id"),
      "alerts:update",
    );
    if (updated.length === 0) return "ignored";
  }

  if (alertId) {
    await requireQuery(
      supabase
        .from("alert_events")
        .insert({
          alert_id: alertId,
          event_type: transition.eventType,
          from_status: existing?.status,
          to_status: transition.nextStatus,
          observed_value: candidate?.observedValue ?? null,
          reference_value: candidate?.referenceValue ?? null,
          diff_percent: candidate?.diffPercent ?? null,
        })
        .select("id"),
      "alert_events:insert",
    );
  }

  return transition.action === "create" ? "created" : transition.action === "resolve" ? "resolved" : "updated";
}
