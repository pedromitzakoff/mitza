/**
 * Testes puros da Etapa 2.4 (KOFF Analytics Fase 2 — Dashboard completo de
 * performance). Cobre:
 *  - Ingestão de `inline_link_clicks` ponta a ponta: mapeamento da Graph
 *    API (`meta-api-fetch.ts`) e agregação (`import-sources.ts`, as 3
 *    granularidades — campanha/conjunto/criativo).
 *  - Métricas derivadas novas (CPM/CTR do link/CPC do link) nos 3
 *    `Summary` (`campaign-analytics.ts`/`ad-set-analytics.ts`/
 *    `creative-analytics.ts`), sempre distintas das métricas "gerais".
 *  - `lib/meta-ads-dashboard/exploration-data.ts`: conversão
 *    Summary→ExplorationRow, formatação por unidade, ordenação segura, e a
 *    regra crítica do usuário ("não somar alcance") — nenhuma coluna de
 *    alcance existe nesta tabela.
 *  - Cards de KPI e métricas do gráfico de evolução passam a incluir
 *    cliques no link/CTR do link/CPC do link, sempre distintos dos
 *    "gerais".
 *
 * Rodar: npx tsx scripts/test-meta-ads-link-clicks-and-exploration.ts
 */
import assert from "node:assert/strict";
import { mapMetaInsightsRowToIngestRow } from "../src/lib/meta-api-fetch";
import {
  aggregateCampaignDailyRows,
  aggregateAdSetDailyRows,
  aggregateAdCreativeDailyRows,
  type RawSourceRow,
} from "../src/lib/import-sources";
import { buildCampaignSummaries, type CampaignDailyMetricRow } from "../src/lib/campaign-analytics";
import { buildAdSetSummaries, type AdSetDailyMetricRow } from "../src/lib/ad-set-analytics";
import { buildCreativeSummaries, type AdCreativeDailyMetricRow } from "../src/lib/creative-analytics";
import {
  campaignSummaryToRow,
  adSetSummaryToRow,
  creativeSummaryToRow,
  buildExplorationColumns,
  explorationSortValue,
  formatExplorationCell,
} from "../src/lib/meta-ads-dashboard/exploration-data";
import { buildMetricCardViewModels } from "../src/lib/meta-ads-dashboard/metric-cards";
import { buildEvolutionSeries } from "../src/lib/meta-ads-dashboard/evolution-data";
import { buildReachComparison, type MetaAdsDashboardData } from "../src/lib/meta-ads-dashboard/dashboard-data";
import { formatCurrency } from "../src/lib/format";

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

// ---------------------------------------------------------------------------
console.log("1 — inline_link_clicks: mapeamento da Graph API (meta-api-fetch.ts)\n");

const mapped = mapMetaInsightsRowToIngestRow({
  date_start: "2026-10-01",
  campaign_id: "c1",
  campaign_name: "Campanha",
  spend: "100",
  clicks: "50",
  inline_link_clicks: "30",
});
check("inline_link_clicks vira linkClicks, DISTINTO de clicks (total)", { clicks: mapped?.clicks, linkClicks: mapped?.linkClicks }, { clicks: 50, linkClicks: 30 });

const mappedWithout = mapMetaInsightsRowToIngestRow({ date_start: "2026-10-01", campaign_id: "c1", campaign_name: "Campanha", spend: "100" });
check("sem inline_link_clicks na resposta: linkClicks undefined (nunca 0 fabricado)", mappedWithout?.linkClicks, undefined);

// ---------------------------------------------------------------------------
console.log("\n2 — Agregação (import-sources.ts): link_clicks somado nas 3 granularidades\n");

const COLUMNS_BASE = {
  dateColumn: "date",
  campaignNameColumn: "campaign_name",
  spendColumn: "spend",
  clicksColumn: "clicks",
  linkClicksColumn: "link_clicks",
};

const rawRows: RawSourceRow[] = [
  { date: "2026-10-01", campaign_name: "C1", ad_set_name: "AS1", creative_name: "Ad1", spend: "100", clicks: "50", link_clicks: "20" },
  { date: "2026-10-01", campaign_name: "C1", ad_set_name: "AS1", creative_name: "Ad1", spend: "50", clicks: "10", link_clicks: "5" },
];

const campaignAgg = aggregateCampaignDailyRows(rawRows, COLUMNS_BASE);
check("campanha: link_clicks somado (20+5=25), distinto de clicks (50+10=60)", { clicks: campaignAgg[0].clicks, linkClicks: campaignAgg[0].linkClicks }, { clicks: 60, linkClicks: 25 });

const adSetAgg = aggregateAdSetDailyRows(rawRows, { ...COLUMNS_BASE, adSetNameColumn: "ad_set_name" });
check("conjunto: mesma soma de link_clicks", adSetAgg[0].linkClicks, 25);

const creativeAgg = aggregateAdCreativeDailyRows(rawRows, { ...COLUMNS_BASE, creativeNameColumn: "creative_name" });
check("criativo: mesma soma de link_clicks", creativeAgg[0].linkClicks, 25);

const rowsWithoutLinkColumn: RawSourceRow[] = [{ date: "2026-10-01", campaign_name: "C1", spend: "100", clicks: "50" }];
const noLinkAgg = aggregateCampaignDailyRows(rowsWithoutLinkColumn, { dateColumn: "date", campaignNameColumn: "campaign_name", spendColumn: "spend", clicksColumn: "clicks", linkClicksColumn: "link_clicks" });
check("fonte sem a coluna configurada/presente: linkClicks null (nunca 0 fabricado)", noLinkAgg[0].linkClicks, null);

// ---------------------------------------------------------------------------
console.log("\n3 — Summaries: CPM/CTR do link/CPC do link, sempre distintos das métricas gerais\n");

function campaignRow(partial: Partial<CampaignDailyMetricRow> & { date: string }): CampaignDailyMetricRow {
  return {
    channel: "meta",
    campaignName: "Campanha",
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

const campaignSummaries = buildCampaignSummaries([
  campaignRow({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 200, linkClicks: 80 }),
]);
const campaignSummary = campaignSummaries[0];
check("CPM (100 / 10000 * 1000)", campaignSummary.cpm, 10);
check("CTR geral (200/10000) DISTINTO de CTR do link (80/10000)", { ctr: campaignSummary.ctr, linkCtr: campaignSummary.linkCtr }, { ctr: 200 / 10000, linkCtr: 80 / 10000 });
check("CPC geral (100/200) DISTINTO de CPC do link (100/80)", { cpc: campaignSummary.cpc, linkCpc: campaignSummary.linkCpc }, { cpc: 100 / 200, linkCpc: 100 / 80 });

function adSetRow(partial: Partial<AdSetDailyMetricRow> & { date: string }): AdSetDailyMetricRow {
  return {
    channel: "meta",
    campaignName: "Campanha",
    campaignId: "c1",
    adSetName: "Conjunto",
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
const adSetSummary = buildAdSetSummaries([adSetRow({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 200, linkClicks: 80 })])[0];
check("AdSetSummary: mesma distinção geral vs. link", { ctr: adSetSummary.ctr, linkCtr: adSetSummary.linkCtr, cpc: adSetSummary.cpc, linkCpc: adSetSummary.linkCpc }, { ctr: 0.02, linkCtr: 0.008, cpc: 0.5, linkCpc: 1.25 });

function creativeRow(partial: Partial<AdCreativeDailyMetricRow> & { date: string }): AdCreativeDailyMetricRow {
  return {
    campaignName: "Campanha",
    campaignId: "c1",
    creativeName: "Anúncio",
    creativePermalinkUrl: null,
    previewImageUrl: null,
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
const creativeSummary = buildCreativeSummaries([creativeRow({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 200, linkClicks: 80 })])[0];
check("CreativeSummary: mesma distinção geral vs. link", { ctr: creativeSummary.ctr, linkCtr: creativeSummary.linkCtr }, { ctr: 0.02, linkCtr: 0.008 });

// ---------------------------------------------------------------------------
console.log("\n4 — exploration-data.ts: conversão, colunas, formatação, ordenação\n");

const explorationRow = campaignSummaryToRow(campaignSummary);
check("campaignSummaryToRow: id/name = campaignName, link metrics preservadas", { id: explorationRow.id, name: explorationRow.name, linkClicks: explorationRow.linkClicks }, { id: "Campanha", name: "Campanha", linkClicks: 80 });

const adSetExplorationRow = adSetSummaryToRow(adSetSummary);
check("adSetSummaryToRow: id/name = adSetName", adSetExplorationRow.id, "Conjunto");

const creativeExplorationRow = creativeSummaryToRow(creativeSummary);
check("creativeSummaryToRow: preserva previewImageUrl", creativeExplorationRow.previewImageUrl, null);

const columns = buildExplorationColumns("leads");
ok("NUNCA existe coluna de alcance (pedido do usuário: nunca somar alcance entre dias)", !columns.some((c) => (c.id as string) === "reach"));
ok("coluna 'Nome' é sempre a primeira e nunca removível (sem flag de 'opcional')", columns[0].id === "name");
check("rótulo dinâmico do objetivo (leads)", columns.find((c) => c.id === "resultCount")?.label, "Leads");

check("formatExplorationCell: moeda", formatExplorationCell("spend", explorationRow), formatCurrency(100));
check("formatExplorationCell: '—' pra métrica indisponível", formatExplorationCell("revenue", explorationRow), "—");
ok("formatExplorationCell: percentual tem símbolo %", formatExplorationCell("ctr", explorationRow).includes("%"));

check("explorationSortValue: null vira -1 (nunca no meio da ordenação)", explorationSortValue("revenue", explorationRow), -1);
check("explorationSortValue: valor real passa direto", explorationSortValue("spend", explorationRow), 100);

// ---------------------------------------------------------------------------
console.log("\n5 — Cards de KPI e gráfico de evolução: cliques no link/CTR do link/CPC do link\n");

function reachOk(reach: number, impressions: number) {
  return { status: "ok" as const, impressions, reach, frequency: impressions / reach };
}

function cardsSnapshot(overrides: Record<string, unknown>) {
  return {
    period: { start: "2026-10-01", end: "2026-10-31" },
    hasAnyRecord: true,
    totals: { spend: 100, impressions: 10000, clicks: 200, linkClicks: 80, resultCount: 5, revenue: null, ...overrides },
    derived: {
      cpm: 10,
      ctr: 0.02,
      linkCtr: 0.008,
      cpc: 0.5,
      linkCpc: 1.25,
      costPerResult: 20,
      roas: null,
    },
  };
}

const dashboardData: MetaAdsDashboardData = {
  client: { id: "c1", name: "Cliente Teste" },
  metaAdAccountId: "act_1",
  comparison: { current: cardsSnapshot({}) as never, previous: null, spendChangePct: null, resultCountChangePct: null },
  reachComparison: buildReachComparison(reachOk(1000, 2000), reachOk(800, 1600)),
  evolution: [],
  explorationCampaigns: [],
  explorationAdSetRows: [],
  explorationCreativeRows: [],
  resultSource: "meta_attributed",
  resultType: "leads",
  lastSyncAt: null,
  generatedAt: "2026-10-21T00:00:00Z",
};

const cards = buildMetricCardViewModels(dashboardData);
const linkClicksCard = cards.find((c) => c.id === "linkClicks")!;
const linkCtrCard = cards.find((c) => c.id === "linkCtr")!;
const linkCpcCard = cards.find((c) => c.id === "linkCpc")!;
ok("card 'Cliques no link' existe e tem rótulo próprio", linkClicksCard.label === "Cliques no link");
ok("card 'CTR do link' existe e tem rótulo próprio, distinto de 'CTR geral'", linkCtrCard.label === "CTR do link" && cards.find((c) => c.id === "ctr")?.label === "CTR geral");
ok("card 'CPC do link' existe e tem rótulo próprio, distinto de 'CPC geral'", linkCpcCard.label === "CPC do link" && cards.find((c) => c.id === "cpc")?.label === "CPC geral");

const linkRows: CampaignDailyMetricRow[] = [campaignRow({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 200, linkClicks: 80 })];
const evolution = buildEvolutionSeries({ start: "2026-10-01", end: "2026-10-01" }, { start: "2026-09-01", end: "2026-09-01" }, linkRows, [], "leads");
const linkClicksSeries = evolution.find((e) => e.id === "linkClicks")!;
const linkCtrSeries = evolution.find((e) => e.id === "linkCtr")!;
check("gráfico: série de Cliques no link tem o valor correto no dia", linkClicksSeries.current[0].value, 80);
check("gráfico: série de CTR do link tem o valor correto no dia (80/10000)", linkCtrSeries.current[0].value, 80 / 10000);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
