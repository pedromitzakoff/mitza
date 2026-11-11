/**
 * Testes da grade de cards de "Anúncios" (pedido do usuário: "deixar mais
 * bonito... ordenar por maior conversão... visualizar de formas
 * diferentes"). Núcleo puro de ordenação (`sortValue`/`sortAdRows`,
 * `ad-card-grid.tsx`) — usa `row.resultType` (o objetivo PRÓPRIO de cada
 * linha) em vez de uma coluna fixa, pra funcionar numa conta com Leads e
 * Vendas misturados, exatamente o cenário que motivou a extensão de
 * colunas por objetivo.
 *
 * Rodar: npx tsx scripts/test-koff-ad-card-grid.ts
 */
import assert from "node:assert/strict";
import { sortValue, sortAdRows } from "../src/app/clients/ad-card-grid";
import type { ExplorationRow } from "../src/lib/meta-ads-dashboard/exploration-data";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function row(partial: Partial<ExplorationRow> & { id: string; name: string }): ExplorationRow {
  return {
    spend: 0,
    impressions: null,
    clicks: null,
    linkClicks: null,
    revenue: null,
    cpc: null,
    linkCpc: null,
    ctr: null,
    linkCtr: null,
    cpm: null,
    roas: null,
    resultType: null,
    resultByGoal: {},
    ...partial,
  };
}

console.log("\nA — sortValue: lê o objetivo PRÓPRIO de cada linha\n");
{
  const leadsRow = row({ id: "1", name: "Anúncio Leads", spend: 100, resultType: "leads", resultByGoal: { leads: { count: 20, cost: 5 } } });
  const salesRow = row({ id: "2", name: "Anúncio Vendas", spend: 200, resultType: "sales", resultByGoal: { sales: { count: 4, cost: 50 } } });
  const noGoalRow = row({ id: "3", name: "Anúncio Engajamento", spend: 50 });

  ok("Investimento lê row.spend direto", sortValue("spend", leadsRow) === 100 && sortValue("spend", salesRow) === 200);
  ok(
    "Resultado lê o objetivo PRÓPRIO da linha (20 pra leads, 4 pra vendas) — nunca uma coluna fixa",
    sortValue("result", leadsRow) === 20 && sortValue("result", salesRow) === 4,
  );
  ok("Custo lê o custo do objetivo próprio", sortValue("cost", leadsRow) === 5 && sortValue("cost", salesRow) === 50);
  ok("linha sem objetivo nenhum -> Resultado vira -1 (nunca 0 fabricado)", sortValue("result", noGoalRow) === -1);
  ok("linha sem objetivo nenhum -> Custo vira +Infinity (vai pro final, nunca o mais barato)", sortValue("cost", noGoalRow) === Number.POSITIVE_INFINITY);
}

console.log("\nB — sortAdRows: ordens corretas, inclusive custo (menor primeiro)\n");
{
  const rows = [
    row({ id: "1", name: "Zebra", spend: 100, resultType: "leads", resultByGoal: { leads: { count: 20, cost: 10 } } }),
    row({ id: "2", name: "Abacate", spend: 300, resultType: "sales", resultByGoal: { sales: { count: 4, cost: 2 } } }),
    row({ id: "3", name: "Mango", spend: 50, resultType: "leads", resultByGoal: { leads: { count: 90, cost: 20 } } }),
  ];

  ok(
    "Investimento: maior primeiro",
    sortAdRows(rows, "spend")
      .map((r) => r.id)
      .join(",") === "2,1,3",
  );
  ok(
    "Resultado: maior primeiro, mesmo misturando objetivos diferentes",
    sortAdRows(rows, "result")
      .map((r) => r.id)
      .join(",") === "3,1,2",
  );
  ok(
    "Custo: MENOR primeiro (mais eficiente primeiro) — única ordem invertida",
    sortAdRows(rows, "cost")
      .map((r) => r.id)
      .join(",") === "2,1,3",
  );
  ok(
    "Nome: alfabético, nunca por número nenhum",
    sortAdRows(rows, "name")
      .map((r) => r.id)
      .join(",") === "2,3,1",
  );
  ok("sortAdRows nunca modifica o array original (sempre uma cópia)", rows.map((r) => r.id).join(",") === "1,2,3");
}

console.log(`\n${passed} verificações OK.\n`);
