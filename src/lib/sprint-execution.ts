import { businessDaysSince } from "./business-days";
import { OPERATIONAL_ACTIVITY_THRESHOLDS } from "./operational-activity";
import type { AttentionAlert } from "./attention-alerts";
import type { SprintTemporalStatus } from "./sprint-financials";

/**
 * "Sprint sem execução": mede há quanto tempo não existe evidência de
 * trabalho manual na sprint atual — separado da inatividade geral do
 * cliente (que olha a conta como um todo, não uma sprint específica).
 * O contador usa a data mais recente entre o início da sprint e a última
 * atividade vinculada a ela, exatamente como pedido.
 */
export function buildSprintExecutionAlert(
  sprint: { temporalStatus: SprintTemporalStatus; startDate: string },
  lastSprintActivityAt: Date | null,
  today: Date,
): AttentionAlert | null {
  if (sprint.temporalStatus !== "atual") return null;

  const start = new Date(`${sprint.startDate}T00:00:00Z`);
  const reference =
    lastSprintActivityAt && lastSprintActivityAt > start ? lastSprintActivityAt : start;

  const businessDays = businessDaysSince(reference, today);

  if (businessDays === OPERATIONAL_ACTIVITY_THRESHOLDS.warningBusinessDays) {
    return { severity: "atencao", kind: "atividade", message: `Sprint sem execução há ${businessDays} dias úteis.` };
  }

  if (businessDays >= OPERATIONAL_ACTIVITY_THRESHOLDS.inactiveMinBusinessDays) {
    return { severity: "critico", kind: "atividade", message: `Sprint sem execução há ${businessDays} dias úteis.` };
  }

  return null;
}
