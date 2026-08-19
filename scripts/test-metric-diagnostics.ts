/**
 * Testes puros do Motor de Diagnóstico Único (lib/metric-diagnostics.ts) —
 * Etapa "Auditoria do Motor Operacional", achado P0: `evaluateCpaDiagnostic`
 * passa a respeitar a mesma amostra mínima (`MIN_RELIABLE_RESULT_COUNT`,
 * lib/operation-health-thresholds.ts) que o Motor de Saúde (`evaluateCost`,
 * account-health-engine.ts) já usava — nenhum threshold novo, nenhum
 * segundo "3" mágico duplicado.
 *
 * Rodar: npx tsx scripts/test-metric-diagnostics.ts
 */
import assert from "node:assert/strict";
import { evaluateCpaDiagnostic } from "../src/lib/metric-diagnostics";
import { MIN_RELIABLE_RESULT_COUNT } from "../src/lib/operation-health-thresholds";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log(`MIN_RELIABLE_RESULT_COUNT = ${MIN_RELIABLE_RESULT_COUNT} (mesma constante do Motor de Saúde)\n`);

// CPA muito acima da meta (R$100 vs meta R$10 — 900% acima, seria "critical"
// se a amostra fosse suficiente) com amostra insuficiente, em cada contagem
// abaixo do piso: nunca deve produzir attention/critical.
console.log("Amostra insuficiente — nunca attention/critical, não importa o quão distorcido o CPA pareça\n");

check(
  "0 resultados + CPA muito acima -> tone normal, isOutOfRange false, deviationPct null",
  evaluateCpaDiagnostic(100, 10, 0),
  { value: 100, expected: 10, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
);

check(
  "1 resultado + CPA muito acima -> tone normal, isOutOfRange false",
  evaluateCpaDiagnostic(100, 10, 1),
  { value: 100, expected: 10, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
);

check(
  "2 resultados + CPA muito acima -> ainda abaixo do piso (3), tone normal",
  evaluateCpaDiagnostic(100, 10, 2),
  { value: 100, expected: 10, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
);

console.log("\nA partir de MIN_RELIABLE_RESULT_COUNT — thresholds 10%/20% de sempre, inalterados\n");

check(
  "3 resultados (exatamente o piso) + CPA muito acima -> agora avalia normalmente, critical",
  evaluateCpaDiagnostic(100, 10, MIN_RELIABLE_RESULT_COUNT),
  { value: 100, expected: 10, deviationPct: 9, direction: "up", tone: "critical", isOutOfRange: true },
);

check(
  "3 resultados + CPA dentro da meta (variação de 5%, abaixo do corte de 10%) -> normal",
  evaluateCpaDiagnostic(10.5, 10, MIN_RELIABLE_RESULT_COUNT),
  { value: 10.5, expected: 10, deviationPct: 0.05, direction: "up", tone: "normal", isOutOfRange: false },
);

check(
  "amostra suficiente + desvio de 15% (entre 10% e 20%) -> attention",
  evaluateCpaDiagnostic(11.5, 10, MIN_RELIABLE_RESULT_COUNT),
  { value: 11.5, expected: 10, deviationPct: 0.15, direction: "up", tone: "attention", isOutOfRange: true },
);

check(
  "amostra suficiente + desvio de 25% (acima de 20%) -> critical",
  evaluateCpaDiagnostic(12.5, 10, MIN_RELIABLE_RESULT_COUNT),
  { value: 12.5, expected: 10, deviationPct: 0.25, direction: "up", tone: "critical", isOutOfRange: true },
);

check(
  "amostra bem acima do piso (10 resultados) + desvio crítico -> continua avaliando normalmente",
  evaluateCpaDiagnostic(20, 10, 10),
  { value: 20, expected: 10, deviationPct: 1, direction: "up", tone: "critical", isOutOfRange: true },
);

console.log("\nCasos de borda já existentes, preservados\n");

check(
  "custo por resultado null -> null, independente da amostra (nada pra avaliar)",
  evaluateCpaDiagnostic(null, 10, 10),
  null,
);

check(
  "sem meta configurada (targetCostPerResult null) + amostra suficiente -> normal, sem base de comparação",
  evaluateCpaDiagnostic(100, null, 10),
  { value: 100, expected: null, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
);

check(
  "custo ABAIXO da meta (melhora) + amostra suficiente -> normal, mesmo sendo um desvio grande",
  evaluateCpaDiagnostic(2, 10, 10),
  { value: 2, expected: 10, deviationPct: -0.8, direction: "down", tone: "normal", isOutOfRange: false },
);

console.log(`\n${passed} verificações passaram.`);
