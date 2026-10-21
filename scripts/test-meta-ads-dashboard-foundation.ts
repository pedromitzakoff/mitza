/**
 * Testes puros da Fundação do Dashboard Meta Ads (KOFF Analytics Fase 2,
 * Etapa 2.1 — `/clients/[id]/meta-ads`). Cobre:
 *  - métricas derivadas novas de `lib/performance.ts` (CPM/CTR/CPC/
 *    frequência) — divisão segura via `safeDivide`, nunca `0`/`Infinity`;
 *  - `sumAdditiveTotals`/`buildPeriodSnapshot`/`buildPeriodComparison`
 *    (`lib/meta-ads-dashboard/dashboard-data.ts`): agregação aditiva
 *    correta, `previous: null` sem histórico, variação percentual via
 *    `previousEquivalentPeriod`/`computePercentChange` (nenhum segundo
 *    cálculo de período anterior);
 *  - a regra crítica do usuário ("frequência e alcance NUNCA somando
 *    alcance diário"): `computeFrequency` só aceita impressões/alcance já
 *    do MESMO escopo — este teste documenta o uso correto (período inteiro
 *    de uma vez), nunca soma diária.
 *
 * Rodar: npx tsx scripts/test-meta-ads-dashboard-foundation.ts
 */
import assert from "node:assert/strict";
import { computeCpm, computeCtr, computeCpc, computeFrequency } from "../src/lib/performance";
import {
  sumAdditiveTotals,
  buildPeriodSnapshot,
  buildPeriodComparison,
  type MetaAdsAdditiveTotals,
} from "../src/lib/meta-ads-dashboard/dashboard-data";
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
    linkClicks: null,
    resultType: null,
    resultCount: null,
    revenue: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
console.log("1 — CPM/CTR/CPC/Frequência: divisão segura, nunca 0/Infinity\n");

check("CPM normal (spend 50, 20000 impressões)", computeCpm(50, 20000), 2.5);
check("CPM sem impressões: null", computeCpm(50, 0), null);
check("CTR normal (100 cliques, 10000 impressões)", computeCtr(100, 10000), 0.01);
check("CTR sem impressões: null", computeCtr(100, 0), null);
check("CPC normal (spend 50, 25 cliques)", computeCpc(50, 25), 2);
check("CPC sem cliques: null", computeCpc(50, 0), null);
check("Frequência normal (1000 impressões, 400 alcance do MESMO período)", computeFrequency(1000, 400), 2.5);
check("Frequência sem alcance: null (nunca Infinity)", computeFrequency(1000, 0), null);

// ---------------------------------------------------------------------------
console.log("\n2 — sumAdditiveTotals: soma aditiva correta, nunca inclui alcance\n");

const rows: CampaignDailyMetricRow[] = [
  row({ date: "2026-10-01", spend: 100, impressions: 1000, clicks: 10, resultCount: 2, revenue: 50 }),
  row({ date: "2026-10-02", spend: 200, impressions: 2000, clicks: 20, resultCount: 3, revenue: null }),
];

check("soma de spend/impressions/clicks/resultCount", sumAdditiveTotals(rows), {
  spend: 300,
  impressions: 3000,
  clicks: 30,
  linkClicks: null,
  resultCount: 5,
  revenue: 50,
} as MetaAdsAdditiveTotals);

check("revenue null quando NENHUMA linha tem receita (nunca 0 fabricado)", sumAdditiveTotals([row({ date: "2026-10-01", spend: 10 })]).revenue, null);

// ---------------------------------------------------------------------------
console.log("\n3 — buildPeriodSnapshot: métricas derivadas a partir dos totais somados\n");

const snapshot = buildPeriodSnapshot({ start: "2026-10-01", end: "2026-10-02" }, rows);
check("CPM do snapshot", snapshot.derived.cpm, computeCpm(300, 3000));
check("CTR do snapshot", snapshot.derived.ctr, computeCtr(30, 3000));
check("ROAS do snapshot (receita 50 / spend 300)", snapshot.derived.roas, 50 / 300);

const emptySnapshot = buildPeriodSnapshot({ start: "2026-10-01", end: "2026-10-02" }, []);
check("sem nenhuma linha: costPerResult null (hasAnyRecord false)", emptySnapshot.derived.costPerResult, null);

// ---------------------------------------------------------------------------
console.log("\n4 — buildPeriodComparison: período anterior de MESMA duração, nunca fabricado\n");

const previousRows: CampaignDailyMetricRow[] = [row({ date: "2026-09-29", spend: 150, resultCount: 4 })];
const comparison = buildPeriodComparison({ start: "2026-10-01", end: "2026-10-02" }, rows, previousRows);

ok("previous existe quando há linhas no período anterior", comparison.previous !== null);
check("variação de investimento vs. período anterior", comparison.spendChangePct, ((300 - 150) / 150) * 100);
check("variação de resultado vs. período anterior", comparison.resultCountChangePct, ((5 - 4) / 4) * 100);

const comparisonNoHistory = buildPeriodComparison({ start: "2026-10-01", end: "2026-10-02" }, rows, []);
check("sem histórico anterior: previous null (nunca snapshot fabricado de 0 linhas)", comparisonNoHistory.previous, null);
check("sem histórico anterior: variação null", comparisonNoHistory.spendChangePct, null);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
