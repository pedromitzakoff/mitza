/**
 * Calculadora pura do editor de Planejamento por Canal (Etapa "Calculadora
 * Visual Multicanal") — Investimento, Resultado e CPA/CPL de UM canal
 * seguem sempre `Investimento = Resultado × CPA`; o gestor informa
 * QUAISQUER dois campos e o terceiro é sempre derivado, nunca digitado.
 *
 * Regra de recência: cada card mantém uma fila de 3 campos ordenada por
 * "há quanto tempo não é editado manualmente" — a posição 0 é sempre o
 * campo que fica mais tempo sem toque, e é ele que vira o derivado no
 * próximo campo editado. Editar um campo sempre o move pro fim da fila
 * (mais recente) e recalcula o que estiver na posição 0 a partir dos outros
 * dois — nunca depende de qual campo foi editado "primeiro" na sessão, só
 * de recência relativa, então funciona pra qualquer sequência de edições:
 * Investimento então Resultado (deriva CPA), Investimento então CPA (deriva
 * Resultado), ou Resultado então CPA (deriva o próprio Investimento — o
 * caso que a versão anterior desta calculadora, com Investimento como
 * âncora fixa, nunca conseguia produzir).
 *
 * `DEFAULT_FIELD_ORDER` começa com CPA na posição 0 (derivado primeiro) —
 * mesmo comportamento inicial de antes desta etapa pro caso mais comum
 * (Investimento então Resultado).
 */
export type CalculatorField = "investment" | "resultCount" | "cpa";

export const DEFAULT_FIELD_ORDER: CalculatorField[] = ["cpa", "resultCount", "investment"];

export interface CalculatorValues {
  investment: number | null;
  resultCount: number | null;
  cpa: number | null;
}

export interface CalculatorDerivation {
  fieldOrder: CalculatorField[];
  derivedField: CalculatorField;
  derivedValue: number | null;
}

/**
 * `values` já deve refletir o campo recém-editado (`changedField`) com seu
 * novo valor — esta função só decide QUAL dos outros dois campos recalcular
 * e QUAL o novo valor dele; nunca lê/mexe em texto de input, formatação
 * monetária ou estado de React (isso é responsabilidade do componente).
 */
export function deriveOnFieldChange(
  changedField: CalculatorField,
  fieldOrder: CalculatorField[],
  values: CalculatorValues,
): CalculatorDerivation {
  const nextOrder = [...fieldOrder.filter((f) => f !== changedField), changedField];
  const derivedField = nextOrder[0];

  let derivedValue: number | null;
  if (derivedField === "cpa") {
    // CPA = Investimento ÷ Resultado — nunca divide por resultado 0/null
    // (custo por zero resultados não é um número, mesma régua de
    // `safeDivide`/`computeCostPerResult`, lib/performance.ts).
    derivedValue =
      values.investment !== null && values.resultCount !== null && values.resultCount !== 0
        ? values.investment / values.resultCount
        : null;
  } else if (derivedField === "resultCount") {
    // Resultado = Investimento ÷ CPA — nunca divide por CPA 0/null.
    derivedValue =
      values.investment !== null && values.cpa !== null && values.cpa !== 0 ? Math.round(values.investment / values.cpa) : null;
  } else {
    // Investimento = Resultado × CPA — 0 é um valor real aqui (0 leads ×
    // qualquer CPA = R$0 investido é matematicamente válido), só null
    // quando falta um dos dois fatores.
    derivedValue = values.resultCount !== null && values.cpa !== null ? values.resultCount * values.cpa : null;
  }

  return { fieldOrder: nextOrder, derivedField, derivedValue };
}
