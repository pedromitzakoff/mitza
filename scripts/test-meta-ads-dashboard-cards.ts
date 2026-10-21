/**
 * Testes puros da Etapa 2.2 (KOFF Analytics Fase 2 — Cards de KPI
 * configuráveis). Cobre:
 *  - `buildReachComparison` (`lib/meta-ads-dashboard/dashboard-data.ts`):
 *    variação só calculada quando os DOIS lados estão "ok", nunca contra um
 *    snapshot indisponível; frequência null não gera variação fabricada.
 *  - `buildMetricCardViewModels` (`lib/meta-ads-dashboard/metric-cards.ts`):
 *    os 14 cards na ordem certa, rótulos dinâmicos por objetivo, "Sem dados
 *    no período" distinto de "0" (pedido do usuário: "diferencie ausência
 *    de dados de resultado igual a zero"), estados de indisponibilidade de
 *    alcance/frequência (nunca "0" fabricado), e "—" pra métricas derivadas
 *    sem base de cálculo.
 *
 * Rodar: npx tsx scripts/test-meta-ads-dashboard-cards.ts
 */
import assert from "node:assert/strict";
import {
  buildReachComparison,
  type MetaAdsAdditiveTotals,
  type MetaAdsDashboardData,
  type MetaAdsPeriodSnapshot,
  type MetaAdsReachSnapshot,
} from "../src/lib/meta-ads-dashboard/dashboard-data";
import { buildMetricCardViewModels, ALL_METRIC_CARD_IDS, DEFAULT_SELECTED_METRIC_IDS } from "../src/lib/meta-ads-dashboard/metric-cards";
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
console.log("1 — buildReachComparison: variação só entre dois snapshots \"ok\"\n");

const reachOk = (reach: number, impressions: number): MetaAdsReachSnapshot => ({
  status: "ok",
  impressions,
  reach,
  frequency: impressions / reach,
});
type ReachUnavailableReason = Extract<MetaAdsReachSnapshot, { status: "unavailable" }>["reason"];
const reachUnavailable = (reason: ReachUnavailableReason): MetaAdsReachSnapshot => ({ status: "unavailable", reason });

const bothOk = buildReachComparison(reachOk(1000, 2500), reachOk(800, 1600));
ok("ambos ok: reachChangePct calculado", bothOk.reachChangePct !== null);
check("reachChangePct correto", bothOk.reachChangePct, ((1000 - 800) / 800) * 100);
ok("ambos ok: frequencyChangePct calculado", bothOk.frequencyChangePct !== null);

const currentUnavailable = buildReachComparison(reachUnavailable("not_configured"), reachOk(800, 1600));
check("current indisponível: reachChangePct null (nunca comparado)", currentUnavailable.reachChangePct, null);
check("current indisponível: frequencyChangePct null", currentUnavailable.frequencyChangePct, null);

const previousUnavailable = buildReachComparison(reachOk(1000, 2500), reachUnavailable("not_configured"));
check("previous indisponível: reachChangePct null (nunca comparado)", previousUnavailable.reachChangePct, null);

const zeroReach = buildReachComparison({ status: "ok", impressions: 500, reach: 0, frequency: null }, reachOk(800, 1600));
check("alcance atual zero (frequência null): frequencyChangePct null, nunca Infinity/NaN", zeroReach.frequencyChangePct, null);

// ---------------------------------------------------------------------------
console.log("\n2 — buildMetricCardViewModels: os 14 cards, valores e variações corretos\n");

function snapshot(partial: Partial<MetaAdsAdditiveTotals> & { hasAnyRecord?: boolean }): MetaAdsPeriodSnapshot {
  const { hasAnyRecord: hasAnyRecordOverride, ...totalsPartial } = partial;
  const totals: MetaAdsAdditiveTotals = { spend: 0, impressions: 0, clicks: 0, linkClicks: null, resultCount: 0, revenue: null, ...totalsPartial };
  const hasAnyRecord = hasAnyRecordOverride ?? true;
  const impressions = totals.impressions;
  const clicks = totals.clicks;
  const spend = totals.spend;
  const resultCount = totals.resultCount;
  const linkClicks = totals.linkClicks;
  return {
    period: { start: "2026-10-01", end: "2026-10-31" },
    hasAnyRecord,
    totals,
    derived: {
      cpm: impressions > 0 ? (spend * 1000) / impressions : null,
      ctr: impressions > 0 ? clicks / impressions : null,
      cpc: clicks > 0 ? spend / clicks : null,
      linkCtr: linkClicks !== null && impressions > 0 ? linkClicks / impressions : null,
      linkCpc: linkClicks !== null && linkClicks > 0 ? spend / linkClicks : null,
      costPerResult: hasAnyRecord && resultCount > 0 ? spend / resultCount : null,
      roas: totals.revenue !== null && spend > 0 ? totals.revenue / spend : null,
    },
  };
}

function buildData(overrides: Partial<MetaAdsDashboardData>): MetaAdsDashboardData {
  const current = snapshot({ spend: 1000, impressions: 100000, clicks: 500, resultCount: 20, revenue: 2000 });
  const previous = snapshot({ spend: 800, impressions: 80000, clicks: 400, resultCount: 10, revenue: 1000 });
  return {
    client: { id: "c1", name: "Cliente Teste" },
    metaAdAccountId: "act_123",
    comparison: {
      current,
      previous,
      spendChangePct: ((1000 - 800) / 800) * 100,
      resultCountChangePct: ((20 - 10) / 10) * 100,
    },
    reachComparison: buildReachComparison(reachOk(50000, 100000), reachOk(40000, 80000)),
    evolution: [],
    explorationCampaigns: [],
    explorationAdSetRows: [],
    explorationCreativeRows: [],
    resultSource: "meta_attributed",
    resultType: "leads",
    lastSyncAt: "2026-10-21T12:00:00Z",
    generatedAt: "2026-10-21T12:05:00Z",
    ...overrides,
  };
}

const data = buildData({});
const cards = buildMetricCardViewModels(data);

check("monta exatamente os 14 cards, na ordem canônica", cards.map((c) => c.id), ALL_METRIC_CARD_IDS);
ok("seleção padrão tem ~6 métricas, todas entre as 11 existentes", DEFAULT_SELECTED_METRIC_IDS.length === 6 && DEFAULT_SELECTED_METRIC_IDS.every((id) => ALL_METRIC_CARD_IDS.includes(id)));

const investmentCard = cards.find((c) => c.id === "investment")!;
check("Investimento formatado em moeda", investmentCard.value, formatCurrency(1000));
ok("Investimento tem variação (tom neutro, gastar mais não é bom nem ruim)", investmentCard.comparison?.tone === "neutral");

const resultsCard = cards.find((c) => c.id === "results")!;
check("Resultados usa o rótulo dinâmico do objetivo (leads)", resultsCard.label, "Leads");
ok("Resultados: variação positiva (20 > 10) marcada como boa", resultsCard.comparison?.tone === "positive");

const roasCard = cards.find((c) => c.id === "roas")!;
check("ROAS no formato Nx", roasCard.value, "2.00x");

const ctrCard = cards.find((c) => c.id === "ctr")!;
ok("CTR tem valor formatado em percentual", ctrCard.value.includes("%"));

console.log("\n3 — Resultados: \"Sem dados no período\" ≠ \"0\" (ausência vs. zero)\n");

const noDataSnapshot = snapshot({ hasAnyRecord: false });
const noDataCards = buildMetricCardViewModels(buildData({ comparison: { current: noDataSnapshot, previous: null, spendChangePct: null, resultCountChangePct: null } }));
const noDataResultsCard = noDataCards.find((c) => c.id === "results")!;
check("sem nenhuma linha no período: \"Sem dados no período\" (nunca \"0\")", noDataResultsCard.value, "Sem dados no período");
check("sem dados: nenhuma variação", noDataResultsCard.comparison, null);

const zeroResultsSnapshot = snapshot({ spend: 500, resultCount: 0, hasAnyRecord: true });
const zeroResultsCards = buildMetricCardViewModels(buildData({ comparison: { current: zeroResultsSnapshot, previous: null, spendChangePct: null, resultCountChangePct: null } }));
check("linhas existem mas 0 resultados registrados: mostra \"0\" (dado real, não ausência)", zeroResultsCards.find((c) => c.id === "results")!.value, "0");
check("0 resultados: custo por resultado \"—\" (divisão por zero nunca é número)", zeroResultsCards.find((c) => c.id === "costPerResult")!.value, "—");

console.log("\n4 — Alcance/frequência: nunca \"0\" fabricado quando indisponível\n");

const unavailableReachData = buildData({ reachComparison: buildReachComparison(reachUnavailable("not_configured"), reachUnavailable("not_configured")) });
const unavailableCards = buildMetricCardViewModels(unavailableReachData);
check("Alcance indisponível: mensagem explicativa, nunca \"0\"", unavailableCards.find((c) => c.id === "reach")!.value, "Integração direta Meta não configurada");
check("Frequência indisponível: mesma mensagem, nunca \"0\"", unavailableCards.find((c) => c.id === "frequency")!.value, "Integração direta Meta não configurada");
check("sem alcance: nenhuma variação fabricada", unavailableCards.find((c) => c.id === "reach")!.comparison, null);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
