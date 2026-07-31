/**
 * Textos compartilhados entre a tela do Analytics e o AnalyticsReport —
 * arquivo único pra garantir, estruturalmente, que os dois dizem exatamente
 * a mesma coisa nos mesmos estados (sem objetivo configurado, sem dado no
 * período, sem destaques/criativos/campanhas). Nunca copiar uma string
 * literal em mais de um lugar — sempre importar daqui.
 */
export const NO_PERFORMANCE_GOAL_MESSAGE = "Este cliente ainda não tem um objetivo de performance configurado.";
export const NO_ANALYTICS_DATA_MESSAGE = "Não encontramos dados para o período selecionado.";
export const NO_HIGHLIGHTS_MESSAGE = "Ainda não há destaques suficientes pra este período.";
export const NO_LEARNINGS_MESSAGE = "Ainda não há dados suficientes para explicar o resultado neste período.";
export const NO_CREATIVES_MESSAGE = "Nenhum dado de criativo encontrado no período selecionado.";
export const NO_CAMPAIGNS_MESSAGE = "Nenhum dado de campanha encontrado no período selecionado.";

export const OPPORTUNITIES_EMPTY_MESSAGE = "As oportunidades automáticas desta conta ainda não foram implementadas.";
export const OPPORTUNITIES_IN_DEVELOPMENT_LABEL = "Em desenvolvimento";
export const FUTURE_OPPORTUNITY_CATEGORIES = [
  "Aumentar investimento em um criativo com bom desempenho",
  "Revisar uma campanha com queda de desempenho",
  "Testar novamente um criativo que já performou bem",
  "Escalar uma campanha com espaço pra crescer",
  "Substituir um criativo que perdeu eficiência",
];

export const INSIGHTS_EMPTY_MESSAGE = "Os insights automáticos desta conta ainda não foram implementados.";
export const INSIGHTS_IN_DEVELOPMENT_LABEL = "Em desenvolvimento";
export const FUTURE_INSIGHT_CATEGORIES = [
  "Melhor criativo do mês",
  "Campanha com maior crescimento",
  "Criativo com menor custo por resultado",
  "Criativo recebendo muito investimento com baixo resultado",
  "Oportunidades de escala",
  "Alertas de desempenho",
];
