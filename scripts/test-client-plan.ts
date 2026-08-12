/**
 * Testes puros do resolvedor de Planejamento por canal (Etapa "Planejamento
 * por Canal") — `resolveClientPlan` (lib/client-plan.ts). Cobre a mesma
 * garantia central da arquitetura multicanal: CPA planejado nunca é lido de
 * uma coluna, sempre derivado; canal sem plano ainda entra com tudo null
 * (nunca omitido); consolidado é sempre a soma dos canais com plano.
 *
 * Rodar: npx tsx scripts/test-client-plan.ts
 */
import assert from "node:assert/strict";
import { resolveClientPlan, type ClientPlanChangeRow } from "../src/lib/client-plan";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("resolveClientPlan\n");

check(
  "canal sem nenhuma versão elegível ainda -> entra no byChannel com tudo null (nunca omitido)",
  resolveClientPlan({ channels: ["meta", "google"], changes: [], selectedMonth: "2026-08-01" }),
  {
    byChannel: {
      meta: { investment: null, resultCount: null, cpa: null },
      google: { investment: null, resultCount: null, cpa: null },
    },
    consolidated: { investment: null, resultCount: null, revenue: undefined, cpa: null, roas: undefined },
  },
);

const changes: ClientPlanChangeRow[] = [
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 6000, targetResultCount: 300 },
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-15T10:00:00Z", investment: 8000, targetResultCount: 400 },
  { channel: "google", month: "2026-08-01", changedAt: "2026-08-05T10:00:00Z", investment: 2000, targetResultCount: 100 },
];

check(
  "pega a versão mais recente por canal (Meta: 15/08 vence 01/08), CPA sempre derivado (nunca de uma coluna)",
  resolveClientPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-08-01" }),
  {
    byChannel: {
      meta: { investment: 8000, resultCount: 400, cpa: 20 },
      google: { investment: 2000, resultCount: 100, cpa: 20 },
    },
    consolidated: { investment: 10000, resultCount: 500, revenue: undefined, cpa: 20, roas: undefined },
  },
);

check(
  "mês anterior ao selecionado -> versão vigente é a do mês anterior mais recente (arrasta pra frente)",
  resolveClientPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-07-01", changedAt: "2026-07-10T10:00:00Z", investment: 5000, targetResultCount: 250 }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: 5000, resultCount: 250, cpa: 20 },
);

check(
  "mês futuro (month > selectedMonth) nunca vaza pro mês selecionado",
  resolveClientPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-09-01", changedAt: "2026-08-01T10:00:00Z", investment: 9999, targetResultCount: 999 }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: null, resultCount: null, cpa: null },
);

check(
  "sem meta de resultado definida (targetResultCount null) -> CPA null, nunca dividido por null",
  resolveClientPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: null }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: 5000, resultCount: null, cpa: null },
);

check(
  "só Meta tem plano (cliente Meta-only, retrocompatibilidade) -> consolidado igual ao canal único",
  resolveClientPlan({
    channels: ["meta", "google"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 4000, targetResultCount: 200 }],
    selectedMonth: "2026-08-01",
  }).consolidated,
  { investment: 4000, resultCount: 200, revenue: undefined, cpa: 20, roas: undefined },
);

console.log(`\n${passed} verificações passaram.`);
