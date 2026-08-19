/**
 * Testes da Comparabilidade de Escopo de Custo (Etapa "Comparabilidade de
 * Escopo de Custo") — `resolveChannelScopeComparison`/
 * `resolveCostScopeComparability` (lib/channel-metrics.ts), e a resolução
 * de meta POR CANAL que o Dashboard passa a usar (`resolveClientMonthlyPlan`,
 * lib/client-plan.ts) quando um canal específico está selecionado.
 *
 * Cobre os 8 cenários pedidos (A-H): quando o conjunto de canais do
 * planejamento bate/diverge do conjunto de canais do realizado, e o caso
 * especial do fallback global legítimo (nenhum canal com plano) — que
 * NUNCA deve ser tratado como escopo divergente.
 *
 * Rodar: npx tsx scripts/test-channel-scope-comparison.ts
 */
import assert from "node:assert/strict";
import {
  resolveChannelScopeComparison,
  resolveCostScopeComparability,
  type ChannelMetrics,
} from "../src/lib/channel-metrics";
import { resolveClientMonthlyPlan } from "../src/lib/client-plan";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const NO_PLAN: ChannelMetrics = { investment: null, resultCount: null, cpa: null };
function planned(investment: number, resultCount: number): ChannelMetrics {
  return { investment, resultCount, cpa: investment / resultCount };
}
function realized(investment: number, resultCount: number | null): ChannelMetrics {
  return { investment, resultCount, cpa: resultCount ? investment / resultCount : null };
}

console.log("Caso A — só Meta tem plano e realizado; Google não existe em nenhum dos dois lados\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: NO_PLAN };
  const actualByChannel = { meta: realized(9000, 480) };
  const result = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check("Caso A — plannedChannels só Meta (Google nunca teve plano)", result.plannedChannels, ["meta"]);
  check("Caso A — actualChannels só Meta (Google nunca gerou dado)", result.actualChannels, ["meta"]);
  check("Caso A — escopos batem -> comparação válida", result.scopesMatch, true);
}

console.log("\nCaso B — Meta + Google com plano e realizado completos\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: planned(5000, 100) };
  const actualByChannel = { meta: realized(10200, 510), google: realized(5100, 95) };
  const result = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check("Caso B — plannedChannels os dois canais", result.plannedChannels, ["google", "meta"]);
  check("Caso B — actualChannels os dois canais", result.actualChannels, ["google", "meta"]);
  check("Caso B — mesmo universo dos dois lados -> comparação consolidada válida", result.scopesMatch, true);
}

console.log("\nCaso C — Meta tem plano; Meta + Google têm realizado\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: NO_PLAN };
  const actualByChannel = { meta: realized(9000, 480), google: realized(3000, 60) };
  const result = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check("Caso C — plannedChannels só Meta", result.plannedChannels, ["meta"]);
  check("Caso C — actualChannels Meta + Google (Google gerou dado sem plano)", result.actualChannels, ["google", "meta"]);
  check("Caso C — realizado tem canal a mais que o plano -> escopos divergem", result.scopesMatch, false);
}

console.log("\nCaso D — Meta + Google têm plano; só Meta tem realizado\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: planned(5000, 100) };
  const actualByChannel = { meta: realized(9500, 490) };
  const result = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check("Caso D — plannedChannels os dois canais", result.plannedChannels, ["google", "meta"]);
  check("Caso D — actualChannels só Meta (Google não gerou dado este mês)", result.actualChannels, ["meta"]);
  check("Caso D — plano tem canal a mais que o realizado -> escopos divergem", result.scopesMatch, false);
}

console.log("\nCaso E — Meta tem plano; Google sem plano tem gasto real e ZERO resultados\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: NO_PLAN };
  // Google: investimento real (500), mas nenhum resultado -> resultCount null,
  // cpa null (nunca fabricado) — ainda assim CONTA como canal presente no
  // realizado, porque o gasto é real e distorce o numerador consolidado.
  const actualByChannel = { meta: realized(9000, 480), google: { investment: 500, resultCount: null, cpa: null } as ChannelMetrics };
  const result = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check("Caso E — Google entra em actualChannels só por ter investimento, mesmo com 0 resultado", result.actualChannels, ["google", "meta"]);
  check("Caso E — escopos divergem -> nunca deixa o gasto de Google virar 'CPA acima da meta de Meta'", result.scopesMatch, false);
}

console.log("\nCaso H — sem planejamento por canal, usando fallback global legítimo (clients.target_cost_per_result)\n");
{
  const plannedByChannel = { meta: NO_PLAN, google: NO_PLAN };
  const actualByChannel = { meta: realized(9000, 480), google: realized(3000, 60) };

  const rawComparison = resolveChannelScopeComparison(plannedByChannel, actualByChannel);
  check(
    "Caso H — comparação BRUTA dos dois conjuntos diverge (plano vazio vs. realizado com dado) — isolado, pareceria inválido",
    rawComparison.scopesMatch,
    false,
  );

  check(
    "Caso H — mas a meta NUNCA veio de canal nenhum (consolidatedTargetCameFromChannelPlan=false) -> sempre comparável, fallback preservado",
    resolveCostScopeComparability(false, plannedByChannel, actualByChannel),
    true,
  );
}

console.log("\nSanidade do fallback: quando a meta VEIO de canal, a regra completa não perdoa mais divergência real\n");
{
  const plannedByChannel = { meta: planned(10000, 500), google: NO_PLAN };
  const actualByChannelSameScope = { meta: realized(9000, 480) };
  const actualByChannelDivergent = { meta: realized(9000, 480), google: realized(3000, 60) };

  check(
    "meta veio de canal (true) + escopos batem -> comparável",
    resolveCostScopeComparability(true, plannedByChannel, actualByChannelSameScope),
    true,
  );
  check(
    "meta veio de canal (true) + escopos divergem -> NÃO comparável (fallback não se aplica aqui)",
    resolveCostScopeComparability(true, plannedByChannel, actualByChannelDivergent),
    false,
  );
}

console.log("\nCaso F/G — Dashboard filtrado por canal usa a meta DAQUELE canal, nunca a consolidada\n");
{
  // Exemplo conceitual da auditoria: Meta planejado R$10.000/500 (meta
  // R$20); Google planejado R$5.000/100 (meta R$50) — metas bem diferentes
  // de propósito, pra provar que o consolidado (média ponderada) nunca é
  // usado quando um canal específico está selecionado.
  const changes = [
    { channel: "meta" as const, month: "2026-01-01", changedAt: "2026-01-01T00:00:00Z", investment: 10000, targetResultCount: 500 },
    { channel: "google" as const, month: "2026-01-01", changedAt: "2026-01-01T00:00:00Z", investment: 5000, targetResultCount: 100 },
  ];
  const clientPlan = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-01-01" });

  check("Caso F — Dashboard filtrado em Meta -> meta usada é a de Meta (R$20)", clientPlan.byChannel.meta?.cpa, 20);
  check("Caso G — Dashboard filtrado em Google -> meta usada é a de Google (R$50)", clientPlan.byChannel.google?.cpa, 50);
  check(
    "consolidado é a média PONDERADA pelos volumes (R$25, nunca a média simples R$35) — nunca usado quando um canal está selecionado",
    clientPlan.consolidated.cpa,
    25,
  );
}

{
  // Canal sem meta própria ainda -> byChannel[canal].cpa null, quem chama
  // (Dashboard) cai pro consolidado só nesse caso (mesmo padrão já usado
  // pela página do Cliente) — não testado aqui em código de página (fora do
  // escopo de teste de unidade), só a peça que o Dashboard consome.
  const changes = [
    { channel: "meta" as const, month: "2026-01-01", changedAt: "2026-01-01T00:00:00Z", investment: 10000, targetResultCount: 500 },
  ];
  const clientPlan = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-01-01" });
  check("Google sem meta própria -> byChannel.google.cpa null (Dashboard cairia pro fallback consolidado)", clientPlan.byChannel.google?.cpa, null);
}

console.log(`\n${passed} verificações passaram.`);
