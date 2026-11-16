/**
 * Testes da Etapa "Correção do filtro de campanha em períodos
 * personalizados" (bug reportado pelo usuário: Dashboard com período
 * "Ontem" + filtro de texto de campanha mostrava RESULTADO/CPL como "—",
 * com a mensagem "Filtro de campanha indisponível em períodos
 * personalizados — volte para 'Este mês' ou limpe o filtro.").
 *
 * Causa raiz: fora de "Este mês" (Hoje/Ontem/Últimos 7/30 dias/
 * Personalizado), o código bloqueava em bloco qualquer cálculo quando o
 * filtro de campanha estava ativo — mesmo `performanceReportData.
 * campaignDailyRows` já vindo buscado no intervalo CONSULTADO
 * (`queryFirstDay`/`queryLastDay`, nunca o mês inteiro), com granularidade
 * de campanha suficiente pra recalcular. A correção reaproveita a MESMA
 * função já usada por "Este mês" (`resolveFilteredExecutiveCardOverride`)
 * nos dois caminhos — nenhuma segunda fórmula.
 *
 * Seção A: comportamento real (behavioral), chamando a função de verdade
 * com linhas fabricadas — não só grep de string.
 * Seção B: wiring estrutural em cockpit-view-data.ts.
 *
 * Rodar: npx tsx scripts/test-koff-filtro-campanha-periodo-personalizado.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCockpitFilterState, resolveFilteredExecutiveCardOverride } from "../src/lib/cockpit-global-filter";
import type { CampaignDailyMetricRow } from "../src/lib/campaign-analytics";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function row(overrides: Partial<CampaignDailyMetricRow>): CampaignDailyMetricRow {
  return {
    date: "2026-11-15",
    channel: "meta",
    campaignName: "Campanha A",
    campaignId: "123",
    spend: 100,
    impressions: 1000,
    reach: 800,
    clicks: 20,
    linkClicks: 15,
    resultType: "leads",
    resultCount: 5,
    revenue: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — Comportamento real: 'Ontem' + filtro de campanha agora calcula de verdade (nunca mais bloqueio em bloco)\n");
{
  // Cenário exato do bug reportado: período "Ontem" (1 dia só), filtro de
  // texto "m.a" (bate em "Campanha m.a Teste", não bate em "Outra campanha").
  const filter = resolveCockpitFilterState("m.a", "contains");
  const rowsForYesterday: CampaignDailyMetricRow[] = [
    row({ date: "2026-11-15", campaignName: "Campanha m.a Teste", spend: 200, resultCount: 10 }),
    row({ date: "2026-11-15", campaignName: "Outra campanha qualquer", spend: 300, resultCount: 50 }),
    // Linha de outro dia (nunca deveria entrar — mas o fixture simula que
    // quem chama já filtrou pelo intervalo consultado antes de passar
    // aqui, exatamente como `performanceReportData.campaignDailyRows` já
    // vem filtrado por queryFirstDay/queryLastDay).
  ];

  const result = resolveFilteredExecutiveCardOverride(
    "leads",
    ["meta"],
    rowsForYesterday,
    filter,
    "Escopo filtrado por campanha — números do período selecionado, não do mês.",
  );

  ok("resultCount calculado de verdade (10, só a campanha que bate no filtro) — nunca '—'/0 fabricado", result.resultCount === 10);
  ok("costPerResult calculado de verdade (200/10 = 20) — nunca null por bloqueio", result.costPerResult === 20);
  ok("unavailableReason AUSENTE (o caso agora é calculável, não mais bloqueado)", result.unavailableReason === undefined);
  ok("filteredNotice usa o texto específico de período personalizado (nunca menciona 'meta do mês', que não existe fora do mês)", result.filteredNotice === "Escopo filtrado por campanha — números do período selecionado, não do mês.");
}

console.log("\nB — Grupo Meta+Google (sem granularidade de campanha unificada) continua indisponível — nunca um número fabricado pro lado sem dado\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  const result = resolveFilteredExecutiveCardOverride(
    "sales",
    ["meta", "google"],
    [row({ resultType: "sales" })],
    filter,
    "texto qualquer",
  );
  ok("resultCount null (grupo não filtrável por campanha)", result.resultCount === null);
  ok("costPerResult null", result.costPerResult === null);
  ok("unavailableReason presente (nunca '—' silencioso sem explicar por quê)", typeof result.unavailableReason === "string" && result.unavailableReason.length > 0);
  ok("filteredNotice AUSENTE quando indisponível (os dois nunca coexistem)", result.filteredNotice === undefined);
}

console.log("\nC — Sem nenhuma linha de campanha pro objetivo no intervalo consultado -> indisponível (nunca 0 fabricado disfarçado de 'sem resultado')\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  const result = resolveFilteredExecutiveCardOverride("sales", ["meta"], [row({ resultType: "leads" })], filter, "texto qualquer");
  ok("resultCount null (nenhuma linha é do objetivo 'sales')", result.resultCount === null);
  ok("unavailableReason presente", typeof result.unavailableReason === "string");
}

console.log("\nD — resolveFilteredExecutiveCardOverride mantém o texto PADRÃO quando chamado sem o 5º parâmetro (caminho 'Este mês' não muda)\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  const result = resolveFilteredExecutiveCardOverride("leads", ["meta"], [row({ campaignName: "Campanha m.a Teste" })], filter);
  ok("sem o parâmetro novo, continua o texto de sempre ('meta do mês') — nenhuma mudança de comportamento pro caminho já existente", result.filteredNotice === "Escopo filtrado — meta do mês não é comparável aqui.");
}

// ---------------------------------------------------------------------------
console.log("\nE — Wiring estrutural em cockpit-view-data.ts: caminho !isMonthAligned reaproveita a MESMA função, nunca uma segunda fórmula\n");
{
  const source = loadSource("src", "lib", "cockpit-view-data.ts");

  ok(
    "a antiga mensagem de bloqueio total foi removida por completo",
    !source.includes("Filtro de campanha indisponível em períodos personalizados"),
  );
  ok(
    "o caminho !isMonthAligned chama resolveFilteredExecutiveCardOverride (MESMA função do caminho 'Este mês', nunca uma cópia)",
    (source.match(/resolveFilteredExecutiveCardOverride\(/g) ?? []).length === 2,
  );
  ok(
    "usa performanceReportData.campaignDailyRows — já buscado no intervalo CONSULTADO (queryFirstDay/queryLastDay), nunca uma query nova",
    source.includes("performanceReportData.campaignDailyRows,\n          cockpitFilter,"),
  );
  ok(
    "passa um texto de aviso PRÓPRIO pro caso fora do mês (nunca o texto padrão, que fala de 'meta do mês' — algo que nunca existe fora do mês)",
    source.includes('"Escopo filtrado por campanha — números do período selecionado, não do mês."'),
  );
  ok(
    "o caminho SEM filtro ativo (cockpitFilter.isActive === false) continua intocado — soma direto de daily_performance/daily_spend, sem passar pela função de campanha",
    source.includes("sumDailyResultCountForRange(queryRangeDailyPerformanceRows, group.resultType, group.channels, queryFirstDay, queryLastDay)"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
