/**
 * Testes puros da Etapa "Posicionamentos" (Meta "Platform Position" — feed,
 * stories, reels etc.) — pedido explícito do usuário, validado com dado
 * real da conta Aibou antes da implementação (soma por posicionamento bateu
 * com o Gerenciador de Anúncios, com pequena defasagem de atualização
 * esperada pro dia corrente). Cobre:
 *  - agregação bruta (`aggregatePlacementDailyRows`) soma corretamente
 *    todas as linhas do mesmo dia+campanha+posicionamento, sem duplicar;
 *  - reconciliação: SUM(posicionamentos) == SUM(campanhas) pro MESMO
 *    dataset bruto — a MESMA garantia matemática que o usuário validou
 *    manualmente com a Aibou antes de aprovar a implementação;
 *  - resolução de resultado por grupo (mesma disciplina de campanha/ad set/
 *    criativo);
 *  - upsert rows (`buildCampaignPlacementDailyMetricsUpsertRows`);
 *  - `buildPlacementSummaries` (`lib/campaign-placement-analytics.ts`):
 *    agrupa só por posicionamento (TOTAL DA CONTA, nunca por campanha
 *    nesta v1), CPA/ROAS via `lib/performance.ts` (nunca uma segunda
 *    fórmula), spendShare/resultShare corretos, resultShare null sem
 *    nenhum resultado mapeado.
 *
 * Rodar: npx tsx scripts/test-campaign-placement-analytics.ts
 */
import assert from "node:assert/strict";
import {
  aggregateCampaignDailyRows,
  aggregateColumnByPlacementGroup,
  aggregatePlacementDailyRows,
  buildCampaignPlacementDailyMetricsUpsertRows,
  combinePlacementGroupValues,
  type RawSourceRow,
} from "../src/lib/import-sources";
import { buildPlacementSummaries, type CampaignPlacementDailyMetricRow } from "../src/lib/campaign-placement-analytics";

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
  platformPositionColumn: "breakdowns_platform_position",
  spendColumn: "insights_spend",
};

// ---------------------------------------------------------------------------
console.log("1 — Grão real (dia×campanha×posicionamento×anúncio): soma sem duplicar\n");

// Mesmo cenário confirmado com dado real da Aibou: o MESMO posicionamento
// tem várias linhas no mesmo dia/campanha (uma por anúncio) — a agregação
// de posicionamento precisa somar todas numa linha só.
const rawRows: RawSourceRow[] = [
  { adhoc__daily: "2026-09-22", insights_campaign_name: "Vendas | Lançamento", breakdowns_platform_position: "feed", insights_spend: "0.01" },
  { adhoc__daily: "2026-09-22", insights_campaign_name: "Vendas | Lançamento", breakdowns_platform_position: "feed", insights_spend: "2.898034" },
  { adhoc__daily: "2026-09-22", insights_campaign_name: "Vendas | Lançamento", breakdowns_platform_position: "instagram_reels", insights_spend: "4.564497" },
  { adhoc__daily: "2026-09-21", insights_campaign_name: "Vendas | Lançamento", breakdowns_platform_position: "feed", insights_spend: "1.00" },
];

const placementAgg = aggregatePlacementDailyRows(rawRows, COLUMNS);
check("3 grupos (dia+campanha+posicionamento) resultam de 4 linhas de anúncio", placementAgg.length, 3);

const day22Feed = placementAgg.find((r) => r.date === "2026-09-22" && r.platformPosition === "feed");
ok("dia 22, posicionamento 'feed' existe", !!day22Feed);
check("soma de spend das 2 linhas do mesmo posicionamento/dia", day22Feed!.spend, 0.01 + 2.898034);

// ---------------------------------------------------------------------------
console.log("\n2 — Reconciliação: SUM(posicionamentos) == SUM(campanhas) pro MESMO dataset\n");

const campaignAgg = aggregateCampaignDailyRows(rawRows, {
  dateColumn: COLUMNS.dateColumn,
  campaignNameColumn: COLUMNS.campaignNameColumn,
  spendColumn: COLUMNS.spendColumn,
});

const totalPlacementSpend = placementAgg.reduce((sum, r) => sum + r.spend, 0);
const totalCampaignSpend = campaignAgg.reduce((sum, r) => sum + r.spend, 0);
ok(
  "investimento total é IDÊNTICO agrupado por posicionamento ou por campanha (mesmas linhas de origem) — a mesma garantia validada manualmente com dado real da Aibou",
  Math.abs(totalPlacementSpend - totalCampaignSpend) < 1e-9,
);

// ---------------------------------------------------------------------------
console.log("\n3 — Resolução de resultado por grupo (mesma disciplina de campanha/ad set/criativo)\n");

const resultRows: RawSourceRow[] = [
  { adhoc__daily: "2026-09-22", insights_campaign_name: "C1", breakdowns_platform_position: "feed", insights_spend: "100", actions_omni_purchase: "5" },
  { adhoc__daily: "2026-09-22", insights_campaign_name: "C1", breakdowns_platform_position: "instagram_reels", insights_spend: "50", actions_omni_purchase: "2" },
];
const resultPlacementAgg = aggregatePlacementDailyRows(resultRows, COLUMNS);
const resultByGroupAgg = aggregateColumnByPlacementGroup(
  resultRows,
  COLUMNS.dateColumn,
  COLUMNS.campaignNameColumn,
  COLUMNS.platformPositionColumn,
  "actions_omni_purchase",
);
const combined = combinePlacementGroupValues([resultByGroupAgg]);
const resultByGroup = new Map(combined.map((r) => [`${r.date} ${r.campaignName} ${r.platformPosition}`, r.value]));

const upsertRows = buildCampaignPlacementDailyMetricsUpsertRows("client-1", "source-1", "meta", resultPlacementAgg, {
  resultType: "sales",
  resultByGroup,
  revenueByGroup: null,
});
const feedRow = upsertRows.find((r) => r.platform_position === "feed")!;
check("feed recebe result_count=5 (sales) da coluna de resultado configurada", feedRow.result_count, 5);
check("feed result_type=sales só quando há resultado resolvido pra esse grupo", feedRow.result_type, "sales");
check(
  "campaign_name/platform_position/channel corretos na linha de upsert",
  [feedRow.campaign_name, feedRow.platform_position, feedRow.channel],
  ["C1", "feed", "meta"],
);

// ---------------------------------------------------------------------------
console.log("\n4 — buildPlacementSummaries: TOTAL DA CONTA, agrupado só por posicionamento (nunca por campanha)\n");

const summaryRows: CampaignPlacementDailyMetricRow[] = [
  { date: "2026-09-22", channel: "meta", campaignName: "C1", platformPosition: "feed", spend: 30, resultType: "sales", resultCount: 3, revenue: 300 },
  { date: "2026-09-22", channel: "meta", campaignName: "C2", platformPosition: "feed", spend: 10, resultType: "sales", resultCount: 1, revenue: 100 },
  { date: "2026-09-22", channel: "meta", campaignName: "C1", platformPosition: "instagram_reels", spend: 60, resultType: "sales", resultCount: 6, revenue: 900 },
];
const summaries = buildPlacementSummaries(summaryRows);
check("2 posicionamentos na saída, mesmo tendo 2 campanhas diferentes — C1+C2 do feed somados numa linha só", summaries.length, 2);

const feedSummary = summaries.find((s) => s.platformPosition === "feed")!;
check("feed: investimento consolidado das 2 campanhas (30+10)", feedSummary.totalSpend, 40);
check("feed: resultado consolidado das 2 campanhas (3+1)", feedSummary.totalResultCount, 4);
check("feed: CPA = investimento total / resultado total (40/4), nunca uma fórmula própria", feedSummary.cpa, 10);
check("feed: ROAS = receita total / investimento total (400/40)", feedSummary.roas, 10);

ok("ordenado por investimento decrescente (reels 60 antes de feed 40)", summaries[0].platformPosition === "instagram_reels");

const totalSpend = 30 + 10 + 60;
const totalResult = 3 + 1 + 6;
check("feed: spendShare = 40/100 (fração 0-1, nunca 0-100)", feedSummary.spendShare, 40 / totalSpend);
check("feed: resultShare = 4/10", feedSummary.resultShare, 4 / totalResult);

// ---------------------------------------------------------------------------
console.log("\n5 — buildPlacementSummaries: sem nenhum resultado mapeado, resultShare é null (nunca 0 fabricado)\n");

const noResultRows: CampaignPlacementDailyMetricRow[] = [
  { date: "2026-09-22", channel: "meta", campaignName: "C1", platformPosition: "feed", spend: 30, resultType: null, resultCount: null, revenue: null },
  { date: "2026-09-22", channel: "meta", campaignName: "C1", platformPosition: "instagram_stories", spend: 10, resultType: null, resultCount: null, revenue: null },
];
const noResultSummaries = buildPlacementSummaries(noResultRows);
ok("nenhum posicionamento tem resultShare (sem base pra calcular participação)", noResultSummaries.every((s) => s.resultShare === null));
ok("spendShare continua calculado normalmente (não depende de resultado)", noResultSummaries.every((s) => s.spendShare > 0));
check("CPA null sem nenhum resultado registrado (hasAnyRecord=false), nunca 0/Infinity", noResultSummaries[0].cpa, null);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
