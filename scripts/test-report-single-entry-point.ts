/**
 * Etapa "Relatório Nativo" — testes puros do controle de período embutido na
 * página nativa do Relatório de Performance (`/clients/[id]/relatorio`) e
 * dos presets "Hoje"/"Ontem" de `resolveAnalyticsPeriod` (Etapa "Relatório
 * Único"). Cobre os cenários pedidos: "Cliente → Relatório" abre com padrão
 * mês atual, seleção de preset, período personalizado, data inicial/final
 * chegando corretamente, período de 7 dias, período mensal, URL refletindo
 * o período (pra refresh/back/forward), e o href de "Baixar PDF" apontando
 * pro mesmo período em exibição — sempre reaproveitando
 * `resolveAnalyticsPeriod` (`lib/analytics.ts`), nunca uma segunda
 * semântica de data. Não testa o Server Component da página em si nem o
 * Route Handler (convenção do repositório: só funções puras nestes
 * scripts) nem o HTML/PDF do Relatório de Performance em si (já coberto por
 * `test-performance-report.ts`).
 *
 * Rodar: npx tsx scripts/test-report-single-entry-point.ts
 */
import assert from "node:assert/strict";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, resolveAnalyticsPeriod } from "../src/lib/analytics";
import { buildReportPeriodHref, buildReportPdfHref, isValidCustomRange } from "../src/app/clients/[id]/relatorio/report-period-nav";

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
console.log("1 — resolveAnalyticsPeriod: padrão (Cliente → Relatório sem nenhum parâmetro) = mês atual\n");

check(
  "sem preset nenhum (URL bare '/clients/[id]/relatorio') cai no mês corrente inteiro",
  resolveAnalyticsPeriod(undefined, "2026-09-15"),
  { start: "2026-09-01", end: "2026-09-30" },
);

// ---------------------------------------------------------------------------
console.log("\n2 — resolveAnalyticsPeriod: presets Hoje/Ontem\n");

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
console.log("\n3 — ANALYTICS_PERIOD_PRESET_OPTIONS: presets exigidos, na ordem pedida\n");

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
console.log("\n4 — buildReportPeriodHref: troca de período navega dentro da MESMA página nativa, URL reflete o período\n");

for (const preset of ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"] as const) {
  const href = buildReportPeriodHref("/clients/client-1/relatorio", preset);
  ok(`preset "${preset}": aponta pra página nativa (/clients/[id]/relatorio), nunca pro endpoint de PDF`, href.startsWith("/clients/client-1/relatorio?"));
  ok(`preset "${preset}": carrega o preset na querystring (refresh/back/forward reproduzem o mesmo período)`, href.includes(`analyticsPreset=${preset}`));
  ok(`preset "${preset}": nunca inclui analyticsStart/analyticsEnd (a semântica já está no preset)`, !href.includes("analyticsStart") && !href.includes("analyticsEnd"));
}

// ---------------------------------------------------------------------------
console.log("\n5 — buildReportPeriodHref: período personalizado (data inicial/final)\n");

const customHref = buildReportPeriodHref("/clients/client-2/relatorio", "custom", { start: "2026-03-05", end: "2026-03-20" });
ok("usa analyticsPreset=custom", customHref.includes("analyticsPreset=custom"));
ok("data inicial chega intacta", customHref.includes("analyticsStart=2026-03-05"));
ok("data final chega intacta", customHref.includes("analyticsEnd=2026-03-20"));

// Round-trip: o que o controle de período manda na URL é exatamente o que
// resolveAnalyticsPeriod devolve de volta — nunca um recálculo divergente
// no meio do caminho.
const customUrl = new URL(`https://mitza.test${customHref}`);
const roundTrip = resolveAnalyticsPeriod(customUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-03-25", {
  start: customUrl.searchParams.get("analyticsStart") ?? undefined,
  end: customUrl.searchParams.get("analyticsEnd") ?? undefined,
});
check("round-trip do período personalizado: mesma data inicial/final que o usuário escolheu", roundTrip, { start: "2026-03-05", end: "2026-03-20" });

// ---------------------------------------------------------------------------
console.log("\n6 — buildReportPeriodHref: período de 7 dias chega corretamente\n");

const last7Href = buildReportPeriodHref("/clients/client-3/relatorio", "last_7_days");
const last7Url = new URL(`https://mitza.test${last7Href}`);
const last7Period = resolveAnalyticsPeriod(last7Url.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("últimos 7 dias terminando hoje, 7 dias corridos", last7Period, { start: "2026-09-09", end: "2026-09-15" });

// ---------------------------------------------------------------------------
console.log("\n7 — buildReportPeriodHref: período mensal chega corretamente\n");

const thisMonthHref = buildReportPeriodHref("/clients/client-4/relatorio", "this_month");
const thisMonthUrl = new URL(`https://mitza.test${thisMonthHref}`);
const thisMonthPeriod = resolveAnalyticsPeriod(thisMonthUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("mês atual: 1º ao último dia de setembro/2026", thisMonthPeriod, { start: "2026-09-01", end: "2026-09-30" });

const lastMonthHref = buildReportPeriodHref("/clients/client-5/relatorio", "last_month");
const lastMonthUrl = new URL(`https://mitza.test${lastMonthHref}`);
const lastMonthPeriod = resolveAnalyticsPeriod(lastMonthUrl.searchParams.get("analyticsPreset") ?? undefined, "2026-09-15");
check("mês anterior: 1º ao último dia de agosto/2026", lastMonthPeriod, { start: "2026-08-01", end: "2026-08-31" });

// ---------------------------------------------------------------------------
console.log("\n8 — buildReportPdfHref: 'Baixar PDF' sempre no mesmo período em exibição, sempre a rota de PDF existente\n");

for (const preset of ["today", "last_7_days", "this_month", "last_month"] as const) {
  const pdfHref = buildReportPdfHref("client-6", preset);
  ok(`preset "${preset}": PDF aponta pro endpoint existente (/api/clients/[id]/performance-report), nunca a página nativa`, pdfHref.startsWith("/api/clients/client-6/performance-report?"));
  ok(`preset "${preset}": PDF carrega o MESMO preset que a página nativa mostraria`, pdfHref.includes(`analyticsPreset=${preset}`));
}

const pdfCustomHref = buildReportPdfHref("client-7", "custom", { start: "2026-05-01", end: "2026-05-31" });
ok("PDF de período personalizado inclui a mesma data inicial", pdfCustomHref.includes("analyticsStart=2026-05-01"));
ok("PDF de período personalizado inclui a mesma data final", pdfCustomHref.includes("analyticsEnd=2026-05-31"));

// ---------------------------------------------------------------------------
console.log("\n9 — isValidCustomRange: mesma regra de validade que resolveAnalyticsPeriod\n");

ok("início igual ao fim (1 dia só) é válido", isValidCustomRange("2026-09-10", "2026-09-10"));
ok("fim depois do início é válido", isValidCustomRange("2026-09-01", "2026-09-10"));
ok("fim antes do início é inválido (nunca navega/gera PDF com período invertido)", !isValidCustomRange("2026-09-10", "2026-09-01"));
ok("data inicial vazia é inválida", !isValidCustomRange("", "2026-09-10"));
ok("data final vazia é inválida", !isValidCustomRange("2026-09-01", ""));

console.log(`\nTodos os ${passed} testes passaram.`);
