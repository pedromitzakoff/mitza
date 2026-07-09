/** Margem de tolerância pra considerar um gasto "dentro do esperado". */
export const SPEND_STATUS_MARGIN = 0.1; // ±10%

export type SpendStatus = "dentro" | "acima" | "abaixo";

/**
 * Compara um valor gasto com um valor esperado e classifica dentro da
 * margem de tolerância acima. Usado tanto no selo de cada sprint (esperado
 * proporcional aos dias já passados) quanto no painel geral do mês
 * (esperado = planejado do mês inteiro).
 */
export function classifySpendStatus(actual: number, expected: number): SpendStatus {
  if (expected <= 0) {
    return actual > 0 ? "acima" : "dentro";
  }

  const ratio = actual / expected;
  if (ratio > 1 + SPEND_STATUS_MARGIN) return "acima";
  if (ratio < 1 - SPEND_STATUS_MARGIN) return "abaixo";
  return "dentro";
}

/** Rótulo usado quando o status compara com o planejado total (sem
 * prorateio por dia) — painel geral do mês e resumo do mês na página do
 * cliente. */
export const SPEND_STATUS_LABEL: Record<SpendStatus, string> = {
  dentro: "Bateu meta",
  acima: "Acima",
  abaixo: "Abaixo",
};

export const SPEND_STATUS_BADGE_CLASSES: Record<SpendStatus, string> = {
  dentro: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};
