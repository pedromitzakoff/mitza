/**
 * Testes puros da calculadora do editor de Planejamento por Canal (Etapa
 * "Calculadora Visual Multicanal") — `deriveOnFieldChange`
 * (lib/channel-plan-calculator.ts). Cobre os 3 exemplos canônicos do
 * contrato (Investimento = Resultado × CPA, quaisquer dois campos
 * determinam o terceiro — inclusive derivar o próprio Investimento, o caso
 * que a versão anterior desta calculadora, com Investimento como âncora
 * fixa, nunca conseguia produzir) e os casos de borda de divisão por
 * zero/null.
 *
 * Rodar: npx tsx scripts/test-channel-plan-calculator.ts
 */
import assert from "node:assert/strict";
import { deriveOnFieldChange, DEFAULT_FIELD_ORDER, type CalculatorField } from "../src/lib/channel-plan-calculator";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("Exemplo 1: R$1.000 + 100 leads -> CPA R$10\n");
{
  let order: CalculatorField[] = DEFAULT_FIELD_ORDER;

  let step = deriveOnFieldChange("investment", order, { investment: 1000, resultCount: null, cpa: null });
  check("digita Investimento=1000 primeiro -> nada mais pra derivar ainda, CPA fica null", step, {
    fieldOrder: ["cpa", "resultCount", "investment"],
    derivedField: "cpa",
    derivedValue: null,
  });
  order = step.fieldOrder;

  step = deriveOnFieldChange("resultCount", order, { investment: 1000, resultCount: 100, cpa: null });
  check("digita Resultado=100 em seguida -> deriva CPA = 1000 / 100 = 10", step, {
    fieldOrder: ["cpa", "investment", "resultCount"],
    derivedField: "cpa",
    derivedValue: 10,
  });
}

console.log("\nExemplo 2: R$1.000 + CPA R$10 -> 100 leads\n");
{
  let order: CalculatorField[] = DEFAULT_FIELD_ORDER;

  let step = deriveOnFieldChange("investment", order, { investment: 1000, resultCount: null, cpa: null });
  order = step.fieldOrder;

  step = deriveOnFieldChange("cpa", order, { investment: 1000, resultCount: null, cpa: 10 });
  check("digita CPA=10 (sem passar por Resultado) -> deriva Resultado = round(1000 / 10) = 100", step, {
    fieldOrder: ["resultCount", "investment", "cpa"],
    derivedField: "resultCount",
    derivedValue: 100,
  });
}

console.log("\nExemplo 3: 100 leads + CPA R$10 -> R$1.000 investimento (Investimento como SAÍDA, não âncora)\n");
{
  let order: CalculatorField[] = DEFAULT_FIELD_ORDER;

  let step = deriveOnFieldChange("resultCount", order, { investment: null, resultCount: 100, cpa: null });
  check("digita Resultado=100 primeiro (Investimento nunca foi tocado) -> CPA ainda null", step, {
    fieldOrder: ["cpa", "investment", "resultCount"],
    derivedField: "cpa",
    derivedValue: null,
  });
  order = step.fieldOrder;

  step = deriveOnFieldChange("cpa", order, { investment: null, resultCount: 100, cpa: 10 });
  check(
    "digita CPA=10 em seguida -> deriva o próprio Investimento = 100 × 10 = 1000 (a versão anterior, âncora fixa, nunca fazia isso)",
    step,
    { fieldOrder: ["investment", "resultCount", "cpa"], derivedField: "investment", derivedValue: 1000 },
  );
}

console.log("\nCasos de borda\n");

check(
  "Resultado explicitamente ZERO + CPA -> Investimento derivado é 0 (valor real, não null: 0 leads × qualquer CPA = R$0)",
  deriveOnFieldChange("cpa", ["investment", "resultCount", "cpa"], { investment: null, resultCount: 0, cpa: 10 }),
  { fieldOrder: ["investment", "resultCount", "cpa"], derivedField: "investment", derivedValue: 0 },
);

check(
  "Investimento + Resultado ZERO -> CPA derivado é null (nunca divide por zero resultados)",
  deriveOnFieldChange("resultCount", ["cpa", "investment", "resultCount"], { investment: 1000, resultCount: 0, cpa: null }),
  { fieldOrder: ["cpa", "investment", "resultCount"], derivedField: "cpa", derivedValue: null },
);

check(
  "Investimento + CPA ZERO -> Resultado derivado é null (nunca divide por CPA zero)",
  deriveOnFieldChange("cpa", ["resultCount", "investment", "cpa"], { investment: 1000, resultCount: null, cpa: 0 }),
  { fieldOrder: ["resultCount", "investment", "cpa"], derivedField: "resultCount", derivedValue: null },
);

check(
  "só um dos dois campos-fonte disponível (falta Resultado) -> Investimento derivado é null, nunca 0 fabricado",
  deriveOnFieldChange("cpa", ["investment", "resultCount", "cpa"], { investment: 500, resultCount: null, cpa: 15 }),
  { fieldOrder: ["investment", "resultCount", "cpa"], derivedField: "investment", derivedValue: null },
);

console.log(`\n${passed} verificações passaram.`);
