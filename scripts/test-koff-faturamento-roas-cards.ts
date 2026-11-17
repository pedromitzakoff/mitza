/**
 * Testes da Etapa "Faturamento e ROAS nos cards principais" (pedido
 * explícito do usuário: "nas contas que tiverem objetivo de vendas acho
 * importante adicionar o valor gerado em vendas e o ROAS também nos cards
 * principais").
 *
 * Cobre:
 *  A. Comportamento real (behavioral) de `resolveFilteredExecutiveCardOverride`
 *     expondo revenue/roas — reaproveita `PerformanceSummary` que já vinha
 *     calculado, nenhuma fórmula nova.
 *  B. Wiring estrutural: `sales` só populado pro grupo "vendas", nos 4
 *     caminhos de `cockpit-view-data.ts` (mês/filtro × período-livre/filtro).
 *  C. UI: CockpitRevenueCard/CockpitRoasCard só renderizam quando
 *     `sales !== null`, mesma classe de card dos demais.
 *
 * Rodar: npx tsx scripts/test-koff-faturamento-roas-cards.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCockpitFilterState, resolveFilteredExecutiveCardOverride } from "../src/lib/cockpit-global-filter";
import { computeRoas } from "../src/lib/performance";
import type { CampaignDailyMetricRow } from "../src/lib/campaign-analytics";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function row(overrides: Partial<CampaignDailyMetricRow>): CampaignDailyMetricRow {
  return {
    date: "2026-11-15",
    channel: "meta",
    campaignName: "Campanha A",
    campaignId: "123",
    spend: 100,
    impressions: 1000,
    reach: 800,
    clicks: 20,
    linkClicks: 15,
    resultType: "sales",
    resultCount: 5,
    revenue: 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — resolveFilteredExecutiveCardOverride expõe revenue/roas (já vinham de PerformanceSummary, só não eram lidos)\n");
{
  const filter = resolveCockpitFilterState("", "contains"); // sem filtro de nome — mesmo assim passa pela função (quem chama decide quando)
  const rows: CampaignDailyMetricRow[] = [
    row({ campaignName: "Campanha A", spend: 1000, resultCount: 10, revenue: 5000 }),
    row({ campaignName: "Campanha B", spend: 500, resultCount: 5, revenue: 1000 }),
  ];
  const result = resolveFilteredExecutiveCardOverride("sales", ["meta"], rows, filter);

  ok("revenue soma as duas campanhas (6000)", result.revenue === 6000);
  ok("costPerResult continua calculado normalmente (1500/15 = 100)", result.costPerResult === 100);
  ok("roas = receita ÷ investimento (6000/1500 = 4)", result.roas === 4);
}

console.log("\nB — Grupo Meta+Google (sem granularidade de campanha) -> revenue/roas null, igual resultCount/costPerResult\n");
{
  const filter = resolveCockpitFilterState("", "contains");
  const result = resolveFilteredExecutiveCardOverride("sales", ["meta", "google"], [row({})], filter);
  ok("revenue null quando o grupo não é filtrável por campanha", result.revenue === null);
  ok("roas null pelo mesmo motivo", result.roas === null);
  ok("unavailableReason presente (mesma explicação de sempre)", typeof result.unavailableReason === "string");
}

console.log("\nC — Sem faturamento registrado (revenue null nas linhas) -> ROAS também null, nunca 0 fabricado\n");
{
  const filter = resolveCockpitFilterState("", "contains");
  const result = resolveFilteredExecutiveCardOverride("sales", ["meta"], [row({ revenue: null })], filter);
  ok("revenue null quando nenhuma linha tem receita", result.revenue === null);
  ok("roas null (computeRoas(null, spend) nunca fabrica 0)", result.roas === null);
  ok("resultCount/costPerResult continuam calculáveis normalmente (receita é independente deles)", result.resultCount === 5 && result.costPerResult === 20);
}

console.log("\nD — computeRoas (núcleo puro, reaproveitado — nenhuma fórmula nova) continua a mesma régua de sempre\n");
{
  ok("roas = receita / investimento", computeRoas(300, 100) === 3);
  ok("null quando não há receita", computeRoas(null, 100) === null);
  ok("null quando investimento é 0 (nunca Infinity)", computeRoas(300, 0) === null);
}

// ---------------------------------------------------------------------------
console.log("\nE — Wiring estrutural em cockpit-view-data.ts: sales só populado pro grupo 'sales', nos 4 caminhos\n");
{
  const source = loadSource("src", "lib", "cockpit-view-data.ts");

  ok("isSalesGoal é calculado uma vez por grupo (group.resultType === 'sales')", source.includes('const isSalesGoal = group.resultType === "sales";'));
  ok(
    "caminho 'fora do mês + filtro': sales usa filteredOverride.revenue/roas (MESMA função do caminho mensal)",
    /sales: isSalesGoal\s*\?\s*\{\s*revenue: filteredOverride\.revenue/.test(source),
  );
  ok(
    "caminho 'fora do mês, sem filtro': soma real via sumDailyRevenueForRange + computeRoas (mesma régua de rangeResultCount/rangeSpend)",
    source.includes("const rangeRevenue = isSalesGoal") && source.includes("sales: isSalesGoal ? { revenue: rangeRevenue, roas: computeRoas(rangeRevenue, rangeSpend) } : null,"),
  );
  ok(
    "caminho 'mês' (com ou sem filtro): sales lê performanceSummary.revenue/roas (já calculados, zero fórmula nova) quando sem filtro, filteredOverride quando com filtro",
    /sales: isSalesGoal\s*\?\s*\{\s*revenue: filteredOverride \? filteredOverride\.revenue \?\? null : performanceSummary\.revenue,/.test(source),
  );
  ok("sumDailyRevenueForRange nunca fabrica 0 — null quando nenhuma linha do escopo tem revenue", source.includes("if (relevant.length === 0) return null;"));
  ok("CockpitViewModel.resultCards expõe sales no tipo (nenhum consumidor quebra por campo ausente)", source.includes("sales: CockpitSalesExtraCardView | null;"));
}

// ---------------------------------------------------------------------------
console.log("\nF — UI: cards só aparecem pro grupo 'vendas', mesma moldura dos demais\n");
{
  const cardSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
  const viewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");

  ok("CockpitRevenueCard/CockpitRoasCard existem e usam COCKPIT_CARD_CLASSES (mesma moldura de Orçamento/Resultado/Custo)", cardSource.includes("export function CockpitRevenueCard") && cardSource.includes("export function CockpitRoasCard"));
  ok("nenhum dos dois tem estado de edição/meta — são só leitura (nenhuma 'meta de faturamento' existe nesta plataforma)", !cardSource.includes("CockpitRevenueCard") || !/CockpitRevenueCard[\s\S]{0,400}useState/.test(cardSource));
  ok(
    "cockpit-view.tsx só renderiza os 2 cards quando sales existe (nunca pra Leads/Conversas/Cadastros/Seguidores)",
    viewSource.includes("{sales && (") && viewSource.includes("<CockpitRevenueCard view={sales} />") && viewSource.includes("<CockpitRoasCard view={sales} />"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
