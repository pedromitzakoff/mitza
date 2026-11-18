/**
 * Aba "Reports" (pedido, seção 3) — limiares de volume mínimo pra um
 * anúncio ser elegível a um destaque. A plataforma não tem limiares
 * configuráveis por cliente pra isso hoje (achado da pesquisa: nenhuma
 * coluna/config equivalente existe) — por isso os valores iniciais do
 * próprio pedido ("3 resultados e 1.000 impressões"), centralizados aqui
 * pra ajuste futuro (mudar uma constante reclassifica toda geração
 * seguinte, nunca duplicado em outro lugar do código).
 */
export interface AdHighlightThresholds {
  /** Mínimo de resultados pra um anúncio ser elegível ao destaque "Melhor
   * custo por resultado". */
  minResults: number;
  /** Mínimo de impressões pra um anúncio ser elegível ao destaque "Melhor
   * CTR de link". */
  minImpressions: number;
}

export const DEFAULT_AD_HIGHLIGHT_THRESHOLDS: AdHighlightThresholds = {
  minResults: 3,
  minImpressions: 1000,
};
