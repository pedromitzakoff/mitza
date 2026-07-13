/** Margem de tolerância pra considerar um gasto "dentro do esperado". */
export const SPEND_STATUS_MARGIN = 0.1; // ±10%

/** "nao_iniciado" é status TEMPORAL disfarçado de financeiro — só existe
 * pra sprints que ainda não começaram (ver `classifySprintSpendStatus` em
 * sprint-financials.ts), nunca produzido por esta função (`classifySpendStatus`
 * lida só com números, sem saber se o período já começou). */
export type SpendStatus = "dentro" | "acima" | "abaixo" | "sem_meta" | "nao_iniciado";

/**
 * Compara um valor gasto com um valor esperado e classifica dentro da
 * margem de tolerância acima. Usado tanto no selo de cada sprint (esperado
 * proporcional aos dias já passados) quanto no painel geral do mês
 * (esperado = planejado do mês inteiro).
 *
 * `plannedTotal` é o planejado "cru" (não prorateado) — serve só para
 * detectar meta não configurada. Sem essa distinção, uma sprint com
 * planejado > 0 mas que ainda não começou (esperado prorateado = 0) seria
 * confundida com uma sprint sem planejado nenhum.
 */
export function classifySpendStatus(
  actual: number,
  expected: number,
  plannedTotal: number,
): SpendStatus {
  if (!plannedTotal || plannedTotal <= 0) {
    return "sem_meta";
  }

  if (expected <= 0) {
    // Planejado configurado, mas o período ainda não começou.
    return actual > 0 ? "acima" : "dentro";
  }

  const ratio = actual / expected;
  if (ratio > 1 + SPEND_STATUS_MARGIN) return "acima";
  if (ratio < 1 - SPEND_STATUS_MARGIN) return "abaixo";
  return "dentro";
}

/** Rótulo usado quando o status compara com o planejado total (sem
 * prorateio por dia) — painel geral do mês e resumo do mês na página do
 * cliente. Etapa 53: nunca mais "Bateu meta"/"Meta atingida" — o
 * acompanhamento é de RITMO de investimento, não de conquista de meta. */
export const SPEND_STATUS_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
};

export const SPEND_STATUS_BADGE_CLASSES: Record<SpendStatus, string> = {
  dentro: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  sem_meta: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  nao_iniciado: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};
