/**
 * Etapa 2 (Auditoria de Segurança aprovada → implementação dos 4 bugs +
 * AJUSTE 1 + AJUSTE 2 + centralização de Meta/Custo-Alvo). Cobre:
 *
 * - `resolveTargetCostPerResult` (lib/client-plan.ts) — função central:
 *   plano do canal → plano consolidado → fallback legado, nunca CPA
 *   realizado.
 * - Carry-forward do planejamento mensal.
 *
 * KOFF Analytics — Etapa 1.8: as seções que cobriam `computeFinancialSummary`/
 * `computeAgencyResultsByChannel` (lib/agency-metrics.ts, removido —
 * exclusivo do antigo dashboard consolidado da agência,
 * `LegacyGlobalDashboard`, também removido) saíram deste arquivo.
 * `resolveTargetCostPerResult`/`resolveClientMonthlyPlan` (lib/client-plan.ts)
 * continuam intocados e em uso real (Cockpit, `/clients`, `/painel-mensal`).
 *
 * Rodar: npx tsx scripts/test-etapa2-financial-target-separation.ts
 */
import assert from "node:assert/strict";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "../src/lib/client-plan";
import type { ChannelMetrics } from "../src/lib/channel-metrics";

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

function channelMetrics(overrides: Partial<ChannelMetrics>): ChannelMetrics {
  return { investment: null, resultCount: null, cpa: null, ...overrides };
}

// ---------------------------------------------------------------------------
console.log("\n1 — resolveTargetCostPerResult: ordem de prioridade — plano do canal → consolidado → fallback legado\n");
{
  const plan = {
    byChannel: { meta: channelMetrics({ investment: 1000, resultCount: 20, cpa: 50 }) },
    consolidated: channelMetrics({ investment: 1500, resultCount: 25, cpa: 60 }),
  };

  check("canal com plano PRÓPRIO usa o CPA daquele canal (50), nunca o consolidado (60)", resolveTargetCostPerResult({ channel: "meta", plan, legacyFallback: 999 }), 50);
  check("canal SEM plano próprio (google) cai pro consolidado (60), nunca pro fallback direto", resolveTargetCostPerResult({ channel: "google", plan, legacyFallback: 999 }), 60);
  check("'consolidated' usa sempre o consolidado (60)", resolveTargetCostPerResult({ channel: "consolidated", plan, legacyFallback: 999 }), 60);
}

console.log("\n2 — resolveTargetCostPerResult: fallback legado só quando NADA tem plano\n");
{
  const semPlanoNenhum = { byChannel: {}, consolidated: channelMetrics({}) };
  check("sem plano em canal nenhum e sem consolidado: usa o fallback legado", resolveTargetCostPerResult({ channel: "consolidated", plan: semPlanoNenhum, legacyFallback: 123.45 }), 123.45);
  check("mesmo escopado a um canal específico, cai pro fallback legado (via consolidado)", resolveTargetCostPerResult({ channel: "meta", plan: semPlanoNenhum, legacyFallback: 123.45 }), 123.45);
  check("sem plano nenhum e sem fallback: null (nunca 0 fabricado)", resolveTargetCostPerResult({ channel: "consolidated", plan: semPlanoNenhum, legacyFallback: null }), null);
}

console.log("\n3 — resolveTargetCostPerResult: NUNCA usa CPA realizado como meta (Bug 4)\n");
{
  // Simula o cenário exato do Bug 4 original: um card de REALIZADO (CPA de
  // R$ 12,00, muito abaixo da meta configurada de R$ 40,00) sendo passado
  // por engano no lugar do plano. A função não sabe distinguir os dois
  // pelo tipo (ambos são `ChannelMetrics`) — o contrato é do CHAMADOR, mas
  // este teste prova que, quando o chamador passa o resolvedor CERTO
  // (planejado), o resultado nunca é contaminado pelo realizado.
  const realizado = channelMetrics({ investment: 600, resultCount: 50, cpa: 12 }); // CPA REALIZADO
  const planejado = { byChannel: {}, consolidated: channelMetrics({ investment: 2000, resultCount: 50, cpa: 40 }) }; // CPA PLANEJADO

  const targetCorreto = resolveTargetCostPerResult({ channel: "consolidated", plan: planejado, legacyFallback: null });
  ok("Meta resolvida (40) é diferente do CPA realizado (12) do mesmo período", targetCorreto !== realizado.cpa);
  check("Meta resolvida vem do PLANO, nunca do realizado", targetCorreto, 40);
}

// ---------------------------------------------------------------------------
console.log("\n4 — Carry-forward: plano definido em mês anterior continua vigente no mês atual (Bug 1, regressão)\n");
{
  const changes: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-06-01", changedAt: "2026-06-05T10:00:00Z", investment: 5000, targetResultCount: 100 },
  ];
  // Consumidor busca com `.lte` (histórico completo até o mês selecionado)
  // — nenhum filtro `month = selectedMonth` aqui, exatamente a regra que
  // todo consumidor real (`page.tsx`/`sprints/page.tsx`/etc.) já aplica.
  const planSetembro = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-09-01" });
  check("canal Meta continua com o plano de junho vigente em setembro (carry-forward)", planSetembro.byChannel.meta, channelMetrics({ investment: 5000, resultCount: 100, cpa: 50 }));
  check("consolidado reflete o carry-forward (5000, nunca 'sem plano')", planSetembro.consolidated.investment, 5000);

  const target = resolveTargetCostPerResult({ channel: "consolidated", plan: planSetembro, legacyFallback: 999 });
  check("meta de custo também respeita o carry-forward (50, nunca o fallback legado 999)", target, 50);
}

console.log("\n5 — Carry-forward: um mês SEM nenhuma mudança de plano usa a versão mais recente anterior, nunca a mais antiga\n");
{
  const changes: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-05-01", changedAt: "2026-05-01T00:00:00Z", investment: 1000, targetResultCount: null },
    { channel: "meta", month: "2026-07-01", changedAt: "2026-07-01T00:00:00Z", investment: 3000, targetResultCount: null },
  ];
  const plan = resolveClientMonthlyPlan({ channels: ["meta"], changes, selectedMonth: "2026-08-01" });
  check("agosto usa a versão de julho (3000), nunca a de maio (1000)", plan.byChannel.meta?.investment, 3000);
}

console.log(`\nTodos os ${passed} testes passaram.`);
