import { todayDateString } from "@/lib/today";

/**
 * Aba "Reports" (pedido, seção 1: "se faltar sincronizar parte do período,
 * exiba o card em Aguardando dados... diferencie ausência de dados de zero
 * resultados confirmado"). Um período só está completo quando todos os dias foram confirmados.
 */
export function isPeriodFullySynced(periodDates: readonly string[], syncedDates: ReadonlySet<string>): boolean {
  return periodDates.every((date) => syncedDates.has(date));
}

export function isReportDayConfirmed(input: {
  channelSources: ReadonlyArray<{ id: string; status: string; last_success_at: string | null; last_imported_date: string | null }>;
  day: string;
  covered: ReadonlySet<string>;
  mapped: ReadonlySet<string>;
  goal: string;
  usesGoal: boolean;
  manual: boolean;
  explicitSpend: boolean;
  explicitResult: boolean;
}): boolean {
  const { channelSources, day, covered, mapped, goal, usesGoal, manual, explicitSpend, explicitResult } = input;
  const explicit = explicitSpend && (!usesGoal || explicitResult);
  if (!channelSources.length) return explicit;

  if (channelSources.every((source) => covered.has(`${source.id}:${day}`))) {
    return !usesGoal || explicitResult || (!manual && channelSources.every((source) => mapped.has(`${source.id}:${goal}`)));
  }

  const [legacy] = channelSources;
  return channelSources.length === 1 && explicit && legacy.status === "active"
    && !!legacy.last_success_at && todayDateString(new Date(legacy.last_success_at)) > day
    && (legacy.last_imported_date ?? "") >= day;
}
