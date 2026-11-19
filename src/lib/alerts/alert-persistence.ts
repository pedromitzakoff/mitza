import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { AlertCandidate, AlertEventType, AlertPeriodKind, AlertStatus, AlertType } from "@/lib/alerts/alert-types";

type AdminSupabase = SupabaseClient<Database>;

/**
 * Máquina de estados pura da seção 3/5 do pedido ("Acompanhamento de
 * problemas conhecidos" / "Persistência e prevenção de ruído") — decide,
 * a cada avaliação automática, o que fazer com o alerta existente (ou a
 * ausência de um) dado se a condição está presente agora (`hasCandidate`).
 *
 * Nunca decide SEVERIDADE/valores (isso vem do detector, ex.
 * `detectSpendPaceAlert`) — só a transição de STATUS, que é a mesma lógica
 * pra qualquer tipo de alerta (todos compartilham `alerts.status`).
 *
 * Exemplo real do pedido (cliente INL): status vira "acompanhamento" pela
 * ação manual `followUpTomorrowAction` (fora deste reducer). Na avaliação
 * automática SEGUINTE:
 *  - condição desapareceu (gasto normalizou) -> `resolve` ("resolvido_auto").
 *  - condição persiste (mesma ou pior) -> `update` pra "precisa_atencao"
 *    ("retomado_atencao") — "devolver pra precisa de atenção, destacando a
 *    persistência" é exatamente isto; o pedido não distingue "persistiu" de
 *    "piorou" como destinos diferentes, os dois voltam pra atenção, só o
 *    detalhe do evento registra a severidade antes/depois pra quem olhar o
 *    histórico notar que piorou.
 */
export interface ExistingAlertForEvaluation {
  status: AlertStatus;
}

/** União discriminada por `action` — `nextStatus`/`eventType` só existem
 * (e são sempre não-nulos) quando `action !== "ignore"`, nunca um `null`
 * solto que quem chama precisaria checar na mão. */
export type AlertEvaluationTransition =
  | { action: "ignore" }
  | {
      action: "create" | "update" | "resolve";
      nextStatus: AlertStatus;
      eventType: AlertEventType;
      /** `true` quando esta é uma NOVA ocorrência (1ª detecção, ou
       * reabertura depois de "resolvido") — `first_detected_at` deve ser
       * `now()`, nunca o valor antigo, pra "destacar problemas que
       * persistem por vários dias" contar só a duração da ocorrência
       * atual. */
      resetFirstDetected: boolean;
    };

export function reduceAlertEvaluation(existing: ExistingAlertForEvaluation | null, hasCandidate: boolean): AlertEvaluationTransition {
  if (!existing) {
    if (!hasCandidate) {
      return { action: "ignore" };
    }
    return { action: "create", nextStatus: "precisa_atencao", eventType: "criado", resetFirstDetected: true };
  }

  if (existing.status === "resolvido") {
    if (!hasCandidate) {
      return { action: "ignore" };
    }
    // "Se o problema reaparecer após resolução, reabrir..." — reaproveita a
    // MESMA linha (histórico contínuo em alert_events), nunca um INSERT novo.
    return { action: "update", nextStatus: "precisa_atencao", eventType: "reaberto", resetFirstDetected: true };
  }

  if (existing.status === "precisa_atencao") {
    if (!hasCandidate) {
      return { action: "resolve", nextStatus: "resolvido", eventType: "resolvido_auto", resetFirstDetected: false };
    }
    return { action: "update", nextStatus: "precisa_atencao", eventType: "avaliado", resetFirstDetected: false };
  }

  // existing.status === "acompanhamento"
  if (!hasCandidate) {
    return { action: "resolve", nextStatus: "resolvido", eventType: "resolvido_auto", resetFirstDetected: false };
  }
  return { action: "update", nextStatus: "precisa_atencao", eventType: "retomado_atencao", resetFirstDetected: false };
}

/**
 * Parte impura (leitura/gravação no banco) compartilhada por QUALQUER
 * avaliador de alerta — extraída de `evaluate-spend-pace.ts` quando
 * "Saldo esgotando" (`evaluate-balance-depletion.ts`) virou o 2º avaliador
 * a precisar exatamente da mesma sequência (ler linha existente -> decidir
 * transição via `reduceAlertEvaluation` -> upsert em `alerts` -> registrar
 * `alert_events`). Chave única de sempre: `(client_id, channel, alert_type,
 * period_kind)` — UMA linha reaproveitada, nunca um INSERT novo pro mesmo
 * problema contínuo.
 */
export async function persistAlertEvaluation(
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
