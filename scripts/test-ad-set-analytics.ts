/**
 * Testes puros da Etapa "Ad Set (Públicos)" — cobre:
 *  - agregação bruta (`aggregateAdSetDailyRows`) soma corretamente todas as
 *    linhas de anúncio de um mesmo dia+campanha+ad set, sem duplicar;
 *  - reconciliação: SUM(ad sets) == SUM(campanhas) pro MESMO dataset bruto,
 *    já que são as mesmas linhas de origem, só agrupadas diferente (nunca
 *    uma segunda fonte de investimento);
 *  - consolidação por público (`buildAdSetSummaries`) soma um mesmo ad set
 *    que aparece em mais de uma campanha, mantendo `campaignNames`;
 *  - zero != ausência de dado (resultCount 0 vs null);
 *  - upsert rows (`buildAdSetDailyMetricsUpsertRows`) preservam a mesma
 *    disciplina de result_type/result_count/revenue de campanha/criativo;
 *  - regressão: pipeline de campanha/criativo continua produzindo o mesmo
 *    resultado de sempre quando rodado ao lado da nova agregação de ad set.
 *
 * Rodar: npx tsx scripts/test-ad-set-analytics.ts
 */
import assert from "node:assert/strict";
import {
  aggregateAdSetDailyRows,
  aggregateCampaignDailyRows,
  aggregateColumnByAdSetGroup,
  buildAdSetDailyMetricsUpsertRows,
  combineAdSetGroupValues,
  type RawSourceRow,
} from "../src/lib/import-sources";
import { buildAdSetSummaries, type AdSetDailyMetricRow } from "../src/lib/ad-set-analytics";

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

const COLUMNS = {
  dateColumn: "adhoc__daily",
  campaignNameColumn: "insights_campaign_name",
  adSetNameColumn: "insights_adset_name",
  spendColumn: "insights_spend",
  impressionsColumn: "insights_impressions",
  reachColumn: null,
  clicksColumn: null,
};

// ---------------------------------------------------------------------------
console.log("1 — Grão real (dia×campanha×ad set×anúncio): soma sem duplicar\n");

// Mesmo cenário confirmado na inspeção real (Ateliê): o MESMO ad set roda com
// vários anúncios diferentes no mesmo dia/campanha — a agregação de ad set
// precisa somar todos eles numa linha só.
const rawRows: RawSourceRow[] = [
  { adhoc__daily: "2026-08-12", insights_campaign_name: "ATELIE01 | VENDAS | 01", insights_adset_name: "00 - Seguidores", insights_ad_name: "Anuncio A", insights_spend: "10.00", insights_impressions: "100" },
  { adhoc__daily: "2026-08-12", insights_campaign_name: "ATELIE01 | VENDAS | 01", insights_adset_name: "00 - Seguidores", insights_ad_name: "Anuncio B", insights_spend: "5.50", insights_impressions: "50" },
  { adhoc__daily: "2026-08-12", insights_campaign_name: "ATELIE01 | VENDAS | 01", insights_adset_name: "01 - Lookalike", insights_ad_name: "Anuncio A", insights_spend: "20.00", insights_impressions: "200" },
  { adhoc__daily: "2026-08-13", insights_campaign_name: "ATELIE01 | VENDAS | 01", insights_adset_name: "00 - Seguidores", insights_ad_name: "Anuncio A", insights_spend: "8.00", insights_impressions: "80" },
];

const adSetAgg = aggregateAdSetDailyRows(rawRows, COLUMNS);
check("3 grupos (dia+campanha+ad set) resultam de 4 linhas de anúncio", adSetAgg.length, 3);

const day12Seguidores = adSetAgg.find((r) => r.date === "2026-08-12" && r.adSetName === "00 - Seguidores");
ok("dia 12, ad set 'Seguidores' existe", !!day12Seguidores);
check("soma de spend dos 2 anúncios do mesmo ad set/dia", day12Seguidores!.spend, 15.5);
check("soma de impressions dos 2 anúncios do mesmo ad set/dia", day12Seguidores!.impressions, 150);

// ---------------------------------------------------------------------------
console.log("\n2 — Reconciliação: SUM(ad sets) == SUM(campanhas) pro MESMO dataset\n");

const campaignAgg = aggregateCampaignDailyRows(rawRows, {
  dateColumn: COLUMNS.dateColumn,
  campaignNameColumn: COLUMNS.campaignNameColumn,
  spendColumn: COLUMNS.spendColumn,
  impressionsColumn: COLUMNS.impressionsColumn,
});

const totalAdSetSpend = adSetAgg.reduce((sum, r) => sum + r.spend, 0);
const totalCampaignSpend = campaignAgg.reduce((sum, r) => sum + r.spend, 0);
check("investimento total é IDÊNTICO agrupado por ad set ou por campanha (mesmas linhas de origem)", totalAdSetSpend, totalCampaignSpend);
check("investimento total bate com a soma bruta das 4 linhas de anúncio", totalAdSetSpend, 10 + 5.5 + 20 + 8);

const totalAdSetImpressions = adSetAgg.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
const totalCampaignImpressions = campaignAgg.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
check("impressões totais também reconciliam", totalAdSetImpressions, totalCampaignImpressions);

// ---------------------------------------------------------------------------
console.log("\n3 — Público reutilizado em MAIS DE UMA campanha soma como uma linha só\n");

const multiCampaignRows: RawSourceRow[] = [
  { adhoc__daily: "2026-08-01", insights_campaign_name: "Campanha A", insights_adset_name: "Lookalike 1%", insights_ad_name: "Ad 1", insights_spend: "100" },
  { adhoc__daily: "2026-08-02", insights_campaign_name: "Campanha B", insights_adset_name: "Lookalike 1%", insights_ad_name: "Ad 2", insights_spend: "50" },
];
const multiCampaignAdSetAgg = aggregateAdSetDailyRows(multiCampaignRows, COLUMNS);
const summaries = buildAdSetSummaries(
  multiCampaignAdSetAgg.map(
    (r): AdSetDailyMetricRow => ({
      date: r.date,
      channel: "meta",
      campaignName: r.campaignName,
      adSetName: r.adSetName,
      spend: r.spend,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      resultType: null,
      resultCount: null,
      revenue: null,
    }),
  ),
);
check("um público só na saída, mesmo tendo rodado em 2 campanhas", summaries.length, 1);
check("investimento consolidado do público = soma das 2 campanhas", summaries[0].totalSpend, 150);
check("campaignNames lista as 2 campanhas onde o público rodou", summaries[0].campaignNames, ["Campanha A", "Campanha B"]);

// ---------------------------------------------------------------------------
console.log("\n4 — Zero é diferente de ausência de dado\n");

const zeroResultRow: AdSetDailyMetricRow = {
  date: "2026-08-01",
  channel: "meta",
  campaignName: "C",
  adSetName: "Público X",
  spend: 100,
  impressions: 1000,
  reach: null,
  clicks: null,
  resultType: "sales",
  resultCount: 0,
  revenue: 0,
};
const noResultRow: AdSetDailyMetricRow = { ...zeroResultRow, adSetName: "Público Y", resultType: null, resultCount: null, revenue: null };
const zeroVsAbsence = buildAdSetSummaries([zeroResultRow, noResultRow]);
const publicoX = zeroVsAbsence.find((s) => s.adSetName === "Público X")!;
const publicoY = zeroVsAbsence.find((s) => s.adSetName === "Público Y")!;
check("Público X: 0 compras reais (não null) — CPA null (divisão por zero é ausência de custo válido, nunca 0)", publicoX.totalResultCount, 0);
check("Público X: CPA é null quando resultCount é 0 (nunca Infinity/fabricado)", publicoX.cpa, null);
check("Público Y: resultCount null (nunca fabricado como 0) — fonte sem mapeamento pra esse público", publicoY.totalResultCount, null);

// ---------------------------------------------------------------------------
console.log("\n5 — Resolução de resultado por grupo (mesma disciplina de campanha/criativo)\n");

const resultRows: RawSourceRow[] = [
  { adhoc__daily: "2026-08-01", insights_campaign_name: "C1", insights_adset_name: "AS1", insights_spend: "100", actions_purchase: "5" },
  { adhoc__daily: "2026-08-01", insights_campaign_name: "C1", insights_adset_name: "AS2", insights_spend: "50", actions_purchase: "2" },
];
const resultAdSetAgg = aggregateAdSetDailyRows(resultRows, COLUMNS);
const resultByGroupAgg = aggregateColumnByAdSetGroup(resultRows, COLUMNS.dateColumn, COLUMNS.campaignNameColumn, COLUMNS.adSetNameColumn, "actions_purchase");
const combined = combineAdSetGroupValues([resultByGroupAgg]);
const resultByGroup = new Map(combined.map((r) => [`${r.date} ${r.campaignName} ${r.adSetName}`, r.value]));

const upsertRows = buildAdSetDailyMetricsUpsertRows("client-1", "source-1", "meta", resultAdSetAgg, {
  resultType: "sales",
  resultByGroup,
  revenueByGroup: null,
});
const as1Row = upsertRows.find((r) => r.ad_set_name === "AS1")!;
check("AS1 recebe result_count=5 (sales) da coluna de resultado configurada", as1Row.result_count, 5);
check("AS1 result_type=sales só quando há resultado resolvido pra esse grupo", as1Row.result_type, "sales");
check("campaign_name/ad_set_name/channel corretos na linha de upsert", [as1Row.campaign_name, as1Row.ad_set_name, as1Row.channel], ["C1", "AS1", "meta"]);

// ---------------------------------------------------------------------------
console.log("\n6 — Regressão: agregação de campanha não é afetada pela nova coluna de ad set\n");

const regressionCampaignAgg = aggregateCampaignDailyRows(rawRows, {
  dateColumn: COLUMNS.dateColumn,
  campaignNameColumn: COLUMNS.campaignNameColumn,
  spendColumn: COLUMNS.spendColumn,
  impressionsColumn: COLUMNS.impressionsColumn,
});
check("aggregateCampaignDailyRows continua agrupando só por (date, campaignName), 2 grupos (12 e 13/08)", regressionCampaignAgg.length, 2);
check("campanha do dia 12 soma as 3 linhas (2 ad sets, 3 anúncios)", regressionCampaignAgg.find((r) => r.date === "2026-08-12")!.spend, 35.5);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
