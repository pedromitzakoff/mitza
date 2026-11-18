/**
 * Alerta "Gasto acima ou abaixo do previsto" (pedido do usuário, seção 2.1) —
 * parâmetros iniciais CONFIGURÁVEIS, exatamente os valores que o pedido deu
 * como ponto de partida. Mudar uma constante aqui reclassifica toda avaliação
 * futura (nunca duplicada em outro lugar do código).
 *
 * As três razões são sobre o PREVISTO (`actual / reference`), não sobre o
 * desvio relativo — "abaixo de 40% do previsto" significa `actual` ser menor
 * que 40% da referência diária (`ratio < 0.40`), não "40% abaixo" (que seria
 * `ratio < 0.60`). As duas leituras de "acima" do pedido já são razão sobre
 * 1 (`ratio > 1.30`/`ratio > 1.60`), então as três usam a mesma forma
 * (`ratio`), nunca uma mistura de duas convenções diferentes.
 */
export interface SpendPaceThresholds {
  /** `ratio = actual / reference` acima disto (ratio > 1 + attentionOverRatio) = "Acima: atenção". */
  attentionOverRatio: number;
  /** `ratio` acima disto (ratio > 1 + criticalOverRatio) = "Acima: crítico" — sempre > attentionOverRatio. */
  criticalOverRatio: number;
  /** `ratio` abaixo disto (actual é menor que X% do previsto) = "Abaixo: atenção" — nunca aplicado num dia em andamento (seção 4 do pedido). */
  attentionUnderRatio: number;
  /** Diferença mínima em reais entre `actual` e `reference` pra sequer considerar o alerta — evita ruído de contas com orçamento irrelevante (pedido: "diferença mínima em reais, configurável"). */
  minDiffReais: number;
}

export const DEFAULT_SPEND_PACE_THRESHOLDS: SpendPaceThresholds = {
  attentionOverRatio: 0.3, // "Acima de 30%: atenção."
  criticalOverRatio: 0.6, // "Acima de 60%: crítico."
  attentionUnderRatio: 0.4, // "Abaixo de 40% do previsto: atenção."
  minDiffReais: 50,
};

/** Histórico recente usado como referência alternativa quando o cliente não
 * tem orçamento mensal cadastrado (pedido, seção 2.1: "usar o histórico
 * recente como referência alternativa, deixando isso explícito"). */
export const SPEND_PACE_HISTORY_WINDOW_DAYS = 14;
