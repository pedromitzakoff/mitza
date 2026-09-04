/**
 * Etapa "Resultado Diário" — nova seção do Relatório de Performance entre
 * Resumo Executivo e Campanhas. Cobre as 3 camadas envolvidas:
 *
 *  1. `buildClientAnalyticsDailyRows` (`app/clients/analytics-data.ts`) —
 *     núcleo puro extraído de `fetchClientAnalyticsData`: resolve, por data,
 *     a distinção entre "zero confirmado" (dia com sinal de sincronização —
 *     linha de `daily_spend` — mas sem linha de resultado) e "sem dado"
 *     (nenhum sinal), MESMA regra já usada por `lib/daily-results.ts`
 *     (`buildDailyResultSeries`, Visão Geral) — nunca uma segunda definição.
 *  2. `buildDailyRows` (`lib/performance-report/report-data.ts`, Camada 1) —
 *     preenche TODOS os dias civis do período (`listDatesInclusive`, mesma
 *     função de sempre) e recalcula custo por resultado/ROAS por dia via os
 *     helpers canônicos (`computeCostPerResult`/`computeRoas`).
 *  3. `buildPerformanceReportDocument` (Camada 2) — monta a tabela
 *     "Resultado Diário" (`disclosure: false`, `totalRow`, `rowNote` pra
 *     dias sem nenhum sinal) e garante que a MESMA série alimenta a página
 *     nativa e o HTML usado pra gerar o PDF.
 *
 * Reconciliação (seção 11 do pedido): Σ dos dias aqui precisa bater com o
 * que o Resumo Executivo mostraria pras MESMAS linhas de origem —
 * `aggregatePerformanceResults` é a função que o Resumo Executivo usa por
 * baixo (via `resolvePerformanceSummaryForGoal`); os testes de reconciliação
 * comparam diretamente contra ela, nunca contra um número copiado à mão.
 *
 * Rodar: npx tsx scripts/test-performance-report-daily.ts
 */
import assert from "node:assert/strict";
import { buildClientAnalyticsDailyRows, type ClientAnalyticsDailyRow } from "../src/app/clients/analytics-data";
import { buildDailyRows } from "../src/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "../src/lib/performance-report/report-document";
import type { PerformanceReportData } from "../src/lib/performance-report/report-data";
import { renderPerformanceReportHtml } from "../src/lib/performance-report/renderers/html-renderer";
import { buildCampaignSummaries } from "../src/lib/campaign-analytics";
import { aggregatePerformanceResults, type PerformanceRecordRow } from "../src/lib/performance";
import { resolveAnalyticsPeriod } from "../src/lib/analytics";
import { formatCurrency, formatShortDate } from "../src/lib/format";

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

function mapOf(entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
console.log("1 — buildClientAnalyticsDailyRows: zero confirmado vs. sem dado (nunca fabricado)\n");

{
  // 01/09: spend real + resultado real. 02/09: spend real, SEM linha de
  // resultado (sincronizado, zero confirmado). 03/09: NENHUM sinal (fora
  // dos dois mapas) — não deve nem aparecer aqui (esparso).
  const dailySpendByDate = mapOf([
    ["2026-09-01", 100],
    ["2026-09-02", 50],
  ]);
  const dailyResultByDate = mapOf([["2026-09-01", 5]]);
  const dailyRevenueByDate = mapOf([["2026-09-01", 500]]);

  const rows = buildClientAnalyticsDailyRows(dailySpendByDate, dailyResultByDate, dailyRevenueByDate);
  check("só 2 datas com algum sinal (esparso — 03/09 nem aparece)", rows.map((r) => r.date), ["2026-09-01", "2026-09-02"]);

  const day1 = rows.find((r) => r.date === "2026-09-01")!;
  check("01/09: spend real", day1.spend, 100);
  check("01/09: resultCount real", day1.resultCount, 5);
  check("01/09: revenue real", day1.revenue, 500);

  const day2 = rows.find((r) => r.date === "2026-09-02")!;
  check("02/09: spend real (sinal de sincronização)", day2.spend, 50);
  check("02/09: resultCount = 0 CONFIRMADO (sincronizado, sem linha de resultado — nunca 'sem dado')", day2.resultCount, 0);
  check("02/09: revenue null (nunca inferido a partir do resultCount confirmado)", day2.revenue, null);
}

{
  // Sem integração ativa / sem objetivo: dailyResultByDate é null inteiro —
  // resultCount tem que ficar null pra TODO dia, mesmo com spend presente
  // (nunca inventa granularidade diária de resultado que não existe).
  const rows = buildClientAnalyticsDailyRows(mapOf([["2026-09-01", 100]]), null, null);
  check("sem integração ativa: resultCount sempre null, mesmo com spend presente", rows[0].resultCount, null);
}

// ---------------------------------------------------------------------------
console.log("\n2 — buildDailyRows: uma linha por DIA CIVIL do período, ordem cronológica, dias sem dado\n");

{
  // Cenário do pedido: 01/09 → 03/09, só o dia 1 com dado.
  const sparse: ClientAnalyticsDailyRow[] = [{ date: "2026-09-01", spend: 500, resultCount: 10, revenue: null }];
  const rows = buildDailyRows({ start: "2026-09-01", end: "2026-09-03" }, sparse);

  check("3 linhas — uma por dia do intervalo, mesmo sem dado nos dias 2 e 3 (nunca termina cedo)", rows.length, 3);
  check("ordem cronológica: mais antigo primeiro, mais recente por último", rows.map((r) => r.date), ["2026-09-01", "2026-09-02", "2026-09-03"]);

  check("dia 1: spend/resultado reais", [rows[0].spend, rows[0].resultCount], [500, 10]);
  check("dia 2 (sem sinal nenhum): spend null, nunca 0 fabricado", rows[1].spend, null);
  check("dia 2: resultCount null, nunca 0 fabricado", rows[1].resultCount, null);
  check("dia 3 (sem sinal nenhum): spend null", rows[2].spend, null);
}

// ---------------------------------------------------------------------------
console.log("\n3 — buildDailyRows: métricas derivadas recalculadas por dia (nunca herdadas/copiadas)\n");

{
  const sparse: ClientAnalyticsDailyRow[] = [{ date: "2026-09-01", spend: 200, resultCount: 10, revenue: 1000 }];
  const rows = buildDailyRows({ start: "2026-09-01", end: "2026-09-01" }, sparse);
  check("custo por resultado do dia = spend do dia / resultado do dia (200/10)", rows[0].costPerResult, 20);
  check("ROAS do dia = receita do dia / spend do dia (1000/200)", rows[0].roas, 5);
}

{
  // Dia com resultCount=0 CONFIRMADO: custo por resultado precisa ser null
  // (divisão por zero resultados não é um número), nunca 0/Infinity.
  const sparse: ClientAnalyticsDailyRow[] = [{ date: "2026-09-01", spend: 100, resultCount: 0, revenue: null }];
  const rows = buildDailyRows({ start: "2026-09-01", end: "2026-09-01" }, sparse);
  check("custo por resultado é null quando resultCount do dia é 0 (nunca 0/Infinity fabricado)", rows[0].costPerResult, null);
}

// ---------------------------------------------------------------------------
console.log("\n4 — Períodos: Hoje, Últimos 7 dias, Últimos 30 dias, mês atual, personalizado (resolveAnalyticsPeriod, sem nova semântica)\n");

{
  const today = resolveAnalyticsPeriod("today", "2026-09-15");
  check("Hoje → exatamente 1 dia", buildDailyRows(today, []).length, 1);

  const last7 = resolveAnalyticsPeriod("last_7_days", "2026-09-15");
  check("Últimos 7 dias → exatamente 7 linhas", buildDailyRows(last7, []).length, 7);

  const last30 = resolveAnalyticsPeriod("last_30_days", "2026-09-15");
  check("Últimos 30 dias → exatamente 30 linhas", buildDailyRows(last30, []).length, 30);

  const thisMonth = resolveAnalyticsPeriod("this_month", "2026-09-15");
  check("Mês atual (setembro/2026, 30 dias) → 30 linhas", buildDailyRows(thisMonth, []).length, 30);

  const custom = resolveAnalyticsPeriod("custom", "2026-09-15", { start: "2026-08-15", end: "2026-08-27" });
  const customRows = buildDailyRows(custom, []);
  check("Personalizado 15/08 → 27/08: exatamente 13 dias", customRows.length, 13);
  check("Personalizado: primeiro dia é 15/08", customRows[0].date, "2026-08-15");
  check("Personalizado: último dia é 27/08", customRows[customRows.length - 1].date, "2026-08-27");
}

// ---------------------------------------------------------------------------
console.log("\n5 — Reconciliação com o Resumo Executivo: Σ dos dias bate com aggregatePerformanceResults\n");

{
  // Mesmas linhas de origem que alimentariam tanto o Resumo Executivo
  // (via aggregatePerformanceResults, o núcleo de resolvePerformanceSummaryForGoal)
  // quanto o Resultado Diário — só reagrupadas por data em vez de somadas
  // direto num total só.
  const dailySpendByDate = mapOf([
    ["2026-09-01", 300],
    ["2026-09-02", 150],
    ["2026-09-03", 50],
  ]);
  const dailyResultByDate = mapOf([
    ["2026-09-01", 8],
    ["2026-09-02", 3],
    ["2026-09-03", 0],
  ]);
  const dailyRevenueByDate = mapOf([
    ["2026-09-01", 1600],
    ["2026-09-02", 600],
  ]);

  const dailyRows = buildClientAnalyticsDailyRows(dailySpendByDate, dailyResultByDate, dailyRevenueByDate);
  const reportRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-03" }, dailyRows);

  // "Resumo Executivo" simulado com o mesmo núcleo que ele usa por baixo.
  const records: PerformanceRecordRow[] = [
    { channel: "meta", resultType: "sales", resultCount: 8, revenue: 1600, source: "meta", sourceUpdatedAt: "2026-09-01" },
    { channel: "meta", resultType: "sales", resultCount: 3, revenue: 600, source: "meta", sourceUpdatedAt: "2026-09-02" },
    { channel: "meta", resultType: "sales", resultCount: 0, revenue: null, source: "meta", sourceUpdatedAt: "2026-09-03" },
  ];
  const aggregated = aggregatePerformanceResults(records, "sales", "meta");
  const actualSpendResumo = [...dailySpendByDate.values()].reduce((sum, v) => sum + v, 0);

  const totalSpendDiario = reportRows.reduce((sum, r) => sum + (r.spend ?? 0), 0);
  const totalResultCountDiario = reportRows.reduce((sum, r) => sum + (r.resultCount ?? 0), 0);
  const totalRevenueDiario = reportRows.reduce((sum, r) => sum + (r.revenue ?? 0), 0);

  check("Σ investimento diário = investimento do Resumo Executivo", totalSpendDiario, actualSpendResumo);
  check("Σ resultados diários = resultado do Resumo Executivo (aggregatePerformanceResults)", totalResultCountDiario, aggregated.resultCount);
  check("Σ receita diária = receita do Resumo Executivo (aggregatePerformanceResults)", totalRevenueDiario, aggregated.revenue);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Total: aditivas somadas, derivadas recalculadas do total (nunca média dos dias)\n");

{
  const sparse: ClientAnalyticsDailyRow[] = [
    { date: "2026-09-01", spend: 100, resultCount: 5, revenue: 500 },
    { date: "2026-09-02", spend: 200, resultCount: 5, revenue: 1000 },
  ];
  const dailyRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-02" }, sparse);

  const data: PerformanceReportData = {
    client: { id: "client-1", name: "Cliente Teste" },
    period: { start: "2026-09-01", end: "2026-09-02", label: "01 set 2026 → 02 set 2026" },
    summary: { status: "ok", kpis: [] },
    performanceGoal: "sales",
    dailyRows,
    campaigns: [],
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-03T00:00:00.000Z",
  };
  const document = buildPerformanceReportDocument(data);
  const table = document.tables.find((t) => t.id === "resultado-diario")!;

  ok("Total existe", table.totalRow !== null);
  const total = table.totalRow!;
  check("Total: investimento somado (100+200)", total.metrics[0].display, formatCurrency(300));
  check("Total: resultado somado (5+5)", total.metrics[1].display, "10");
  // CPA por dia seria 20 e 40 (média = 30) — o total NUNCA é a média,
  // sempre total÷total: 300/10 = 30 (nesse caso específico coincide com a
  // média simples só porque os dois dias têm o mesmo resultCount; o que
  // importa é a FÓRMULA usada, testada explicitamente abaixo com valores
  // que divergiriam se fosse média).
  check("Total: custo por resultado = investimento total / resultado total (300/10)", total.metrics[2].display, formatCurrency(30));
  check("Total: receita somada (500+1000)", total.metrics[3].display, formatCurrency(1500));
  check("Total: ROAS = receita total / investimento total (1500/300)", total.metrics[4].display, "5.00x");
}

{
  // Caso que REALMENTE distinguiria "total correto" de "média das linhas":
  // dia 1 caro (CPA 100), dia 2 barato (CPA 10) — média simples seria 55;
  // total÷total é bem diferente.
  const sparse: ClientAnalyticsDailyRow[] = [
    { date: "2026-09-01", spend: 100, resultCount: 1, revenue: null },
    { date: "2026-09-02", spend: 100, resultCount: 10, revenue: null },
  ];
  const dailyRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-02" }, sparse);
  const data: PerformanceReportData = {
    client: { id: "client-2", name: "Cliente Teste 2" },
    period: { start: "2026-09-01", end: "2026-09-02", label: "" },
    summary: { status: "ok", kpis: [] },
    performanceGoal: "leads",
    dailyRows,
    campaigns: [],
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-03T00:00:00.000Z",
  };
  const table = buildPerformanceReportDocument(data).tables.find((t) => t.id === "resultado-diario")!;
  // Total: 200 investido / 11 resultados = 18,18 — NUNCA a média simples
  // dos CPAs diários (100 e 10 → média 55).
  const totalCpa = table.totalRow!.metrics[2].sortValue!;
  ok("CPA do Total é total÷total (~18.18), nunca a média simples dos CPAs diários (55)", Math.abs(totalCpa - 200 / 11) < 0.001);
}

// ---------------------------------------------------------------------------
console.log("\n7 — Dia sem NENHUM sinal ganha 'Sem dados'; dia parcial nunca ganha essa nota\n");

{
  const sparse: ClientAnalyticsDailyRow[] = [{ date: "2026-09-01", spend: 500, resultCount: null, revenue: null }];
  const dailyRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-03" }, sparse);
  const data: PerformanceReportData = {
    client: { id: "client-3", name: "Cliente Teste 3" },
    period: { start: "2026-09-01", end: "2026-09-03", label: "" },
    summary: { status: "no_goal" },
    performanceGoal: null,
    dailyRows,
    campaigns: [],
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-04T00:00:00.000Z",
  };
  const table = buildPerformanceReportDocument(data).tables.find((t) => t.id === "resultado-diario")!;

  const day1 = table.rows.find((r) => r.id === "2026-09-01")!;
  const day2 = table.rows.find((r) => r.id === "2026-09-02")!;
  ok("dia 1 (só investimento, sem sinal de resultado): NUNCA 'Sem dados' — tem dado real parcial", !day1.rowNote);
  check("dia 1: investimento aparece normalmente", day1.metrics[0].display, formatCurrency(500));
  ok("dia 2 (nenhum sinal nos dois lados): rowNote = 'Sem dados'", day2.rowNote === "Sem dados");
}

// ---------------------------------------------------------------------------
console.log("\n8 — 'Resultado' respeita o objetivo do cliente (nunca uma segunda definição)\n");

{
  const dailyRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-01" }, [{ date: "2026-09-01", spend: 100, resultCount: 4, revenue: null }]);
  const baseData: Omit<PerformanceReportData, "performanceGoal"> = {
    client: { id: "client-4", name: "Cliente Teste 4" },
    period: { start: "2026-09-01", end: "2026-09-01", label: "" },
    summary: { status: "ok", kpis: [] },
    dailyRows,
    campaigns: [],
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-02T00:00:00.000Z",
  };

  const leadsTable = buildPerformanceReportDocument({ ...baseData, performanceGoal: "leads" }).tables.find((t) => t.id === "resultado-diario")!;
  ok("objetivo leads: coluna de resultado fala 'Leads'", leadsTable.metricColumns[1].header.toLowerCase().includes("lead"));

  const salesTable = buildPerformanceReportDocument({ ...baseData, performanceGoal: "sales" }).tables.find((t) => t.id === "resultado-diario")!;
  ok("objetivo sales: coluna de resultado NUNCA fala 'Leads'", !salesTable.metricColumns[1].header.toLowerCase().includes("lead"));

  const noGoalTable = buildPerformanceReportDocument({ ...baseData, performanceGoal: null }).tables.find((t) => t.id === "resultado-diario")!;
  check("sem objetivo: rótulo genérico 'Resultado'", noGoalTable.metricColumns[1].header, "Resultado");
}

// ---------------------------------------------------------------------------
console.log("\n9 — Receita/ROAS só aparecem quando aplicáveis (preserva a lógica atual, nunca inventa)\n");

{
  const dailyRowsNoRevenue = buildDailyRows({ start: "2026-09-01", end: "2026-09-01" }, [{ date: "2026-09-01", spend: 100, resultCount: 4, revenue: null }]);
  const data: PerformanceReportData = {
    client: { id: "client-5", name: "Cliente Teste 5" },
    period: { start: "2026-09-01", end: "2026-09-01", label: "" },
    summary: { status: "ok", kpis: [] },
    performanceGoal: "leads",
    dailyRows: dailyRowsNoRevenue,
    campaigns: [],
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-02T00:00:00.000Z",
  };
  const table = buildPerformanceReportDocument(data).tables.find((t) => t.id === "resultado-diario")!;
  check("Leads sem receita: só 3 colunas (Data implícita + Investimento/Resultado/Custo)", table.metricColumns.length, 3);
  ok("nenhuma coluna Receita/ROAS fabricada", !table.metricColumns.some((c) => c.key === "revenue" || c.key === "roas"));
}

// ---------------------------------------------------------------------------
console.log("\n10 — Integração: posição/estrutura da seção, sem progressive disclosure, mesma série pra página e PDF\n");

{
  const dailyRows = buildDailyRows({ start: "2026-09-01", end: "2026-09-01" }, [{ date: "2026-09-01", spend: 777, resultCount: 3, revenue: null }]);
  const data: PerformanceReportData = {
    client: { id: "client-6", name: "Cliente Teste 6" },
    period: { start: "2026-09-01", end: "2026-09-01", label: "01 set 2026 → 01 set 2026" },
    summary: { status: "ok", kpis: [{ key: "investment", label: "Investimento", value: formatCurrency(777) }] },
    performanceGoal: "leads",
    dailyRows,
    campaigns: buildCampaignSummaries([]),
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-02T00:00:00.000Z",
  };
  const document = buildPerformanceReportDocument(data);

  check("ordem: Resultado Diário → Campanhas → Públicos → Criativos", document.tables.map((t) => t.id), ["resultado-diario", "campanhas", "publicos", "criativos"]);

  const dailyTable = document.tables.find((t) => t.id === "resultado-diario")!;
  ok("Resultado Diário: disclosure desligada (todos os dias sempre visíveis)", dailyTable.disclosure === false);
  ok("Campanhas: disclosure continua ligada (comportamento de sempre, não mudou)", document.tables.find((t) => t.id === "campanhas")!.disclosure === true);
  check("nome da linha do dia já vem formatado (mesma formatação de data do resto do relatório)", dailyTable.rows[0].name, formatShortDate("2026-09-01"));

  // "página nativa recebe consolidação" / "PDF recebe exatamente a mesma
  // série": ambos leem o MESMO `document` — a página nativa itera
  // `document.tables` diretamente, o PDF é gerado renderizando este MESMO
  // documento em HTML.
  const html = renderPerformanceReportHtml(document);
  ok("HTML (usado pro PDF) contém a seção Resultado Diário", html.includes("Resultado diário"));
  ok("HTML contém o mesmo investimento do dia que a página nativa mostraria", html.includes(formatCurrency(777)));
  ok("HTML contém a linha de Total (mesma classe usada pro Total)", html.includes('class="total-row"'));
}

// ---------------------------------------------------------------------------
console.log("\n11 — Campanhas: nenhuma mudança de comportamento nesta etapa (regressão)\n");

{
  const campaigns = buildCampaignSummaries([
    { date: "2026-09-01", channel: "meta", campaignName: "Campanha A", spend: 100, impressions: null, reach: null, clicks: null, resultType: "leads", resultCount: 5, revenue: null },
  ]);
  const data: PerformanceReportData = {
    client: { id: "client-7", name: "Cliente Teste 7" },
    period: { start: "2026-09-01", end: "2026-09-01", label: "" },
    summary: { status: "ok", kpis: [] },
    performanceGoal: "leads",
    dailyRows: [],
    campaigns,
    adSets: [],
    creatives: [],
    generatedAt: "2026-09-02T00:00:00.000Z",
  };
  const campaignsTable = buildPerformanceReportDocument(data).tables.find((t) => t.id === "campanhas")!;
  check("Campanhas: 1 linha, exatamente como antes desta etapa", campaignsTable.rows.length, 1);
  check("Campanhas: continua sem Total (fora do escopo desta etapa)", campaignsTable.totalRow, null);
  ok("Campanhas: nenhuma linha ganhou rowNote (Campanhas nunca tem 'sem dados' — só existe se teve linha real)", !campaignsTable.rows.some((r) => r.rowNote));
}

console.log(`\nTodos os ${passed} testes passaram.`);
