import { businessDaysSince } from "@/lib/business-days";
import { todayUTC, todayDateString } from "@/lib/today";
import type { OptimizationType } from "@/lib/supabase/database.types";

export interface AccountReviewCadenceConfig {
  reviewsPerWeek: number;
  maxBusinessDaysWithoutReview: number;
  isActive: boolean;
}

export interface AccountReviewCadenceStatus {
  lastReviewedAt: string | null;
  daysSinceLastReview: number | null;
  reviewsThisWeek: number;
  cadenceGoal: number | null;
  cadenceMet: boolean | null;
  maxBusinessDaysWithoutReview: number | null;
  isOverdue: boolean | null;
  nextLimitDate: string | null;
  lastOptimizationType: OptimizationType | null;
  lastOptimizationAt: string | null;
}

function mondayOf(date: Date): Date {
  const dayOfWeek = date.getUTCDay(); // 0=domingo .. 6=sábado
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

/** Soma `businessDays` dias úteis a partir de `from` (dia seguinte já conta
 * como o primeiro candidato) — inverso de `businessDaysSince`, reaproveitando
 * a mesma regra de fim de semana. */
function addBusinessDays(from: Date, businessDays: number): Date {
  const cursor = new Date(from);
  let counted = 0;
  while (counted < businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) counted++;
  }
  return cursor;
}

/**
 * Cadência de Análises da Conta (Etapa 57, seção 25/27) — nunca inventa
 * datas fixas: só compara a meta configurada (`reviews_per_week`,
 * `max_business_days_without_review`) com o que de fato aconteceu. Conta no
 * máximo 1 análise por dia civil por cliente pra frequência semanal (seção
 * 26) — evita que múltiplas análises no mesmo dia inflem a meta, sem nunca
 * descartar os eventos em si (o histórico completo continua em
 * `account_reviews`, isto aqui só filtra o que CONTA pra meta).
 */
export function computeAccountReviewCadenceStatus(
  reviewedAtTimestamps: string[],
  config: AccountReviewCadenceConfig | null,
  today: Date = todayUTC(),
  lastOptimization: { type: OptimizationType; occurredAt: string } | null = null,
): AccountReviewCadenceStatus {
  const sorted = [...reviewedAtTimestamps].sort((a, b) => (a < b ? 1 : -1));
  const lastReviewedAt = sorted[0] ?? null;

  const distinctDays = new Set(reviewedAtTimestamps.map((ts) => todayDateString(new Date(ts))));
  const monday = mondayOf(today);
  const mondayStr = todayDateString(monday);
  const todayStr = todayDateString(today);
  const reviewsThisWeek = [...distinctDays].filter((d) => d >= mondayStr && d <= todayStr).length;

  const daysSinceLastReview = lastReviewedAt ? businessDaysSince(todayUTC(new Date(lastReviewedAt)), today) : null;

  const maxDays = config?.isActive ? config.maxBusinessDaysWithoutReview : null;
  const isOverdue = maxDays !== null && daysSinceLastReview !== null ? daysSinceLastReview > maxDays : null;

  const nextLimitDate =
    maxDays !== null && lastReviewedAt
      ? todayDateString(addBusinessDays(todayUTC(new Date(lastReviewedAt)), maxDays))
      : null;

  return {
    lastReviewedAt,
    daysSinceLastReview,
    reviewsThisWeek,
    cadenceGoal: config?.isActive ? config.reviewsPerWeek : null,
    cadenceMet: config?.isActive ? reviewsThisWeek >= config.reviewsPerWeek : null,
    maxBusinessDaysWithoutReview: maxDays,
    isOverdue,
    nextLimitDate,
    lastOptimizationType: lastOptimization?.type ?? null,
    lastOptimizationAt: lastOptimization?.occurredAt ?? null,
  };
}
