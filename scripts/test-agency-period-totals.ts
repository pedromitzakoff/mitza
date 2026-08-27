/**
 * Testes puros de `computeAgencyPeriodTotals` (`lib/agency-metrics.ts`) —
 * Etapa "Revisão da Visão Geral": totais REALIZADOS da agência num período
 * arbitrário (usado só por "Evolução no período"), sobre dado bruto
 * multi-cliente em vez de cards completos. Mesmo princípio de sempre:
 * investimento = soma direta de spend do escopo; leads/vendas = soma do
 * resultado dos clientes cujo objetivo PRINCIPAL é aquele, custo por
 * resultado = investimento SÓ desses clientes ÷ resultado somado.
 *
 * Rodar: npx tsx scripts/test-agency-period-totals.ts
 */
import assert from "node:assert/strict";
import { computeAgencyPeriodTotals } from "../src/lib/agency-metrics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("\nA — Investimento é a soma de TODOS os clientes do escopo de investimento, mesmo sem dado de performance\n");
{
  const result = computeAgencyPeriodTotals({
    investmentClientIds: new Set(["c1", "c2", "c3"]),
    resultsClientIds: new Set(["c1", "c2", "c3"]),
    spendByClientId: new Map([
      ["c1", 1000],
      ["c2", 500],
      ["c3", 200],
    ]),
    performanceRows: [],
    primaryGoalByClientId: new Map([
      ["c1", "leads"],
      ["c2", "sales"],
      ["c3", null],
    ]),
  });
  check("investimento = soma de c1+c2+c3, mesmo sem nenhum resultado", result.investment, 1700);
  check("leadsCount = 0 sem registros", result.leadsCount, 0);
  check("leadsCostPerResult = null sem resultado", result.leadsCostPerResult, null);
}

console.log("\nB — leads/vendas somam só os clientes com esse objetivo PRINCIPAL\n");
{
  const result = computeAgencyPeriodTotals({
    investmentClientIds: new Set(["c1", "c2"]),
    resultsClientIds: new Set(["c1", "c2"]),
    spendByClientId: new Map([
      ["c1", 1000],
      ["c2", 800],
    ]),
    performanceRows: [
      { client_id: "c1", result_count: 50 },
      { client_id: "c2", result_count: 20 },
    ],
    primaryGoalByClientId: new Map([
      ["c1", "leads"],
      ["c2", "sales"],
    ]),
  });
  check("leadsCount = só o resultado de c1 (objetivo leads)", result.leadsCount, 50);
  check("leadsCostPerResult = spend de c1 (1000) / 50", result.leadsCostPerResult, 20);
  check("salesCount = só o resultado de c2 (objetivo sales)", result.salesCount, 20);
  check("salesCostPerResult = spend de c2 (800) / 20", result.salesCostPerResult, 40);
}

console.log("\nC — cliente sem NENHUM registro de performance não entra em 'clientsWithData' (custo não dilui com spend de quem não converteu)\n");
{
  const result = computeAgencyPeriodTotals({
    investmentClientIds: new Set(["c1", "c2"]),
    resultsClientIds: new Set(["c1", "c2"]),
    spendByClientId: new Map([
      ["c1", 1000],
      ["c2", 500],
    ]),
    performanceRows: [{ client_id: "c1", result_count: 25 }],
    primaryGoalByClientId: new Map([
      ["c1", "leads"],
      ["c2", "leads"],
    ]),
  });
  check("leadsCount = só o resultado de c1 (c2 não tem registro no período)", result.leadsCount, 25);
  check(
    "leadsCostPerResult = spend só de c1 (1000) / 25 — NUNCA soma o spend de c2, que não converteu",
    result.leadsCostPerResult,
    40,
  );
}

console.log("\nD — resultsClientIds restringe o escopo (cliente fora do recorte de carteira/cliente não entra)\n");
{
  const result = computeAgencyPeriodTotals({
    investmentClientIds: new Set(["c1"]),
    resultsClientIds: new Set(["c1"]),
    spendByClientId: new Map([
      ["c1", 1000],
      ["c2", 9999],
    ]),
    performanceRows: [
      { client_id: "c1", result_count: 10 },
      { client_id: "c2", result_count: 500 },
    ],
    primaryGoalByClientId: new Map([
      ["c1", "leads"],
      ["c2", "leads"],
    ]),
  });
  check("investimento ignora c2 (fora de investmentClientIds)", result.investment, 1000);
  check("leadsCount ignora c2 (fora de resultsClientIds), mesmo com objetivo leads e dado real", result.leadsCount, 10);
}

console.log("\nE — escopos vazios nunca lançam erro, só devolvem zero/null\n");
{
  const result = computeAgencyPeriodTotals({
    investmentClientIds: new Set(),
    resultsClientIds: new Set(),
    spendByClientId: new Map(),
    performanceRows: [],
    primaryGoalByClientId: new Map(),
  });
  check("investimento = 0", result.investment, 0);
  check("leadsCount = 0, leadsCostPerResult = null", [result.leadsCount, result.leadsCostPerResult], [0, null]);
  check("salesCount = 0, salesCostPerResult = null", [result.salesCount, result.salesCostPerResult], [0, null]);
}

console.log(`\n${passed} verificações passaram.`);
