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
