/**
 * Teste de equivalência do congelamento de sprint (Etapa "Migração
 * Multicanal dos Consumidores") — `computeSprintClosedSnapshot`
 * (lib/sprint-recommendation.ts) passou a resolver o orçamento vigente NO
 * MOMENTO do fechamento (`budgetChangesAsOfEnd`) como a soma dos canais com
 * plano, nunca só Meta. Achado durante a auditoria final: este era o único
 * consumidor que ainda filtrava `channel === "meta"` fora de uma query SQL
 * (era um `.filter()` em `[id]/page.tsx`, alimentando
 * `ensureClosedSprintSnapshots`).
 *
 * Rodar: npx tsx scripts/test-sprint-closed-snapshot-multichannel.ts
 */
import assert from "node:assert/strict";
import { computeSprintClosedSnapshot } from "../src/lib/sprint-recommendation";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// Partição em centavos (`distributeCentsEqually`) pode reintroduzir um
// resíduo de ponto flutuante ínfimo ao somar de volta (ex.: 15000.00000000001)
// — mesmo comportamento de qualquer soma de centavos/100 já existente na
// plataforma, nunca um erro de valor real. Arredonda pra centavos antes de
// comparar, só nestes testes de soma.
function checkCurrency(name: string, actual: number | null, expectedValue: number) {
  check(name, actual === null ? null : Math.round(actual * 100) / 100, expectedValue);
}

const monthRange = { firstDay: "2026-08-01", lastDay: "2026-08-31" };
// Um único sprint cobrindo o mês inteiro — simplifica a conta: o
// planejamento original/recomendação final desta sprint é sempre o
// orçamento consolidado inteiro (nenhuma partição entre sprints a mais).
const sprint = { sprintId: "s1", startDate: "2026-08-01", endDate: "2026-08-31", actualSpend: 0 };
const allSprintsOfMonth = [{ sprintId: "s1", startDate: "2026-08-01", endDate: "2026-08-31" }];

console.log("computeSprintClosedSnapshot — orçamento consolidado no momento do fechamento\n");

{
  const snapshot = computeSprintClosedSnapshot({
    sprint,
    monthRange,
    allSprintsOfMonth,
    budgetChanges: [{ channel: "meta", newAmount: 10000, changedAt: "2026-08-01T10:00:00Z" }],
    fallbackPlannedSumThroughSprintEnd: 0,
    currentMonthlyBudget: 10000,
    monthActualThroughSprintStart: 0,
  });
  checkCurrency("Meta-only (retrocompatibilidade): planejamento original = 10.000", snapshot.originalPlannedAmount, 10000);
  checkCurrency("Meta-only: recomendação final = 10.000", snapshot.finalRecommendedAmount, 10000);
}

{
  const snapshot = computeSprintClosedSnapshot({
    sprint,
    monthRange,
    allSprintsOfMonth,
    budgetChanges: [
      { channel: "meta", newAmount: 10000, changedAt: "2026-08-01T10:00:00Z" },
      { channel: "google", newAmount: 5000, changedAt: "2026-08-01T10:00:00Z" },
    ],
    fallbackPlannedSumThroughSprintEnd: 0,
    currentMonthlyBudget: 15000,
    monthActualThroughSprintStart: 0,
  });
  checkCurrency("Meta (10.000) + Google (5.000): planejamento original congelado = 15.000, nunca só o Meta (10.000)", snapshot.originalPlannedAmount, 15000);
  checkCurrency("Meta + Google: recomendação final congelada = 15.000", snapshot.finalRecommendedAmount, 15000);
}

{
  // Alteração de Google DEPOIS do fechamento desta sprint (mês em
  // andamento) nunca deve entrar no congelamento — só o que existia até
  // `sprint.endDate`.
  const snapshot = computeSprintClosedSnapshot({
    sprint,
    monthRange,
    allSprintsOfMonth,
    budgetChanges: [
      { channel: "meta", newAmount: 10000, changedAt: "2026-08-01T10:00:00Z" },
      { channel: "google", newAmount: 5000, changedAt: "2026-08-01T10:00:00Z" },
      { channel: "google", newAmount: 9000, changedAt: "2026-09-15T10:00:00Z" },
    ],
    fallbackPlannedSumThroughSprintEnd: 0,
    currentMonthlyBudget: 19000,
    monthActualThroughSprintStart: 0,
  });
  checkCurrency(
    "alteração de Google depois do fim do mês nunca entra no congelamento -> continua 15.000, não 19.000",
    snapshot.originalPlannedAmount,
    15000,
  );
}

console.log(`\n${passed} verificações passaram.`);
