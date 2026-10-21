/**
 * Testes puros da Etapa 2.3 (KOFF Analytics Fase 2 — Gráficos interativos).
 * Cobre `lib/meta-ads-dashboard/evolution-data.ts`:
 *  - `buildDailyAdditiveTotals`: preenche TODOS os dias do período (mesmo
 *    sem nenhuma linha), soma corretamente quando há mais de uma linha no
 *    mesmo dia (mais de uma campanha);
 *  - `computeDailyMetricValue`: `null` (vão na linha) pro dia sem registro
 *    — nunca `0` fabricado; métricas derivadas calculadas a partir dos
 *    totais DAQUELE dia, nunca do acumulado do período;
 *  - `buildEvolutionSeries`: as 9 métricas selecionáveis, NUNCA
 *    alcance/frequência (pedido do usuário: "sem somar indicadores não
 *    aditivos" — essas duas exigiriam uma chamada à API por dia, que a
 *    Etapa 2.3 explicitamente não faz); período atual e anterior com a
 *    MESMA quantidade de pontos (alinhável por posição).
 *
 * Rodar: npx tsx scripts/test-meta-ads-evolution-data.ts
 */
import assert from "node:assert/strict";
import {
  buildDailyAdditiveTotals,
  buildEvolutionSeries,
  buildMetricSeries,
  computeDailyMetricValue,
  CHART_METRIC_IDS,
  type ChartMetricId,
} from "../src/lib/meta-ads-dashboard/evolution-data";
import type { CampaignDailyMetricRow } from "../src/lib/campaign-analytics";

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

function row(partial: Partial<CampaignDailyMetricRow> & { date: string; spend: number }): CampaignDailyMetricRow {
  return {
    channel: "meta",
    campaignName: "Campanha",
    campaignId: "c1",
    impressions: null,
    reach: null,
    clicks: null,
    resultType: null,
    resultCount: null,
    revenue: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
console.log("1 — buildDailyAdditiveTotals: todos os dias preenchidos, soma correta\n");

const period = { start: "2026-10-01", end: "2026-10-03" };
const rows: CampaignDailyMetricRow[] = [
  row({ date: "2026-10-01", spend: 100, impressions: 1000, clicks: 10, resultCount: 2, revenue: 50, campaignName: "A" }),
  row({ date: "2026-10-01", spend: 50, impressions: 500, clicks: 5, resultCount: 1, revenue: null, campaignName: "B" }),
  // 2026-10-02 sem nenhuma linha — dia "pulado" na origem.
  row({ date: "2026-10-03", spend: 200, impressions: 2000, clicks: 20, resultCount: 4, revenue: 100, campaignName: "A" }),
];

const days = buildDailyAdditiveTotals(period, rows);
check("todos os 3 dias do período aparecem, na ordem certa", days.map((d) => d.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
check("dia com 2 campanhas: soma as duas (spend/impressions/clicks/resultCount)", {
  spend: days[0].spend,
  impressions: days[0].impressions,
  clicks: days[0].clicks,
  resultCount: days[0].resultCount,
  revenue: days[0].revenue,
}, { spend: 150, impressions: 1500, clicks: 15, resultCount: 3, revenue: 50 });
check("dia sem nenhuma linha: hasAnyRecord false, tudo zerado (nunca usado como valor real)", days[1], {
  date: "2026-10-02",
  hasAnyRecord: false,
  spend: 0,
  impressions: 0,
  clicks: 0,
  resultCount: 0,
  revenue: null,
});

// ---------------------------------------------------------------------------
console.log("\n2 — computeDailyMetricValue: null pro dia sem registro, nunca 0 fabricado\n");

for (const id of CHART_METRIC_IDS) {
  check(`dia sem registro: ${id} é null (vão na linha)`, computeDailyMetricValue(id, days[1]), null);
}

check("investimento do dia 1 (dado real)", computeDailyMetricValue("investment", days[0]), 150);
check("CTR do dia 1 (15 cliques / 1500 impressões)", computeDailyMetricValue("ctr", days[0]), 15 / 1500);
check("custo por resultado do dia 1 (150 / 3)", computeDailyMetricValue("costPerResult", days[0]), 50);
check("ROAS do dia 1 (50 receita / 150 spend)", computeDailyMetricValue("roas", days[0]), 50 / 150);

// ---------------------------------------------------------------------------
console.log("\n3 — buildMetricSeries / buildEvolutionSeries\n");

const investmentSeries = buildMetricSeries("investment", days);
check("série de investimento tem 1 ponto por dia, incluindo o vão", investmentSeries, [
  { date: "2026-10-01", value: 150 },
  { date: "2026-10-02", value: null },
  { date: "2026-10-03", value: 200 },
]);

const previousPeriod = { start: "2026-09-28", end: "2026-09-30" };
const previousRows: CampaignDailyMetricRow[] = [row({ date: "2026-09-28", spend: 80, impressions: 800, clicks: 8, resultCount: 1, revenue: null })];

const evolution = buildEvolutionSeries(period, previousPeriod, rows, previousRows, "leads");

check("exatamente as 9 métricas selecionáveis, na ordem canônica", evolution.map((e) => e.id), CHART_METRIC_IDS);
ok("NUNCA inclui alcance/frequência (sem série diária correta disponível)", !evolution.some((e) => (e.id as string) === "reach" || (e.id as string) === "frequency"));

const resultsSeries = evolution.find((e) => e.id === "results")!;
check("rótulo dinâmico por objetivo (leads)", resultsSeries.label, "Leads");
check("período atual e anterior com a MESMA quantidade de pontos (alinhável por posição)", resultsSeries.current.length, resultsSeries.previous.length);

const typedIds: ChartMetricId[] = CHART_METRIC_IDS;
ok("CHART_METRIC_IDS é tipado corretamente", typedIds.length === 9);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
