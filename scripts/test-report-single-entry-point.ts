/**
 * Etapa "Relatório Único" — testes puros da tela mínima de período
 * (`/clients/[id]/relatorio`) e dos novos presets "Hoje"/"Ontem" de
 * `resolveAnalyticsPeriod`. Cobre os cenários pedidos: seleção de preset,
 * período personalizado, data inicial/final chegando corretamente ao
 * Relatório de Performance, período de 7 dias, período mensal — sempre
 * reaproveitando `resolveAnalyticsPeriod` (`lib/analytics.ts`), nunca uma
 * segunda semântica de data. Não testa a rota `route.ts` em si (convenção do
 * repositório: só funções puras nestes scripts) nem o HTML/PDF do Relatório
 * de Performance em si (já coberto por `test-performance-report.ts`).
 *
 * Rodar: npx tsx scripts/test-report-single-entry-point.ts
 */
import assert from "node:assert/strict";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, resolveAnalyticsPeriod } from "../src/lib/analytics";
import { buildClientPerformanceReportHref, isValidCustomRange } from "../src/app/clients/[id]/relatorio/report-period-href";

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
console.log("1 — resolveAnalyticsPeriod: novos presets Hoje/Ontem\n");

check("Hoje: start = end = hoje", resolveAnalyticsPeriod("today", "2026-09-15"), { start: "2026-09-15", end: "2026-09-15" });
check("Ontem: um dia antes de hoje", resolveAnalyticsPeriod("yesterday", "2026-09-15"), { start: "2026-09-14", end: "2026-09-14" });
check(
  "Ontem cruzando virada de mês (hoje = dia 1) nunca gera data inválida",
  resolveAnalyticsPeriod("yesterday", "2026-09-01"),
  { start: "2026-08-31", end: "2026-08-31" },
);
check(
  "Ontem cruzando virada de ano nunca gera data inválida",
  resolveAnalyticsPeriod("yesterday", "2026-01-01"),
  { start: "2025-12-31", end: "2025-12-31" },
);

// ---------------------------------------------------------------------------
console.log("\n2 — ANALYTICS_PERIOD_PRESET_OPTIONS: presets exigidos, na ordem pedida\n");

check(
  "ordem exata: Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, Mês atual, Mês anterior",
  ANALYTICS_PERIOD_PRESET_OPTIONS.map((o) => o.value),
  ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"],
);
ok(
  "nunca inclui 'custom' na lista de presets (tratado à parte, como período personalizado) — garantido pelo próprio tipo Exclude<AnalyticsPeriodPreset, 'custom'>",
  ANALYTICS_PERIOD_PRESET_OPTIONS.every((o) => o.value !== ("custom" as string)),
);

// ---------------------------------------------------------------------------
console.log("\n3 — buildClientPerformanceReportHref: sempre a rota existente, nunca uma nova\n");

for (const preset of ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"] as const) {
  const href = buildClientPerformanceReportHref("client-1", preset);
  ok(`preset "${preset}": aponta pra /api/clients/[id]/performance-report`, href.startsWith("/api/clients/client-1/performance-report?"));
  ok(`preset "${preset}": carrega o preset na querystring`, href.includes(`analyticsPreset=${preset}`));
  ok(`preset "${preset}": nunca inclui analyticsStart/analyticsEnd (a semântica já está no preset)`, !href.includes("analyticsStart") && !href.includes("analyticsEnd"));
}

// ---------------------------------------------------------------------------
console.log("\n4 — buildClientPerformanceReportHref: período personalizado (data inicial/final)\n");

const customHref = buildClientPerformanceReportHref("client-2", "custom", { start: "2026-03-05", end: "2026-03-20" });
ok("usa analyticsPreset=custom", customHref.includes("analyticsPreset=custom"));
ok("data inicial chega intacta", customHref.includes("analyticsStart=2026-03-05"));
ok("data final chega intacta", customHref.includes("analyticsEnd=2026-03-20"));

// Round-trip: o que a tela manda é exatamente o que resolveAnalyticsPeriod
// devolve de volta — nunca um recálculo divergente no meio do caminho.
const customUrl = new URL(`https://mitza.test${customHref}`);
const roundTrip = resolveAnalyticsPeriod(customUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-03-25", {
  start: customUrl.searchParams.get("analyticsStart") ?? undefined,
  end: customUrl.searchParams.get("analyticsEnd") ?? undefined,
});
check("round-trip do período personalizado: mesma data inicial/final que o usuário escolheu", roundTrip, { start: "2026-03-05", end: "2026-03-20" });

// ---------------------------------------------------------------------------
console.log("\n5 — buildClientPerformanceReportHref: período de 7 dias chega corretamente\n");

const last7Href = buildClientPerformanceReportHref("client-3", "last_7_days");
const last7Url = new URL(`https://mitza.test${last7Href}`);
const last7Period = resolveAnalyticsPeriod(last7Url.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("últimos 7 dias terminando hoje, 7 dias corridos", last7Period, { start: "2026-09-09", end: "2026-09-15" });

// ---------------------------------------------------------------------------
console.log("\n6 — buildClientPerformanceReportHref: período mensal chega corretamente\n");

const thisMonthHref = buildClientPerformanceReportHref("client-4", "this_month");
const thisMonthUrl = new URL(`https://mitza.test${thisMonthHref}`);
const thisMonthPeriod = resolveAnalyticsPeriod(thisMonthUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("mês atual: 1º ao último dia de setembro/2026", thisMonthPeriod, { start: "2026-09-01", end: "2026-09-30" });

const lastMonthHref = buildClientPerformanceReportHref("client-5", "last_month");
const lastMonthUrl = new URL(`https://mitza.test${lastMonthHref}`);
const lastMonthPeriod = resolveAnalyticsPeriod(lastMonthUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("mês anterior: 1º ao último dia de agosto/2026", lastMonthPeriod, { start: "2026-08-01", end: "2026-08-31" });

// ---------------------------------------------------------------------------
console.log("\n7 — isValidCustomRange: mesma regra de validade que resolveAnalyticsPeriod\n");

ok("início igual ao fim (1 dia só) é válido", isValidCustomRange("2026-09-10", "2026-09-10"));
ok("fim depois do início é válido", isValidCustomRange("2026-09-01", "2026-09-10"));
ok("fim antes do início é inválido (nunca habilita 'Gerar relatório')", !isValidCustomRange("2026-09-10", "2026-09-01"));
ok("data inicial vazia é inválida", !isValidCustomRange("", "2026-09-10"));
ok("data final vazia é inválida", !isValidCustomRange("2026-09-01", ""));

console.log(`\nTodos os ${passed} testes passaram.`);
