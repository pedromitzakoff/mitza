import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { shiftDays, startOfMonth, endOfMonth } from "@/lib/date-range";
import { listDatesInclusive } from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, filterRowsToPrimaryGoal, type ClientPlanChangeRow } from "@/lib/client-plan";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { resolveDailySpendReference, detectSpendPaceAlert } from "@/lib/alerts/spend-pace-detection";
import { reduceAlertEvaluation } from "@/lib/alerts/alert-persistence";
import { SPEND_PACE_HISTORY_WINDOW_DAYS } from "@/lib/alerts/spend-pace-thresholds";
import type { AlertCandidate, AlertPeriodKind, AlertStatus, AlertType } from "@/lib/alerts/alert-types";

type AdminSupabase = SupabaseClient<Database>;

/**
 * Orquestração (impura) do alerta "Gasto acima ou abaixo do previsto" —
 * roda pro conjunto inteiro de clientes+canais com dado em `daily_spend`
 * (pedido, seção 6: "integrada à rotina de sincronização ou a uma rotina
 * agendada, para que o acompanhamento continue mesmo quando ninguém estiver
 * com a aba aberta"). Mesmo formato do cron existente
 * (`syncAllMetaApiAccounts`): nunca para no primeiro erro de UM
 * cliente/canal — cada falha fica isolada, as demais continuam avaliando.
 *
 * Avalia DUAS janelas independentes por cliente+canal, cada uma com sua
 * própria linha em `alerts` (`period_kind` distinto, ver `supabase/alerts.sql`):
 *  - "full_day" (ontem, dia completo) — acompanhável, participa da máquina
 *    de estados completa (`reduceAlertEvaluation`).
 *  - "in_progress" (hoje, em andamento) — seção 4 do pedido, nunca sinaliza
 *    "abaixo" (dia incompleto).
 *
 * Nunca fabrica um `actualSpend` pra um dia SEM nenhuma linha em
 * `daily_spend` (pedido, seção 5: "não disparar alertas de performance sem
 * dados suficientes") — a ÚNICA exceção é "hoje", onde a ausência de linha
 * (sincronização ainda não rodou hoje) é tratada como 0, o que nunca
 * dispara o alerta de "hoje" de qualquer forma (ele só verifica excesso,
 * nunca falta).
 */
export interface SpendPaceEvaluationSummary {
  evaluated: number;
  created: number;
  updated: number;
  resolved: number;
  ignored: number;
  skippedNoYesterdayData: number;
  errors: { clientId: string; channel: string; periodKind: AlertPeriodKind; message: string }[];
}

interface DailySpendPoint {
  date: string;
  spend: number;
}

export async function evaluateSpendPaceAlerts(now: Date = new Date(), supabase: AdminSupabase = createAdminClient()): Promise<SpendPaceEvaluationSummary> {
  const today = todayDateString(now);
  const yesterday = shiftDays(today, -1);
  const windowStart = shiftDays(today, -(SPEND_PACE_HISTORY_WINDOW_DAYS + 1));
  const nowIso = now.toISOString();

  const [clients, dailySpendRows, planChangeRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, performance_goal").is("deleted_at", null), "clients:alerts-spend-pace"),
    requireQuery(
      supabase.from("daily_spend").select("client_id, channel, date, spend").gte("date", windowStart).lte("date", today),
      "daily_spend:alerts-spend-pace",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, channel, month, changed_at, new_amount, target_result_count, result_type")
        .lte("month", startOfMonth(today)),
      "monthly_budget_changes:alerts-spend-pace",
    ),
  ]);

  const primaryGoalByClientId = new Map(clients.map((c) => [c.id, c.performance_goal]));
  const planChangesByClient = new Map<string, ClientPlanChangeRow[]>();
  for (const row of filterRowsToPrimaryGoal(planChangeRows, primaryGoalByClientId)) {
    const list = planChangesByClient.get(row.client_id) ?? [];
    list.push({ channel: row.channel as TrafficChannel, month: row.month, changedAt: row.changed_at, investment: row.new_amount, targetResultCount: row.target_result_count });
    planChangesByClient.set(row.client_id, list);
  }

  const spendByClientChannel = new Map<string, DailySpendPoint[]>();
  for (const row of dailySpendRows) {
    const key = `${row.client_id}::${row.channel}`;
    const list = spendByClientChannel.get(key) ?? [];
    list.push({ date: row.date, spend: row.spend });
    spendByClientChannel.set(key, list);
  }

  const summary: SpendPaceEvaluationSummary = { evaluated: 0, created: 0, updated: 0, resolved: 0, ignored: 0, skippedNoYesterdayData: 0, errors: [] };

  for (const [key, points] of spendByClientChannel) {
    const [clientId, channel] = key.split("::") as [string, TrafficChannel];
    const planChanges = planChangesByClient.get(clientId) ?? [];

    // Janela "full_day" (ontem) — nunca fabrica actualSpend se não houver
    // linha pra ontem (sincronização pode ter falhado, ver seção 5 do pedido).
    const yesterdayRow = points.find((p) => p.date === yesterday);
    if (!yesterdayRow) {
      summary.skippedNoYesterdayData++;
    } else {
      try {
        const outcome = await evaluateAndPersist(supabase, {
          clientId,
          channel,
          periodKind: "full_day",
          actualSpend: yesterdayRow.spend,
          evaluatedDate: yesterday,
          isPeriodInProgress: false,
          points,
          planChanges,
          nowIso,
        });
        bumpSummary(summary, outcome);
      } catch (err) {
        summary.errors.push({ clientId, channel, periodKind: "full_day", message: err instanceof Error ? err.message : String(err) });
      }
    }

    // Janela "in_progress" (hoje) — ausência de linha hoje = 0 (sync ainda
    // não rodou), nunca dispara por si só (o detector só verifica excesso
    // aqui, nunca falta).
    const todayRow = points.find((p) => p.date === today);
    try {
      const outcome = await evaluateAndPersist(supabase, {
        clientId,
        channel,
        periodKind: "in_progress",
        actualSpend: todayRow?.spend ?? 0,
        evaluatedDate: today,
        isPeriodInProgress: true,
        points,
        planChanges,
        nowIso,
      });
      bumpSummary(summary, outcome);
    } catch (err) {
      summary.errors.push({ clientId, channel, periodKind: "in_progress", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

function bumpSummary(summary: SpendPaceEvaluationSummary, outcome: "created" | "updated" | "resolved" | "ignored") {
  summary.evaluated++;
  summary[outcome]++;
}

async function evaluateAndPersist(
  supabase: AdminSupabase,
  input: {
    clientId: string;
    channel: TrafficChannel;
    periodKind: AlertPeriodKind;
    actualSpend: number;
    evaluatedDate: string;
    isPeriodInProgress: boolean;
    points: DailySpendPoint[];
    planChanges: ClientPlanChangeRow[];
    nowIso: string;
  },
): Promise<"created" | "updated" | "resolved" | "ignored"> {
  const { clientId, channel, periodKind, actualSpend, evaluatedDate, isPeriodInProgress, points, planChanges, nowIso } = input;

  const monthStart = startOfMonth(evaluatedDate);
  const monthEnd = endOfMonth(evaluatedDate);
  const plan = resolveClientMonthlyPlan({ channels: [channel], changes: planChanges, selectedMonth: monthStart });
  const monthlyBudget = plan.byChannel[channel]?.investment ?? null;
  const daysInMonth = listDatesInclusive(monthStart, monthEnd).length;

  const historyFloor = shiftDays(evaluatedDate, -SPEND_PACE_HISTORY_WINDOW_DAYS);
  const historicalDailySpends = points.filter((p) => p.date < evaluatedDate && p.date >= historyFloor).map((p) => p.spend);

  const reference = resolveDailySpendReference({ monthlyBudget, daysInMonth, historicalDailySpends });
  const candidate = detectSpendPaceAlert({
    actualSpend,
    periodStart: evaluatedDate,
    periodEnd: evaluatedDate,
    dailyReference: reference,
    isPeriodInProgress,
  });

  return persistAlertEvaluation(supabase, { clientId, channel, alertType: "spend_pace", periodKind }, candidate, nowIso);
}

async function persistAlertEvaluation(
  supabase: AdminSupabase,
  key: { clientId: string; channel: TrafficChannel; alertType: AlertType; periodKind: AlertPeriodKind },
  candidate: AlertCandidate | null,
  nowIso: string,
): Promise<"created" | "updated" | "resolved" | "ignored"> {
  const existingRows = await requireQuery(
    supabase
      .from("alerts")
      .select("id, status")
      .eq("client_id", key.clientId)
      .eq("channel", key.channel)
      .eq("alert_type", key.alertType)
      .eq("period_kind", key.periodKind)
      .limit(1),
    "alerts:existing",
  );
  const existing = existingRows[0] ?? null;

  const transition = reduceAlertEvaluation(existing ? { status: existing.status as AlertStatus } : null, candidate !== null);
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
  } else if (alertId) {
    await requireQuery(supabase.from("alerts").update(patch).eq("id", alertId).select("id"), "alerts:update");
  }

  if (alertId) {
    await requireQuery(
      supabase
        .from("alert_events")
        .insert({
          alert_id: alertId,
          event_type: transition.eventType,
          from_status: existing?.status as AlertStatus | undefined,
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
