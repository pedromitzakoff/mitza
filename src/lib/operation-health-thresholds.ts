/**
 * Limiares centrais do Motor de Saúde da Conta (`account-health-engine.ts`)
 * — nenhum percentual/contagem de severidade deve existir fora deste
 * arquivo. Mudar um valor aqui reclassifica toda a Operação; nunca uma
 * segunda constante duplicada num componente.
 *
 * Cada dimensão com desvio numérico tem 3 cortes (leve/relevante/grave),
 * sempre expressos como fração do desvio relativo — mesma unidade que
 * `computeRelativeDeviation` (spend-status.ts) e `computeVariationFromTarget`
 * (performance.ts) já usam. `deviation > corte` decide a severidade; o
 * sinal (acima/abaixo) já foi resolvido por quem classifica cada dimensão
 * (ver `account-health-engine.ts`).
 */

// Investimento: desvio do realizado vs. esperado até hoje (calendário). Só o
// valor ABSOLUTO importa — investir rápido demais e devagar demais são os
// dois lados do mesmo problema de ritmo, mesma filosofia de
// `SPEND_STATUS_MARGIN`.
export const INVESTMENT_DEVIATION_LEVE = 0.15;
export const INVESTMENT_DEVIATION_RELEVANTE = 0.3;
export const INVESTMENT_DEVIATION_GRAVE = 0.5;

// Resultado: só desvio NEGATIVO (abaixo do esperado) é problema — superar a
// meta de resultado nunca é um desvio a ser sinalizado.
export const RESULT_DEVIATION_LEVE = 0.15;
export const RESULT_DEVIATION_RELEVANTE = 0.3;
export const RESULT_DEVIATION_GRAVE = 0.5;

// Custo por resultado: "menor é melhor" — só desvio POSITIVO (custo ACIMA da
// meta) é problema. Reaproveita a mesma escala de `COST_PRIORITY_DEVIATION_THRESHOLD`
// (30%, hoje em `performance.ts`) como o corte "relevante".
export const COST_DEVIATION_LEVE = 0.1;
export const COST_DEVIATION_RELEVANTE = 0.3;
export const COST_DEVIATION_GRAVE = 0.5;

/** Amostra mínima de resultados pra confiar no custo por resultado
 * calculado — abaixo disso, a dimensão de custo não avalia desvio nenhum
 * (ausência de evidência, nunca tratada como desempenho ruim). Reintroduzido
 * depois do feedback de aprovação do Motor de Saúde: um CPA de R$ 150 sobre
 * 1 resultado é tecnicamente correto, mas operacionalmente não significa
 * nada — a dimensão de custo fica em "nenhum" (não em "grave") até a
 * amostra crescer, e o gestor vê o motivo real ("aguardando amostra"), não
 * um falso alarme. Mesmo valor do antigo `MIN_RELIABLE_RESULT_COUNT` de
 * `operation-triage-data.ts` (Etapa 71).*/
export const MIN_RELIABLE_RESULT_COUNT = 3;

// Revisão: fração de quanto o prazo configurado (`account_review_cadences.
// max_business_days_without_review`) já foi ultrapassado — só importa
// ultrapassar (revisar antes do prazo nunca é desvio). "Grave" também
// cobre "nunca revisada" (ver account-health-engine.ts).
export const REVIEW_OVERDUE_LEVE = 0; // já passou do prazo, mas pouco
export const REVIEW_OVERDUE_RELEVANTE = 0.5; // 50% além do prazo
export const REVIEW_OVERDUE_GRAVE = 1.0; // o dobro do prazo, ou mais

/** Prazo padrão (dias úteis) usado só quando o cliente ainda não tem
 * `account_review_cadences` configurada — mesmo valor do limiar fixo que
 * existia antes desta etapa, agora só como FALLBACK, nunca a regra
 * primária (ver seção "Revisões" do pedido de aprovação). */
export const DEFAULT_REVIEW_MAX_BUSINESS_DAYS = 10;
