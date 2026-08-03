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

/** Integração Google Ads (seletor de plataforma) — nunca confundir com
 * "sem dado no período" (`NO_ANALYTICS_DATA_MESSAGE`): esse estado é sobre
 * NUNCA ter existido uma fonte configurada pra este canal neste cliente,
 * nunca sobre o período selecionado estar vazio. */
export const GOOGLE_NOT_CONNECTED_MESSAGE = "Google Ads ainda não está conectado para este cliente.";
export const GOOGLE_NOT_CONNECTED_HINT = "Fale com o time responsável pela integração para configurar a conexão com o Google Ads desta conta.";
export const CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE = "Criativos do Google ainda não estão disponíveis nesta versão.";

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
