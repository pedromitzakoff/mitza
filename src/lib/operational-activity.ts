import { businessDaysSince } from "./business-days";
import { OPERATIONAL_ACTIVITY_STATUS_REGISTRY } from "@/lib/status-registry";

/**
 * Limites centralizados do conceito de "atividade operacional relevante" —
 * nenhum número solto pelos componentes, tudo deriva daqui.
 */
export const OPERATIONAL_ACTIVITY_THRESHOLDS = {
  activeMaxBusinessDays: 1,
  warningBusinessDays: 2,
  inactiveMinBusinessDays: 3,
} as const;

export type OperationalActivityStatus = "ativo" | "atencao" | "inativo";

/** Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1 — `atencao` agora é "Operação em atenção" (qualificado:
 * o mesmo valor de enum também existe, com outro significado, em
 * `AccountHealth`). */
export const OPERATIONAL_ACTIVITY_STATUS_LABEL: Record<OperationalActivityStatus, string> = {
  ativo: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.ativo"].label,
  atencao: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.atencao"].label,
  inativo: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.inativo"].label,
};

export const OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.ativo"].badgeClassName,
  atencao: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.atencao"].badgeClassName,
  inativo: OPERATIONAL_ACTIVITY_STATUS_REGISTRY["operational_activity.inativo"].badgeClassName,
};

/**
 * `businessDays` é o resultado de `businessDaysSince(lastActivityAt, today)`,
 * ou `null` se nunca houve nenhuma atividade registrada.
 */
export function classifyOperationalActivityStatus(
  businessDays: number | null,
): OperationalActivityStatus {
  if (businessDays === null) return "inativo";
  if (businessDays <= OPERATIONAL_ACTIVITY_THRESHOLDS.activeMaxBusinessDays) return "ativo";
  if (businessDays === OPERATIONAL_ACTIVITY_THRESHOLDS.warningBusinessDays) return "atencao";
  return "inativo";
}

function calendarDayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/** "Hoje" / "Ontem" / "Há N dias úteis" / "Nunca houve atividade". */
export function formatLastActivityLabel(lastActivityAt: Date | null, today: Date): string {
  if (!lastActivityAt) return "Nunca houve atividade";

  const calendarDiff = calendarDayDiff(lastActivityAt, today);
  if (calendarDiff <= 0) return "Hoje";
  if (calendarDiff === 1) return "Ontem";

  const businessDays = businessDaysSince(lastActivityAt, today);
  return businessDays === 1 ? "Há 1 dia útil" : `Há ${businessDays} dias úteis`;
}
