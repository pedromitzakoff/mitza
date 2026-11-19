import type { AlertCandidate, AlertEventType, AlertStatus, AlertType } from "@/lib/alerts/alert-types";

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

/**
 * A resolução automática grava o mesmo instante em resolved_at e
 * last_evaluated_at. A resolução manual mantém a data da avaliação,
 * inclusive nos alertas que já estavam resolvidos antes desta regra.
 */
export function shouldKeepManualResolution(
  existing: {
    status: AlertStatus;
    resolved_at: string | null;
    last_evaluated_at: string;
    period_end: string;
    detail: unknown;
  },
  candidate: AlertCandidate<number | null>,
  alertType: AlertType,
): boolean {
  if (existing.status !== "resolvido" || !existing.resolved_at || existing.resolved_at === existing.last_evaluated_at) {
    return false;
  }

  if (alertType === "sync_issue" && existing.detail && typeof existing.detail === "object") {
    const reviewed = existing.detail as Record<string, unknown>;
    const issueKeys = ["missingDates", "failedDates", "partialDates"];
    if (issueKeys.every((key) => Array.isArray(reviewed[key]) && Array.isArray(candidate.detail[key]))) {
      return issueKeys.every((key) => {
        const reviewedDates = new Set(reviewed[key] as string[]);
        return (candidate.detail[key] as string[]).every((date) => reviewedDates.has(date));
      });
    }
  }

  return candidate.periodEnd <= existing.period_end;
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
