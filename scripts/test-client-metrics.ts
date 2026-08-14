/**
 * Testes de `computeMonthProjectionForRange` (lib/client-metrics.ts) —
 * cobre a unificação com `resolveDaysElapsedInRange` (lib/monthly-budget.ts):
 * antes, "dias decorridos no período" tinha duas implementações
 * independentes (esta, em milissegundos; `computeMonthlyExpectedPct`, por
 * índice em `listDatesInclusive`) que precisavam continuar dando o mesmo
 * resultado por coincidência. Agora as duas passam pela mesma função — este
 * script fixa o comportamento observável (mês passado/futuro/em andamento,
 * bordas em firstDay/lastDay) pra qualquer refatoração futura continuar
 * dando os mesmos números.
 *
 * Rodar: npx tsx scripts/test-client-metrics.ts
 */
import assert from "node:assert/strict";
import { computeMonthProjectionForRange } from "../src/lib/client-metrics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const AGOSTO_2026 = { firstDay: "2026-08-01", lastDay: "2026-08-31" }; // 31 dias

console.log("computeMonthProjectionForRange\n");

// Meio do mês: dia 11 de 31, R$3.100 gasto até agora -> ritmo R$100/dia * 31 = R$3.100.
{
  const projection = computeMonthProjectionForRange(10000, 1100, AGOSTO_2026, new Date("2026-08-11T00:00:00Z"));
  check("dia 11/31, R$1.100 até agora -> projeta R$3.100 (R$100/dia × 31 dias)", Math.round(projection.projectedSpend * 100) / 100, 3100);
}

// Período ainda não começou (futuro) -> 0 dias decorridos, projeção 0 (nunca dividir por zero).
{
  const setembro = { firstDay: "2026-09-01", lastDay: "2026-09-30" };
  const projection = computeMonthProjectionForRange(10000, 0, setembro, new Date("2026-08-11T00:00:00Z"));
  check("período futuro (setembro, hoje agosto) -> 0 dias decorridos, projeção 0 (nunca NaN/Infinity)", projection.projectedSpend, 0);
}

// Período já encerrado (passado) -> dias decorridos = todo o período, projeção = realizado final.
{
  const julho = { firstDay: "2026-07-01", lastDay: "2026-07-31" };
  const projection = computeMonthProjectionForRange(10000, 9500, julho, new Date("2026-08-11T00:00:00Z"));
  check("período encerrado (julho, hoje agosto) -> projeção = realizado final (R$9.500, não extrapolado)", projection.projectedSpend, 9500);
}

// Borda: hoje é exatamente o primeiro dia do período -> 1 dia decorrido (hoje sempre conta).
{
  const projection = computeMonthProjectionForRange(3100, 100, AGOSTO_2026, new Date("2026-08-01T00:00:00Z"));
  check("hoje é o primeiro dia do período -> 1 dia decorrido (hoje sempre conta), projeta R$3.100", Math.round(projection.projectedSpend * 100) / 100, 3100);
}

// Borda: hoje é exatamente o último dia do período -> todos os 31 dias decorridos.
{
  const projection = computeMonthProjectionForRange(3100, 3100, AGOSTO_2026, new Date("2026-08-31T00:00:00Z"));
  check("hoje é o último dia do período -> 31 dias decorridos, projeção = realizado (R$3.100)", Math.round(projection.projectedSpend * 100) / 100, 3100);
}

// Sem planejado -> projectedPct null (nunca dividir por zero orçamento).
{
  const projection = computeMonthProjectionForRange(0, 1000, AGOSTO_2026, new Date("2026-08-11T00:00:00Z"));
  check("sem planejado (monthPlanned=0) -> projectedPct null, nunca 0 fabricado", projection.projectedPct, null);
}

console.log(`\n${passed} verificações passaram.`);
