import type { AlertCandidate } from "@/lib/alerts/alert-types";
import { DEFAULT_BALANCE_DEPLETION_THRESHOLDS, type BalanceDepletionThresholds } from "@/lib/alerts/balance-depletion-thresholds";

/**
 * Núcleo puro do alerta "Saldo esgotando" (pedido explícito do usuário:
 * "coloque como alerta quando estivermos 3 dias antes do saldo esgotar se
 * manter o mesmo investimento do dia anterior"). Só se aplica a contas
 * PRÉ-PAGAS com saldo conhecido — quem chama (`evaluate-balance-
 * depletion.ts`) nunca invoca isto pra conta pós-paga/saldo indisponível,
 * mesmo critério de `CockpitAdAccountBalance` (`balance` só existe pra
 * `isPrepay: true`).
 *
 * `dailySpendYesterday <= 0` nunca produz alerta (seção 5, convenção já
 * usada em `detectSpendPaceAlert`: "não disparar alertas sem dados
 * suficientes") — sem ritmo de gasto, não há base pra projetar quando o
 * saldo esgota.
 */
export function detectBalanceDepletionAlert(input: {
  balance: number;
  currency: string;
  dailySpendYesterday: number;
  periodStart: string;
  periodEnd: string;
  thresholds?: BalanceDepletionThresholds;
}): AlertCandidate | null {
  const thresholds = input.thresholds ?? DEFAULT_BALANCE_DEPLETION_THRESHOLDS;
  const { balance, currency, dailySpendYesterday, periodStart, periodEnd } = input;

  if (dailySpendYesterday <= 0) return null;

  const daysRemaining = balance / dailySpendYesterday;
  if (daysRemaining > thresholds.attentionDaysRemaining) return null;

  const severity = daysRemaining <= thresholds.criticalDaysRemaining ? "critico" : "atencao";
  const roundedDays = Math.max(0, Math.floor(daysRemaining));
  const daysLabel = roundedDays === 0 ? "menos de 1 dia" : roundedDays === 1 ? "1 dia" : `${roundedDays} dias`;

  const explanation = `Saldo deve esgotar em ${daysLabel} mantendo o investimento de ontem (${dailySpendYesterday.toFixed(2)} ${currency}/dia).`;

  return {
    severity,
    periodStart,
    periodEnd,
    observedValue: balance,
    referenceValue: dailySpendYesterday,
    // Não é um percentual de desvio (como em `detectSpendPaceAlert`) — pra
    // este tipo de alerta, `diffPercent` guarda os dias restantes
    // projetados. `alert-card.tsx` nunca usa este campo genérico pra
    // "balance_depletion" (tem um bloco de exibição próprio) — ele só
    // existe aqui porque `AlertCandidate.diffPercent` é obrigatório.
    diffPercent: daysRemaining,
    referenceIsEstimate: true,
    referenceSource: "other",
    explanation,
    detail: {
      daysRemaining,
      currency,
      thresholds,
    },
  };
}
