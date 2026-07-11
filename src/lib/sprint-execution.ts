import { businessDaysSince } from "./business-days";
import { formatLastActivityLabel, OPERATIONAL_ACTIVITY_THRESHOLDS } from "./operational-activity";
import type { AttentionAlert } from "./attention-alerts";
import type { SprintTemporalStatus } from "./sprint-financials";

export interface SprintExecutionInfo {
  businessDays: number;
  /** Data (YYYY-MM-DD) usada como referência pra contar os dias úteis —
   * a última atividade da sprint, ou o início dela se nunca houve atividade. */
  referenceDate: string;
  severity: "atencao" | "critico";
}

/**
 * "Sprint sem execução": mede há quanto tempo não existe evidência de
 * trabalho manual na sprint atual — separado da inatividade geral do
 * cliente (que olha a conta como um todo, não uma sprint específica).
 * O contador usa a data mais recente entre o início da sprint e a última
 * atividade vinculada a ela, exatamente como pedido. Única fonte dessa
 * regra — `buildSprintExecutionAlert` (mensagem da página do cliente) e a
 * Central de Atenção (Visão Geral) chamam esta função, nunca duplicam o
 * cálculo.
 */
export function computeSprintExecutionInfo(
  sprint: { temporalStatus: SprintTemporalStatus; startDate: string },
  lastSprintActivityAt: Date | null,
  today: Date,
): SprintExecutionInfo | null {
  if (sprint.temporalStatus !== "atual") return null;

  const start = new Date(`${sprint.startDate}T00:00:00Z`);
  const reference =
    lastSprintActivityAt && lastSprintActivityAt > start ? lastSprintActivityAt : start;

  const businessDays = businessDaysSince(reference, today);
  const referenceDate = reference.toISOString().slice(0, 10);

  if (businessDays === OPERATIONAL_ACTIVITY_THRESHOLDS.warningBusinessDays) {
    return { businessDays, referenceDate, severity: "atencao" };
  }
  if (businessDays >= OPERATIONAL_ACTIVITY_THRESHOLDS.inactiveMinBusinessDays) {
    return { businessDays, referenceDate, severity: "critico" };
  }
  return null;
}

/** "Última execução da sprint" — mesmo texto ("Hoje"/"Ontem"/"Há N dias
 * úteis") usado pela página do cliente e pelo painel Sprints, pra nunca
 * divergir: última atividade vinculada à sprint, ou o início dela se nunca
 * houve nenhuma. Só faz sentido pra sprint atual (chamador decide isso). */
export function formatSprintExecutionLabel(
  lastSprintActivityAt: Date | null,
  sprintStartDate: string,
  today: Date,
): string {
  return formatLastActivityLabel(lastSprintActivityAt ?? new Date(`${sprintStartDate}T00:00:00Z`), today);
}

export function buildSprintExecutionAlert(
  sprint: { temporalStatus: SprintTemporalStatus; startDate: string },
  lastSprintActivityAt: Date | null,
  today: Date,
): AttentionAlert | null {
  const info = computeSprintExecutionInfo(sprint, lastSprintActivityAt, today);
  if (!info) return null;

  return {
    severity: info.severity,
    kind: "atividade",
    message: `Sprint sem execução há ${info.businessDays} dias úteis.`,
  };
}
