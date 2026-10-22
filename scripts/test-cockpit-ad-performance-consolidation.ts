/**
 * Testes da consolidação do Dashboard Meta Ads dentro do Cockpit Único do
 * Cliente (pedido explícito do usuário: "só quero essa página no sistema
 * para cada cliente" — a antiga rota separada `/clients/[id]/meta-ads`,
 * Etapas 2.1-2.4.1, foi removida e todo o conteúdo passou a viver em
 * `app/clients/[id]/page.tsx`). Cobre o novo núcleo puro
 * `buildCockpitAdPerformanceData` (`lib/meta-ads-dashboard/dashboard-data.ts`),
 * que substitui o antigo `buildMetaAdsDashboardData` (removido):
 *  - monta o mesmo formato `MetaAdsDashboardData` a partir de dados JÁ
 *    buscados por quem chama (nenhuma consulta própria) — reaproveitável
 *    pelos MESMOS núcleos puros de sempre (`buildMetricCardViewModels`/
 *    `buildEvolutionSeries`/`exploration-data.ts`, nenhum deles alterado);
 *  - o Cockpit nunca compara com o período anterior (mesma convenção do
 *    resto da tela) — `comparison.previous` e `reachComparison.previous`
 *    são sempre vazios/indisponíveis, mesmo quando o alcance ATUAL é "ok";
 *  - exploração (campanhas/conjuntos/anúncios) passa direto, sem
 *    reagregação.
 *
 * Rodar: npx tsx scripts/test-cockpit-ad-performance-consolidation.ts
 */
import assert from "node:assert/strict";
import { buildCockpitAdPerformanceData, type MetaAdsReachSnapshot } from "../src/lib/meta-ads-dashboard/dashboard-data";
import { buildMetricCardViewModels } from "../src/lib/meta-ads-dashboard/metric-cards";
import type { CampaignDailyMetricRow, CampaignSummary } from "../src/lib/campaign-analytics";
import type { AdSetDailyMetricRow } from "../src/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "../src/lib/creative-analytics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function campaignRow(partial: Partial<CampaignDailyMetricRow> & { date: string }): CampaignDailyMetricRow {
  return {
    channel: "meta",
    campaignName: "Campanha A",
    campaignId: "c1",
    spend: 0,
    impressions: null,
    reach: null,
    clicks: null,
    linkClicks: null,
    resultType: null,
    resultCount: null,
    revenue: null,
    ...partial,
  };
}

const rows: CampaignDailyMetricRow[] = [
  campaignRow({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 200, linkClicks: 80, resultType: "leads", resultCount: 10 }),
  campaignRow({ date: "2026-10-02", spend: 150, impressions: 15000, clicks: 300, linkClicks: 120, resultType: "leads", resultCount: 15 }),
];

const explorationCampaigns: CampaignSummary[] = [];
const explorationAdSetRows: AdSetDailyMetricRow[] = [];
const explorationCreativeRows: AdCreativeDailyMetricRow[] = [];

const reachOk: MetaAdsReachSnapshot = { status: "ok", impressions: 25000, reach: 12000, frequency: 25000 / 12000 };

console.log("1 — buildCockpitAdPerformanceData: totais/derivados corretos, sem comparação de período\n");

const data = buildCockpitAdPerformanceData({
  client: { id: "cliente-1", name: "Cliente Teste" },
  metaAdAccountId: "act_123",
  period: { start: "2026-10-01", end: "2026-10-02" },
  campaignDailyRows: rows,
  explorationCampaigns,
  explorationAdSetRows,
  explorationCreativeRows,
  resultType: "leads",
  reach: reachOk,
  lastSyncAt: "2026-10-21T12:00:00Z",
});

check("investimento somado corretamente (100+150)", data.comparison.current.totals.spend, 250);
check("impressões somadas corretamente", data.comparison.current.totals.impressions, 25000);
check("cliques no link somados corretamente, distinto de cliques totais", data.comparison.current.totals.linkClicks, 200);
check("resultados somados corretamente", data.comparison.current.totals.resultCount, 25);
ok("comparison.previous SEMPRE null — Cockpit nunca compara com mês anterior nesta seção", data.comparison.previous === null);
check("spendChangePct null (sem período anterior pra comparar)", data.comparison.spendChangePct, null);

console.log("\n2 — reachComparison: alcance ATUAL mostrado, mas NUNCA comparado (previous sempre indisponível)\n");

check("reachComparison.current preserva o snapshot real recebido", data.reachComparison.current, reachOk);
check("reachComparison.previous é sempre 'unavailable/not_configured' — nunca um segundo fetch de alcance", data.reachComparison.previous, {
  status: "unavailable",
  reason: "not_configured",
});
check("reachChangePct null mesmo com alcance atual 'ok' (nunca comparado contra indisponível)", data.reachComparison.reachChangePct, null);
check("frequencyChangePct null pelo mesmo motivo", data.reachComparison.frequencyChangePct, null);

console.log("\n3 — evolução: série do período atual correta, sem período anterior fabricado\n");

const investmentSeries = data.evolution.find((s) => s.id === "investment")!;
check("série de investimento tem 2 pontos, valores corretos", investmentSeries.current.map((p) => p.value), [100, 150]);
ok("série 'previous' inteira é null (nenhum dado de mês anterior buscado nesta seção)", investmentSeries.previous.every((p) => p.value === null));

console.log("\n4 — cards de KPI: buildMetricCardViewModels funciona sem nenhuma mudança, sem variação fabricada\n");

const cards = buildMetricCardViewModels(data);
check("14 cards montados normalmente a partir do MetaAdsDashboardData do Cockpit", cards.length, 14);
const investmentCard = cards.find((c) => c.id === "investment")!;
ok("card de investimento não mostra comparação (sem período anterior, nunca uma seta fabricada)", investmentCard.comparison === null);
const linkClicksCard = cards.find((c) => c.id === "linkClicks")!;
ok("card de cliques no link mostra o valor real, distinto de cliques totais", linkClicksCard.value !== cards.find((c) => c.id === "clicks")!.value);

console.log("\n5 — exploração: campanhas/conjuntos/anúncios passam direto, sem reagregação\n");

check("explorationCampaigns é repassado sem alteração", data.explorationCampaigns, explorationCampaigns);
check("explorationAdSetRows é repassado sem alteração", data.explorationAdSetRows, explorationAdSetRows);
check("explorationCreativeRows é repassado sem alteração", data.explorationCreativeRows, explorationCreativeRows);
check("resultSource é sempre 'meta_attributed' — nunca confundido com resultado de negócio confirmado", data.resultSource, "meta_attributed");
check("lastSyncAt é repassado sem alteração", data.lastSyncAt, "2026-10-21T12:00:00Z");

console.log("\n6 — cliente sem conta Meta direta: reach indisponível tratado sem erro, cards mostram estado explícito\n");

const dataUnavailable = buildCockpitAdPerformanceData({
  client: { id: "cliente-2", name: "Cliente Sem Meta API" },
  metaAdAccountId: null,
  period: { start: "2026-10-01", end: "2026-10-31" },
  campaignDailyRows: [],
  explorationCampaigns: [],
  explorationAdSetRows: [],
  explorationCreativeRows: [],
  resultType: null,
  reach: { status: "unavailable", reason: "not_configured" },
  lastSyncAt: null,
});
const unavailableCards = buildMetricCardViewModels(dataUnavailable);
check("card de alcance mostra mensagem explicativa, nunca '0' fabricado", unavailableCards.find((c) => c.id === "reach")!.value, "Integração direta Meta não configurada");
check("sem nenhuma linha no período: 'Sem dados no período' pros Resultados (nunca 0)", unavailableCards.find((c) => c.id === "results")!.value, "Sem dados no período");

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
