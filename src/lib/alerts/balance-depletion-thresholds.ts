/**
 * Alerta "Saldo esgotando" (pedido explícito do usuário: "coloque como
 * alerta quando estivermos 3 dias antes do saldo esgotar se manter o mesmo
 * investimento do dia anterior") — parâmetro configurável, mesmo padrão de
 * `SpendPaceThresholds`. Mudar uma constante aqui reclassifica toda
 * avaliação futura (nunca duplicada em outro lugar do código).
 */
export interface BalanceDepletionThresholds {
  /** Dias restantes (saldo ÷ gasto de ontem) iguais ou abaixo disto já
   * dispara o alerta — pedido original: "3 dias antes"; ampliado para 5
   * dias a pedido do usuário ("quando tiver a 5 dias de acabar quero ser
   * avisado"). */
  attentionDaysRemaining: number;
  /** Dias restantes iguais ou abaixo disto viram "crítico" em vez de
   * "atenção" — refinamento (não pedido explicitamente), mesmo padrão de
   * 2 níveis já usado em `SpendPaceThresholds`. */
  criticalDaysRemaining: number;
}

export const DEFAULT_BALANCE_DEPLETION_THRESHOLDS: BalanceDepletionThresholds = {
  attentionDaysRemaining: 5,
  criticalDaysRemaining: 2,
};
