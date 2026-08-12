/**
 * Testes puros do objeto canônico de métricas por canal (Etapa "Arquitetura
 * Multicanal Unificada") — `consolidateAdditive`/`consolidateChannelMetrics`
 * (lib/channel-metrics.ts) e `resolveClientMonthlyActuals` (lib/client-actuals.ts).
 * Cobre especificamente a regra que motivou toda esta etapa: CPA/ROAS
 * consolidados NUNCA são média/soma dos valores por canal, sempre derivados
 * dos totais aditivos já somados.
 *
 * Rodar: npx tsx scripts/test-channel-metrics.ts
 */
import assert from "node:assert/strict";
import { consolidateAdditive, consolidateChannelMetrics, type ChannelMetrics } from "../src/lib/channel-metrics";
import { resolveClientMonthlyActuals } from "../src/lib/client-actuals";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("consolidateAdditive\n");

check("nenhum canal -> null", consolidateAdditive([], () => 100), null);
check("todos os canais sem dado -> null (nunca 0 fabricado)", consolidateAdditive(["meta", "google"], () => null), null);
check(
  "só um canal com dado -> o próprio valor (canal sem dado não conta como 0)",
  consolidateAdditive(["meta", "google"], (c) => (c === "meta" ? 500 : null)),
  500,
);
check(
  "dois canais com dado -> soma",
  consolidateAdditive(["meta", "google"], (c) => (c === "meta" ? 6000 : 4000)),
  10000,
);

console.log("\nconsolidateChannelMetrics\n");

check(
  "sem revenue em nenhum canal -> consolidado nunca ganha a chave revenue/roas",
  consolidateChannelMetrics(["meta", "google"], {
    meta: { investment: 6000, resultCount: 300, cpa: 20 },
    google: { investment: 4000, resultCount: 100, cpa: 40 },
  }),
  { investment: 10000, resultCount: 400, revenue: undefined, cpa: 25, roas: undefined },
);

check(
  "CPA consolidado é investimento total ÷ resultado total, NUNCA média dos CPAs por canal (25, não 30)",
  consolidateChannelMetrics(["meta", "google"], {
    meta: { investment: 6000, resultCount: 300, cpa: 20 },
    google: { investment: 4000, resultCount: 100, cpa: 40 },
  }).cpa,
  25,
);

check(
  "revenue presente (mesmo null) em algum canal -> consolidado ganha a chave, soma o que existe",
  consolidateChannelMetrics(["meta", "google"], {
    meta: { investment: 1000, resultCount: 10, revenue: 5000, cpa: 100, roas: 5 },
    google: { investment: 500, resultCount: 5, revenue: null, cpa: 100, roas: null },
  }),
  { investment: 1500, resultCount: 15, revenue: 5000, cpa: 100, roas: 5000 / 1500 },
);

check(
  "canal sem dado nenhum não entra no byChannel resolvido, mas consolidado ainda soma os outros",
  consolidateChannelMetrics(["meta", "google", "tiktok"], {
    meta: { investment: 6000, resultCount: 300, cpa: 20 },
    google: { investment: 4000, resultCount: 100, cpa: 40 },
  } as Partial<Record<"meta" | "google" | "tiktok", ChannelMetrics>>),
  { investment: 10000, resultCount: 400, revenue: undefined, cpa: 25, roas: undefined },
);

console.log("\nresolveClientMonthlyActuals\n");

const sprints = [{ sprintId: "s1", start_date: "2026-08-01", end_date: "2026-08-07" }];

check(
  "cliente só-Meta (comportamento pré-existente): 1 canal no byChannel, consolidado igual ao canal único",
  resolveClientMonthlyActuals({
    sprints,
    dailySpendChannel: [{ date: "2026-08-03", channel: "meta", spend: 1000 }],
    channelSpendOverrides: [],
    performanceRecords: [
      { channel: "meta", resultType: "leads", resultCount: 100, source: "meta", sourceUpdatedAt: "2026-08-03T00:00:00Z" },
    ],
    performanceGoal: "leads",
  }),
  {
    byChannel: { meta: { investment: 1000, resultCount: 100, revenue: null, cpa: 10, roas: null } },
    consolidated: { investment: 1000, resultCount: 100, revenue: null, cpa: 10, roas: null },
  },
);

check(
  "Meta + Google: consolidado soma os dois, CPA consolidado é derivado dos totais",
  resolveClientMonthlyActuals({
    sprints,
    dailySpendChannel: [
      { date: "2026-08-03", channel: "meta", spend: 6000 },
      { date: "2026-08-03", channel: "google", spend: 4000 },
    ],
    channelSpendOverrides: [],
    performanceRecords: [
      { channel: "meta", resultType: "leads", resultCount: 300, source: "meta", sourceUpdatedAt: "2026-08-03T00:00:00Z" },
      { channel: "google", resultType: "leads", resultCount: 100, source: "google", sourceUpdatedAt: "2026-08-03T00:00:00Z" },
    ],
    performanceGoal: "leads",
  }).consolidated,
  { investment: 10000, resultCount: 400, revenue: null, cpa: 25, roas: null },
);

check(
  "canal com investimento mas sem nenhum registro de performance -> resultCount/cpa null (nunca 0 fabricado)",
  resolveClientMonthlyActuals({
    sprints,
    dailySpendChannel: [{ date: "2026-08-03", channel: "google", spend: 500 }],
    channelSpendOverrides: [],
    performanceRecords: [],
    performanceGoal: "leads",
  }).byChannel.google,
  { investment: 500, resultCount: null, revenue: null, cpa: null, roas: null },
);

console.log(`\n${passed} verificações passaram.`);
