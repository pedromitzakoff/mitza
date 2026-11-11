/**
 * Testes do núcleo puro de resolução das métricas exibidas (Fase B — ponto
 * 4 do pedido: 3 estados nunca confundidos — disponível com zero real,
 * indisponível por lacuna de configuração, erro de integração).
 *
 * Rodar: npx tsx scripts/test-koff-dashboard-metrics-resolver.ts
 */
import assert from "node:assert/strict";
import { resolveDashboardMetricViews, resolveOneMetricView, type ResolveMetricViewsInput } from "../src/lib/dashboard-metrics-resolver";
import type { MetricView } from "../src/lib/dashboard-metrics";
import type { MetaAdsReachSnapshot } from "../src/lib/meta-ads-dashboard/dashboard-data";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function view(key: Parameters<typeof resolveOneMetricView>[0], overrides: Partial<ResolveMetricViewsInput>): MetricView {
  const base: ResolveMetricViewsInput = {
    keys: [],
    hasMetaSyncError: false,
    hasMetaAccount: true,
    goalsWithActiveMapping: new Set(),
    goals: new Map(),
    delivery: { spend: 0, impressions: 0, clicks: 0, ctr: null, cpc: null, cpm: null },
    reach: { status: "unavailable", reason: "not_configured" },
    isGlobalFilterActive: false,
    ...overrides,
  };
  return resolveOneMetricView(key, base);
}

// ---------------------------------------------------------------------------
console.log("\nA — Resultado: disponível (zero incluso), sem conta, sem evento, erro de sincronização\n");
{
  const v1 = view("leads", { goals: new Map([["leads", { resultCount: 0, costPerResult: null, costUnavailableReason: "no_result" }]]) });
  ok("resultado ZERO é 'available' com value 0 — nunca 'unavailable'", v1.status === "available" && v1.value === 0);

  const v2 = view("leads", { goals: new Map([["leads", { resultCount: 42, costPerResult: 10, costUnavailableReason: "available" }]]) });
  ok("resultado real vira 'available' com o valor certo", v2.status === "available" && v2.value === 42);

  const v3 = view("sales", { hasMetaAccount: false, goals: new Map() });
  ok("sem conta Meta e sem goal -> 'unavailable: sem_conta_meta'", v3.status === "unavailable" && v3.reason === "sem_conta_meta");

  const v4 = view("sales", { hasMetaAccount: true, goals: new Map(), goalsWithActiveMapping: new Set() });
  ok("tem conta Meta mas sem evento mapeado -> 'unavailable: sem_evento_configurado'", v4.status === "unavailable" && v4.reason === "sem_evento_configurado");

  const v5 = view("leads", { hasMetaSyncError: true, goals: new Map([["leads", { resultCount: 5, costPerResult: 1, costUnavailableReason: "available" }]]) });
  ok("erro de sincronização SEMPRE vence (mesmo com dado presente) -> 'error'", v5.status === "error" && v5.reason === "falha_sincronizacao");
}

// ---------------------------------------------------------------------------
console.log("\nB — Eficiência: disponível, sem base pra calcular, sem investimento classificado\n");
{
  const v1 = view("cpl", { goals: new Map([["leads", { resultCount: 10, costPerResult: 25, costUnavailableReason: "available" }]]) });
  ok("CPL disponível reaproveita resolveGoalCostPerResult sem recalcular", v1.status === "available" && v1.value === 25);

  const v2 = view("cpl", { goals: new Map([["leads", { resultCount: 0, costPerResult: null, costUnavailableReason: "no_result" }]]) });
  ok("sem resultado -> 'sem_base_para_calculo' (nunca R$0,00 fabricado)", v2.status === "unavailable" && v2.reason === "sem_base_para_calculo");

  const v3 = view("cpa", {
    goals: new Map([["sales", { resultCount: 3, costPerResult: null, costUnavailableReason: "incomplete_coverage" }]]),
  });
  ok("cobertura incompleta -> 'sem_investimento_classificado'", v3.status === "unavailable" && v3.reason === "sem_investimento_classificado");

  const v4 = view("roas", { goals: new Map(), hasMetaAccount: true, goalsWithActiveMapping: new Set() });
  ok("sem goal nenhum -> 'sem_evento_configurado' (mesmo motivo do Resultado correspondente)", v4.status === "unavailable" && v4.reason === "sem_evento_configurado");
}

// ---------------------------------------------------------------------------
console.log("\nC — Entrega: totais aditivos, razões sem base, Alcance com fonte própria\n");
{
  const delivery = { spend: 1000, impressions: 50000, clicks: 300, ctr: 0.006, cpc: 3.33, cpm: 20 };
  ok("Investimento disponível direto dos totais", view("spend", { delivery }).status === "available");
  ok("CTR disponível quando há base", (view("ctr", { delivery }) as { status: "available"; value: number }).value === 0.006);

  const zeroBaseDelivery = { spend: 0, impressions: 0, clicks: 0, ctr: null, cpc: null, cpm: null };
  const v1 = view("ctr", { delivery: zeroBaseDelivery });
  ok("CTR sem impressões -> 'sem_base_para_calculo' (nunca 0 fabricado)", v1.status === "unavailable" && v1.reason === "sem_base_para_calculo");

  const v2 = view("spend", { delivery: null, hasMetaAccount: false });
  ok("sem conta Meta -> Entrega inteira 'sem_conta_meta'", v2.status === "unavailable" && v2.reason === "sem_conta_meta");

  const reachOk: MetaAdsReachSnapshot = { status: "ok", impressions: 50000, reach: 12000, frequency: 4.1 };
  ok("Alcance disponível vem da fonte própria, nunca somado de campanha", (view("reach", { reach: reachOk }) as { status: "available"; value: number }).value === 12000);

  const reachNotConfigured: MetaAdsReachSnapshot = { status: "unavailable", reason: "not_configured" };
  const v3 = view("reach", { reach: reachNotConfigured });
  ok("Alcance sem conta configurada -> 'unavailable: sem_conta_meta' (config, não falha)", v3.status === "unavailable" && v3.reason === "sem_conta_meta");

  const reachTimeout: MetaAdsReachSnapshot = { status: "unavailable", reason: "timeout" };
  const v4 = view("reach", { reach: reachTimeout });
  ok("Alcance com timeout da Graph API -> 'error: api_indisponivel' (falha, não config)", v4.status === "error" && v4.reason === "api_indisponivel");

  const v5 = view("reach", { reach: reachOk, hasMetaSyncError: true });
  ok("erro de sincronização vence até pro Alcance (fonte independente, mas sinal global)", v5.status === "error" && v5.reason === "falha_sincronizacao");

  const v6 = view("reach", { reach: reachOk, isGlobalFilterActive: true });
  ok(
    "filtro global ativo -> Alcance 'unavailable' (nunca o valor da conta inteira disfarçado de filtrado)",
    v6.status === "unavailable" && v6.reason === "sem_base_para_calculo",
  );
  ok(
    "filtro global ativo NÃO afeta Investimento/Impressões/Cliques (já vêm recalculados do escopo filtrado)",
    view("spend", { delivery, isGlobalFilterActive: true }).status === "available",
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — resolveDashboardMetricViews: ordem preservada, um Map por chave\n");
{
  const input: ResolveMetricViewsInput = {
    keys: ["leads", "cpl", "spend"],
    hasMetaSyncError: false,
    hasMetaAccount: true,
    goalsWithActiveMapping: new Set(["leads"]),
    goals: new Map([["leads", { resultCount: 7, costPerResult: 14, costUnavailableReason: "available" }]]),
    delivery: { spend: 500, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 25, cpm: 500 },
    reach: { status: "unavailable", reason: "not_configured" },
    isGlobalFilterActive: false,
  };
  const result = resolveDashboardMetricViews(input);
  ok("3 chaves resolvidas, nenhuma extra", result.size === 3);
  ok("ordem das chaves do Map segue a ordem de entrada", Array.from(result.keys()).join(",") === "leads,cpl,spend");
  ok("leads disponível com 7", (result.get("leads") as { status: "available"; value: number }).value === 7);
}

console.log(`\n${passed} verificações OK.\n`);
