/**
 * Testes puros do Gerador de Relatório de Performance — Camada 2 (documento)
 * e Camada 4 (HTML). Cobre os cenários explicitamente pedidos: <=10 registros
 * mostra todos, >10 mostra 10 + "ver todos"; criativo com/sem thumbnail;
 * criativo com/sem permalink (e coluna Prévia omitida quando NENHUM
 * criativo do período tem link); HTML contém os números corretos (mesmos
 * valores dos summaries, nunca recalculados); zero != ausência de dado.
 *
 * Rodar: npx tsx scripts/test-performance-report.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatPercent } from "../src/lib/format";
import { buildPerformanceReportDocument, type PerformanceReportTable } from "../src/lib/performance-report/report-document";
import { renderPerformanceReportHtml } from "../src/lib/performance-report/renderers/html-renderer";
import type { PerformanceReportData } from "../src/lib/performance-report/report-data";
import { recomputeDailyRows, recomputeFilteredSummary, type FilterableDailyRow } from "../src/lib/performance-report/report-filter-recompute";
import type { CampaignSummary } from "../src/lib/campaign-analytics";
import type { AdSetSummary } from "../src/lib/ad-set-analytics";
import type { CreativeSummary } from "../src/lib/creative-analytics";
import type { PerformanceSummary } from "../src/lib/performance";
import { computeConversionRate } from "../src/lib/performance";

// Etapa "Otimização do Performance Report": `PerformanceReportSummary`
// (status "ok") passou a exigir o `PerformanceSummary` canônico também —
// fixture neutro (sem meta, sem resultado), nunca influencia as asserções
// deste arquivo (sorting/disclosure/thumbnail/permalink/zero-vs-ausência).
const NEUTRAL_PERFORMANCE_SUMMARY: PerformanceSummary = {
  scope: "consolidated",
  resultType: "leads",
  resultCount: 0,
  hasAnyRecord: false,
  actualSpend: null,
  costPerResult: null,
  costUnavailableReason: "no_performance_data",
  targetCostPerResult: null,
  comparison: { variation: null, status: "not_available" },
  revenue: null,
  roas: null,
  averageTicket: null,
  latestSource: null,
  latestUpdatedAt: null,
};

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

function campaign(name: string, spend: number, overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    campaignName: name,
    channel: "meta",
    totalSpend: spend,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: "sales",
    totalResultCount: 10,
    totalRevenue: null,
    cpa: spend / 10,
    cpc: null,
    ctr: null,
    roas: null,
    ...overrides,
  };
}

function adSet(name: string, spend: number, overrides: Partial<AdSetSummary> = {}): AdSetSummary {
  return {
    adSetName: name,
    channel: "meta",
    campaignNames: ["C"],
    totalSpend: spend,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: "sales",
    totalResultCount: 5,
    totalRevenue: null,
    cpa: spend / 5,
    cpc: null,
    ctr: null,
    roas: null,
    ...overrides,
  };
}

function creative(name: string, spend: number, overrides: Partial<CreativeSummary> = {}): CreativeSummary {
  return {
    creativeName: name,
    permalinkUrl: null,
    previewImageUrl: null,
    campaignNames: ["C"],
    totalSpend: spend,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: "sales",
    totalResultCount: 3,
    totalRevenue: null,
    cpa: spend / 3,
    cpc: null,
    ctr: null,
    roas: null,
    ...overrides,
  };
}

function fakeData(overrides: Partial<PerformanceReportData> = {}): PerformanceReportData {
  return {
    client: { id: "client-1", name: "Cliente Teste" },
    period: { start: "2026-08-01", end: "2026-08-31", label: "01/08 – 31/08" },
    summary: { status: "ok", kpis: [{ key: "investment", label: "Investimento", value: "R$ 1.000,00" }], performanceSummary: NEUTRAL_PERFORMANCE_SUMMARY },
    performanceGoal: "sales",
    dailyRows: [],
    campaigns: [],
    adSets: [],
    creatives: [],
    campaignDailyRows: [],
    adSetDailyRows: [],
    creativeDailyRows: [],
    conversionRate: null,
    placements: [],
    generatedAt: "2026-09-01T12:00:00.000Z",
    view: "principal",
    hasSecondaryCampaigns: false,
    unclassifiedCampaignNames: [],
    secondarySummary: null,
    campaignPurposeByName: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("1 — Até 10 registros: todos aparecem, sem botão de expandir\n");

const tenCampaigns = Array.from({ length: 10 }, (_, i) => campaign(`Campanha ${i + 1}`, 100 - i));
const docTen = buildPerformanceReportDocument(fakeData({ campaigns: tenCampaigns }));
const htmlTen = renderPerformanceReportHtml(docTen);
check("10 campanhas na tabela do documento", docTen.tables.find((t) => t.id === "campanhas")!.rows.length, 10);
const campaignsSectionTen = htmlTen.match(/id="campanhas"[\s\S]*?<\/section>/)![0];
ok("sem botão 'ver todos' na seção quando são exatamente 10 linhas", !campaignsSectionTen.includes('class="disclosure-toggle"'));
ok("nenhuma linha com row-collapsed quando <=10", !campaignsSectionTen.includes("row-collapsed"));

// ---------------------------------------------------------------------------
console.log("\n2 — Mais de 10 registros: 10 visíveis + botão 'ver todas as N'\n");

const fifteenCampaigns = Array.from({ length: 15 }, (_, i) => campaign(`Campanha ${i + 1}`, 200 - i));
const docFifteen = buildPerformanceReportDocument(fakeData({ campaigns: fifteenCampaigns }));
const htmlFifteen = renderPerformanceReportHtml(docFifteen);
check("15 campanhas continuam TODAS no documento (disclosure é só apresentação)", docFifteen.tables.find((t) => t.id === "campanhas")!.rows.length, 15);
ok("botão de expandir aparece com o total correto (15)", htmlFifteen.includes('data-total="15"'));
const campaignsTableHtml = htmlFifteen.match(/id="table-campanhas"[\s\S]*?<\/table>/)![0];
const collapsedCount = (campaignsTableHtml.match(/row-collapsed/g) ?? []).length;
check("exatamente 5 linhas marcadas como colapsadas (15 - 10 visíveis)", collapsedCount, 5);
const campaignsTbodyHtml = campaignsTableHtml.match(/<tbody>[\s\S]*?<\/tbody>/)![0];
const allRowsInDom = (campaignsTbodyHtml.match(/<tr/g) ?? []).length;
check("as 15 linhas continuam TODAS no DOM (nunca removidas — impressão/PDF sempre completos)", allRowsInDom, 15);

// ---------------------------------------------------------------------------
console.log("\n3 — Default de ordenação: maior investimento primeiro (já vem do summary, nunca reordenado aqui)\n");

const unsorted = [campaign("Baixo", 10), campaign("Alto", 500), campaign("Médio", 100)];
// buildCampaignSummaries já ordena por spend desc — simulando aqui só a
// garantia de que o documento preserva a ordem recebida, nunca reordena.
const preOrdered = [...unsorted].sort((a, b) => b.totalSpend - a.totalSpend);
const docOrder = buildPerformanceReportDocument(fakeData({ campaigns: preOrdered }));
check("ordem preservada: Alto, Médio, Baixo", docOrder.tables.find((t) => t.id === "campanhas")!.rows.map((r) => r.name), ["Alto", "Médio", "Baixo"]);

// ---------------------------------------------------------------------------
console.log("\n4 — Criativo com thumbnail vs sem thumbnail\n");

const creativesThumb = [
  creative("Com imagem", 100, { previewImageUrl: "https://cdn.example.com/img.jpg" }),
  creative("Sem imagem", 50, { previewImageUrl: null }),
];
const docThumb = buildPerformanceReportDocument(fakeData({ creatives: creativesThumb }));
const htmlThumb = renderPerformanceReportHtml(docThumb);
ok("criativo COM preview gera <img class=\"thumb\">", htmlThumb.includes('<img class="thumb" src="https://cdn.example.com/img.jpg"'));
const criativosSection = htmlThumb.match(/id="criativos"[\s\S]*?<\/section>/)![0];
const imgCount = (criativosSection.match(/<img class="thumb"/g) ?? []).length;
check("só 1 <img> gerada (o criativo sem preview não fabrica nenhuma)", imgCount, 1);

// ---------------------------------------------------------------------------
console.log("\n5 — Permalink: coluna Prévia só existe se ALGUM criativo tiver link; célula é '—' pros que não têm\n");

const creativesNoLink = [creative("A", 100), creative("B", 50)];
const docNoLink = buildPerformanceReportDocument(fakeData({ creatives: creativesNoLink }));
const tableNoLink = docNoLink.tables.find((t) => t.id === "criativos")!;
check("hasPreviewColumn=false quando NENHUM criativo tem permalink", tableNoLink.hasPreviewColumn, false);
const htmlNoLink = renderPerformanceReportHtml(docNoLink);
ok("coluna 'Prévia' não aparece no HTML quando nenhum criativo tem link", !htmlNoLink.match(/id="criativos"[\s\S]*?<\/section>/)![0].includes(">Prévia<"));

const creativesMixedLink = [
  creative("Com link", 100, { permalinkUrl: "https://instagram.com/p/abc" }),
  creative("Sem link", 50, { permalinkUrl: null }),
];
const docMixedLink = buildPerformanceReportDocument(fakeData({ creatives: creativesMixedLink }));
const tableMixedLink = docMixedLink.tables.find((t) => t.id === "criativos")!;
check("hasPreviewColumn=true quando AO MENOS UM criativo tem permalink", tableMixedLink.hasPreviewColumn, true);
const htmlMixedLink = renderPerformanceReportHtml(docMixedLink);
const criativosMixedSection = htmlMixedLink.match(/id="criativos"[\s\S]*?<\/section>/)![0];
ok("coluna 'Prévia' aparece quando ao menos um tem link", criativosMixedSection.includes(">Prévia<"));
ok("linha COM link mostra 'Ver criativo ↗'", criativosMixedSection.includes("https://instagram.com/p/abc") && criativosMixedSection.includes("Ver criativo"));
ok("linha SEM link mostra '—' na célula de Prévia, nunca um link inventado", /preview muted">—<\/td>/.test(criativosMixedSection));

// ---------------------------------------------------------------------------
console.log("\n6 — HTML contém os números corretos (mesmos dos summaries, nunca recalculados)\n");

const numericCampaigns = [campaign("Campanha Números", 4830.68, { totalResultCount: 186, cpa: 25.97, totalRevenue: 60821.51, roas: 12.59 })];
const docNumbers = buildPerformanceReportDocument(fakeData({ campaigns: numericCampaigns }));
const htmlNumbers = renderPerformanceReportHtml(docNumbers);
ok("investimento formatado aparece intacto", htmlNumbers.includes("R$ 4.830,68") || htmlNumbers.includes("4.830,68"));
ok("resultado (186) aparece intacto", htmlNumbers.includes(">186<"));
ok("CPA formatado aparece intacto", htmlNumbers.includes("25,97"));
ok("receita formatada aparece intacto", htmlNumbers.includes("60.821,51"));
ok("ROAS formatado aparece intacto (12.59x)", htmlNumbers.includes("12,59x") || htmlNumbers.includes("12.59x"));

// ---------------------------------------------------------------------------
console.log("\n7 — Zero é diferente de ausência de dado na renderização\n");

const zeroVsNull = [
  campaign("Zero de verdade", 100, { totalResultCount: 0, cpa: null }),
  campaign("Sem mapeamento", 50, { totalResultCount: null, cpa: null }),
];
const docZero = buildPerformanceReportDocument(fakeData({ campaigns: zeroVsNull }));
const rowZero = docZero.tables.find((t) => t.id === "campanhas")!.rows.find((r) => r.name === "Zero de verdade")!;
const rowNull = docZero.tables.find((t) => t.id === "campanhas")!.rows.find((r) => r.name === "Sem mapeamento")!;
check("resultado 0 exibe '0' (não '—')", rowZero.metrics[1].display, "0");
check("resultado ausente exibe '—' (nunca '0' fabricado)", rowNull.metrics[1].display, "—");
check("sortValue de 0 é 0 (número real, ordena entre os outros)", rowZero.metrics[1].sortValue, 0);
check("sortValue ausente é null (sempre ordena por último)", rowNull.metrics[1].sortValue, null);

// ---------------------------------------------------------------------------
console.log("\n8 — Rótulo de resultado/custo: objetivo único vs. objetivos mistos\n");

const singleGoal = [campaign("A", 100, { resultType: "leads" }), campaign("B", 50, { resultType: "leads" })];
const docSingleGoal = buildPerformanceReportDocument(fakeData({ campaigns: singleGoal }));
const tableSingleGoal = docSingleGoal.tables.find((t) => t.id === "campanhas")! as PerformanceReportTable;
check("objetivo único (leads): coluna usa rótulo específico", tableSingleGoal.metricColumns[1].header, "Leads");
check("objetivo único (leads): custo usa CPL", tableSingleGoal.metricColumns[2].header, "CPL");

const mixedGoals = [campaign("A", 100, { resultType: "leads" }), campaign("B", 50, { resultType: "sales" })];
const docMixedGoals = buildPerformanceReportDocument(fakeData({ campaigns: mixedGoals }));
const tableMixedGoals = docMixedGoals.tables.find((t) => t.id === "campanhas")!;
check("objetivos mistos: cai pro rótulo genérico 'Resultado'", tableMixedGoals.metricColumns[1].header, "Resultado");
check("objetivos mistos: custo genérico", tableMixedGoals.metricColumns[2].header, "Custo por resultado");

// ---------------------------------------------------------------------------
console.log("\n9 — Público (Ad Set): mesma lógica visual/ordenação de Campanhas\n");

const fifteenAdSets = Array.from({ length: 12 }, (_, i) => adSet(`Público ${i + 1}`, 100 - i));
const docAdSets = buildPerformanceReportDocument(fakeData({ adSets: fifteenAdSets }));
const htmlAdSets = renderPerformanceReportHtml(docAdSets);
check("12 públicos continuam todos no documento", docAdSets.tables.find((t) => t.id === "publicos")!.rows.length, 12);
ok("botão de expandir aparece pra Públicos também (>10)", htmlAdSets.includes('data-table="table-publicos"'));

// ---------------------------------------------------------------------------
console.log("\n10 — Estados sem objetivo / sem dado no Resumo Executivo\n");

const docNoGoal = buildPerformanceReportDocument(fakeData({ summary: { status: "no_goal" } }));
check("no_goal produz status no_goal no bloco de resumo", docNoGoal.summary.status, "no_goal");
const htmlNoGoal = renderPerformanceReportHtml(docNoGoal);
ok("mensagem de sem objetivo aparece no HTML, nenhum KPI fabricado", htmlNoGoal.includes("objetivo de performance") && !htmlNoGoal.includes('class="kpis"'));

const docNoData = buildPerformanceReportDocument(fakeData({ summary: { status: "no_data" } }));
const htmlNoData = renderPerformanceReportHtml(docNoData);
ok("mensagem de sem dado aparece no HTML quando no_data", htmlNoData.includes("Não encontramos dados"));

// ---------------------------------------------------------------------------
console.log("\n11 — Botão de PDF: só aparece quando pdfHref é passado, nunca fabricado\n");

const docPlain = buildPerformanceReportDocument(fakeData());
ok("sem pdfHref, nenhum elemento de botão de PDF no HTML", !renderPerformanceReportHtml(docPlain).includes('<a class="pdf-button"'));
ok(
  "com pdfHref, botão de PDF aparece apontando pro link exato",
  renderPerformanceReportHtml(docPlain, { pdfHref: "/api/clients/1/performance-report?format=pdf" }).includes(
    '<a class="pdf-button" href="/api/clients/1/performance-report?format=pdf"',
  ),
);

// ---------------------------------------------------------------------------
console.log("\n12 — Etapa 'Otimização do Performance Report': seções vazias viram bloco compacto\n");

const docEmptyCampaigns = buildPerformanceReportDocument(fakeData({ campaigns: [] }));
const htmlEmptyCampaigns = renderPerformanceReportHtml(docEmptyCampaigns);
const emptyCampaignsSection = htmlEmptyCampaigns.match(/id="campanhas"[\s\S]*?<\/section>/)![0];
ok("seção vazia usa a classe compacta", emptyCampaignsSection.includes("section-compact"));
ok("seção vazia mostra o título e a mensagem numa linha só", emptyCampaignsSection.includes("Campanhas") && emptyCampaignsSection.includes("Dados não disponíveis neste período."));
ok("seção vazia NUNCA renderiza o cabeçalho completo (sem pill de contagem)", !emptyCampaignsSection.includes('class="count"'));
ok("seção vazia NUNCA renderiza a tabela", !emptyCampaignsSection.includes("<table"));

// ---------------------------------------------------------------------------
console.log("\n13 — Etapa 'Otimização do Performance Report': badges de campanha aparecem no HTML\n");

const badgeCampaigns = [
  campaign("Melhor", 200, { totalResultCount: 5, cpa: 20 }),
  campaign("MaiorVolume", 500, { totalResultCount: 50, cpa: 25 }),
  campaign("Comum", 100, { totalResultCount: 3, cpa: 60 }),
];
const docBadges = buildPerformanceReportDocument(fakeData({ campaigns: badgeCampaigns, summary: { status: "ok", kpis: [], performanceSummary: { ...NEUTRAL_PERFORMANCE_SUMMARY, targetCostPerResult: 30 } } }));
const campanhasTable = docBadges.tables.find((t) => t.id === "campanhas")!;
ok("campanha de melhor custo ganha o badge 'Melhor custo'", campanhasTable.rows.find((r) => r.name === "Melhor")!.badges!.includes("Melhor custo"));
ok("campanha de maior volume ganha o badge 'Maior volume'", campanhasTable.rows.find((r) => r.name === "MaiorVolume")!.badges!.includes("Maior volume"));
check(
  "campanha comum (nem melhor custo, nem maior volume), acima da meta, ganha só 'Acima da meta'",
  campanhasTable.rows.find((r) => r.name === "Comum")!.badges,
  ["Acima da meta"],
);
const htmlBadges = renderPerformanceReportHtml(docBadges);
ok("badge aparece no HTML como <span class=\"badge\">", htmlBadges.includes('<span class="badge">Melhor custo</span>'));
ok("badge 'Maior volume' aparece no HTML", htmlBadges.includes('<span class="badge">Maior volume</span>'));
ok("badge 'Acima da meta' também aparece no HTML", htmlBadges.includes('<span class="badge">Acima da meta</span>'));

// ---------------------------------------------------------------------------
console.log("\n14 — Etapa 'Otimização do Performance Report': 'Leitura do período' — presente/ausente conforme o estado\n");

const docWithReading = buildPerformanceReportDocument(
  fakeData({ summary: { status: "ok", kpis: [], performanceSummary: { ...NEUTRAL_PERFORMANCE_SUMMARY, resultCount: 5, hasAnyRecord: true, costPerResult: 20 } } }),
);
ok("com objetivo e dado no período, periodReading não é null", docWithReading.periodReading !== null);
const htmlWithReading = renderPerformanceReportHtml(docWithReading);
ok("bloco 'Leitura do período' aparece no HTML", htmlWithReading.includes("Leitura do período"));

const docNoGoalReading = buildPerformanceReportDocument(fakeData({ summary: { status: "no_goal" } }));
check("sem objetivo configurado, periodReading é null", docNoGoalReading.periodReading, null);
const htmlNoGoalReading = renderPerformanceReportHtml(docNoGoalReading);
ok("sem objetivo, o bloco 'Leitura do período' NUNCA aparece", !htmlNoGoalReading.includes('class="reading"'));

// ---------------------------------------------------------------------------
console.log("\n15 — Regressão: nenhuma métrica canônica mudou (mesmos valores de sempre)\n");

const regressionCampaigns = [campaign("Regressão", 4830.68, { totalResultCount: 186, cpa: 25.97, totalRevenue: 60821.51, roas: 12.59 })];
const docRegression = buildPerformanceReportDocument(fakeData({ campaigns: regressionCampaigns }));
const regressionRow = docRegression.tables.find((t) => t.id === "campanhas")!.rows[0];
check("investimento inalterado", regressionRow.metrics[0].sortValue, 4830.68);
check("resultado inalterado", regressionRow.metrics[1].sortValue, 186);
check("CPA inalterado", regressionRow.metrics[2].sortValue, 25.97);
check("receita inalterada", regressionRow.metrics[3].sortValue, 60821.51);
check("ROAS inalterado", regressionRow.metrics[4].sortValue, 12.59);

// ---------------------------------------------------------------------------
console.log("\n16 — Etapa 'Filtro por nome (contém/não contém)': nameFilterable ligado só onde faz sentido\n");

const docFilterFlags = buildPerformanceReportDocument(
  fakeData({
    campaigns: [campaign("Campanha A", 100)],
    adSets: [adSet("Público A", 100)],
    creatives: [creative("Criativo A", 100)],
    dailyRows: [{ date: "2026-08-01", spend: 100, resultCount: 3, revenue: null, costPerResult: 33.33, roas: null }],
  }),
);
check("Campanhas: nameFilterable = true (linha tem nome real de campanha)", docFilterFlags.tables.find((t) => t.id === "campanhas")!.nameFilterable, true);
check("Públicos: nameFilterable = true (linha tem nome real de público)", docFilterFlags.tables.find((t) => t.id === "publicos")!.nameFilterable, true);
check("Criativos: nameFilterable = true (linha tem nome real de criativo)", docFilterFlags.tables.find((t) => t.id === "criativos")!.nameFilterable, true);
check(
  "Resultado Diário: nameFilterable = false (linha é uma data, nunca um nome livre)",
  docFilterFlags.tables.find((t) => t.id === "resultado-diario")!.nameFilterable,
  false,
);

// ---------------------------------------------------------------------------
console.log("\n17 — Etapa 'Filtro no topo afeta o dashboard inteiro': UM controle no topo, acima do Resumo do período\n");
{
  const tableSectionSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-table-section.tsx"), "utf8");
  const filterableSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-filterable-tables.tsx"), "utf8");
  const bodySource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-body.tsx"), "utf8");

  ok(
    "ReportTableSection não tem NENHUMA lógica de filtro própria — vive só em ReportFilterableTables",
    !/NameFilterControl|filterMode|filterText|matchesNameFilter/.test(tableSectionSource),
  );
  ok("ReportBody delega pra ReportFilterableTables, passando o document inteiro (não só as tabelas)", /<ReportFilterableTables document=\{document\} \/>/.test(bodySource));
  ok("ReportBody não monta mais o Resumo do período/KPI grid diretamente — isso virou parte de ReportFilterableTables", !/<ReportKpiGrid/.test(bodySource));
  ok("dimensão do filtro só lista tabelas com nameFilterable (Resultado Diário nunca aparece como opção)", /tables\.filter\(\(table\) => table\.nameFilterable\)/.test(filterableSource));
  ok("dois modos: contém / não contém", /contém<\/option>/.test(filterableSource) && /não contém<\/option>/.test(filterableSource));
  ok(
    "só a tabela da dimensão selecionada é filtrada — as outras 2 passam intocadas",
    /if \(table\.id !== dimensionId\) return table;/.test(filterableSource),
  );
  ok(
    "'Resultado Diário' é RECONSTRUÍDO via buildDailyTable (a mesma função de sempre), nunca uma segunda formatação de tabela",
    /buildDailyTable\(recomputedDaily, document\.performanceGoal\)/.test(filterableSource),
  );
  ok(
    "Resumo do período recalculado usa a MESMA buildAnalyticsKpiCards de sempre — nunca uma segunda fórmula/rótulo de KPI",
    /buildAnalyticsKpiCards\(document\.performanceGoal, filteredSummary\.actualSpend/.test(filterableSource),
  );
  ok(
    "sem performanceGoal, o Resumo NUNCA é recalculado (mesmo com filtro ativo nas tabelas) — não existe rótulo de objetivo pra montar um Resumo com sentido",
    /if \(!isFiltering \|\| !document\.performanceGoal\) return null;/.test(filterableSource),
  );
  ok(
    "'Leitura do período' some enquanto filtrando — narrativa do período inteiro nunca fica ao lado de números já filtrados",
    /\{!isFiltering && <PeriodReading document=\{document\} \/>\}/.test(filterableSource),
  );
  ok('selo "Mostrando só" sempre visível quando filtrando — números filtrados nunca parecem o total real por engano', /Mostrando só:/.test(filterableSource));
  ok(
    "achado real na validação da 1ª versão: nunca flexiona artigo de gênero a partir do nome da tabela (quebrava em 'Nenhum campanha') — frase fixa",
    !/Nenhum \$\{|Nenhuma \$\{|Nenhum \{|Nenhuma \{/.test(filterableSource),
  );
}

console.log("\n18 — Etapa 'Filtro no topo': comportamento real do matching (contém/não contém), via document de verdade\n");
{
  const docFilterMatch = buildPerformanceReportDocument(
    fakeData({
      campaigns: [campaign("Black Friday", 100), campaign("Remarketing", 200), campaign("Teste interno", 300)],
    }),
  );
  const campaignsTable = docFilterMatch.tables.find((t) => t.id === "campanhas")!;
  const containsTeste = campaignsTable.rows.filter((row) => row.name.toLowerCase().includes("teste"));
  check("'contém' teste: só 1 campanha", containsTeste.length, 1);
  const notContainsTeste = campaignsTable.rows.filter((row) => !row.name.toLowerCase().includes("teste"));
  check("'não contém' teste: as outras 2 campanhas", notContainsTeste.length, 2);
}

// ---------------------------------------------------------------------------
console.log("\n19 — report-filter-recompute.ts: recomputeDailyRows/recomputeFilteredSummary são puras e corretas (teste real, não estrutural)\n");
{
  const rows: FilterableDailyRow[] = [
    { date: "2026-08-01", name: "Black Friday", spend: 100, resultCount: 4, revenue: null },
    { date: "2026-08-01", name: "Remarketing", spend: 50, resultCount: 2, revenue: null },
    { date: "2026-08-02", name: "Black Friday", spend: 80, resultCount: 3, revenue: null },
    { date: "2026-08-03", name: "Teste interno", spend: 10, resultCount: 1, revenue: null },
  ];
  const period = { start: "2026-08-01", end: "2026-08-03" };

  console.log("  19a — recomputeDailyRows\n");
  {
    const daily = recomputeDailyRows(period, rows, "contains", "black");
    check("3 dias no período, mesmo sem sinal em algum (nunca corta o período)", daily.length, 3);
    check("dia 1: só Black Friday somada (Remarketing não bate no filtro)", daily[0]!.spend, 100);
    check("dia 2: Black Friday do dia 2", daily[1]!.spend, 80);
    check("dia 3: nenhuma linha bate 'black' nesse dia — spend null, nunca 0 fabricado", daily[2]!.spend, null);
  }
  {
    const dailyNotContains = recomputeDailyRows(period, rows, "not_contains", "black");
    check("'não contém black', dia 1: só Remarketing (50)", dailyNotContains[0]!.spend, 50);
    check("'não contém black', dia 2: nenhuma linha sobra (Black Friday é a única do dia 2)", dailyNotContains[1]!.spend, null);
    check("'não contém black', dia 3: Teste interno (10)", dailyNotContains[2]!.spend, 10);
  }
  {
    const dailyEmpty = recomputeDailyRows(period, rows, "contains", "");
    ok("texto vazio: todos os dias somam TODAS as linhas (nenhum filtro aplicado)", dailyEmpty[0]!.spend === 150 && dailyEmpty[1]!.spend === 80 && dailyEmpty[2]!.spend === 10);
  }

  console.log("\n  19b — recomputeFilteredSummary\n");
  {
    const summary = recomputeFilteredSummary("leads", rows, "contains", "black");
    check("investimento somado só das linhas 'black' (100 + 80)", summary.actualSpend, 180);
    check("resultado somado só das linhas 'black' (4 + 3)", summary.resultCount, 7);
    check("CPL recalculado a partir do total filtrado (180 / 7), nunca uma média simples", summary.costPerResult, 180 / 7);
    check("nunca compara contra meta da carteira inteira — targetCostPerResult sempre null aqui", summary.targetCostPerResult, null);
    check("comparison.status = not_available (mesma regra de compareCostToTarget sem meta)", summary.comparison.status, "not_available");
  }
}

// ---------------------------------------------------------------------------
console.log("\n20 — Taxa de conversão (vendas ÷ carrinhos): pura, passthrough no documento, some sob filtro\n");
{
  console.log("  20a — computeConversionRate (lib/performance.ts)\n");
  check("10 vendas / 40 carrinhos = 0.25 (fração, nunca 0-100)", computeConversionRate(10, 40), 0.25);
  check("zero carrinho no período: null, nunca 0/Infinity fabricado", computeConversionRate(10, 0), null);
  check("zero venda com carrinho existente: 0 real (divisão válida, não ausência de dado)", computeConversionRate(0, 40), 0);

  console.log("\n  20b — buildPerformanceReportDocument: passthrough sem cálculo próprio\n");
  const docWithRate = buildPerformanceReportDocument(fakeData({ conversionRate: 0.32 }));
  check("document.conversionRate é exatamente o que report-data.ts calculou, nunca recalculado aqui", docWithRate.conversionRate, 0.32);
  const docNoRate = buildPerformanceReportDocument(fakeData());
  check("sem carrinho no período (fakeData default): document.conversionRate é null", docNoRate.conversionRate, null);

  console.log("\n  20c — ReportFilterableTables: card só existe com dado real, some enquanto filtrando (conta inteira, não recalculável por dimensão)\n");
  const filterableSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-filterable-tables.tsx"), "utf8");
  ok(
    "ConversionRateNote retorna null sem conversionRate — nunca um card com 0%/traço fabricado",
    /if \(conversionRate === null\) return null;/.test(filterableSource),
  );
  ok(
    "card de Taxa de conversão some enquanto o filtro de Campanha/Público/Criativo está ativo — carrinho só existe no nível de conta",
    /\{!isFiltering && <ConversionRateNote conversionRate=\{document\.conversionRate\} \/>\}/.test(filterableSource),
  );
  ok("formatação usa formatPercent (mesma convenção de % do resto da MITZA), nunca um toFixed/string manual", /formatPercent\(conversionRate \* 100\)/.test(filterableSource));
}

// ---------------------------------------------------------------------------
console.log("\n21 — Posicionamentos: nova tabela no Relatório, ao lado de Campanhas/Públicos/Criativos (nunca reordena as 4 já aprovadas)\n");
{
  const docNoPlacements = buildPerformanceReportDocument(fakeData());
  check(
    "ordem: Resultado Diário → Campanhas → Públicos → Criativos → Posicionamentos (sempre por último)",
    docNoPlacements.tables.map((t) => t.id),
    ["resultado-diario", "campanhas", "publicos", "criativos", "posicionamentos"],
  );
  const emptyPlacementsTable = docNoPlacements.tables.find((t) => t.id === "posicionamentos")!;
  check("sem nenhuma fonte com platform_position_column configurado (fakeData default): 0 linhas, nunca fabricadas", emptyPlacementsTable.rows.length, 0);
  ok("Posicionamentos não é nameFilterable (não é uma entidade nomeada como campanha/público/criativo)", emptyPlacementsTable.nameFilterable === false);
  ok("Posicionamentos não usa progressive disclosure (sempre poucos valores possíveis)", emptyPlacementsTable.disclosure === false);

  const docWithPlacements = buildPerformanceReportDocument(
    fakeData({
      placements: [
        { platformPosition: "feed", totalSpend: 100, resultType: "sales", totalResultCount: 10, totalRevenue: 500, cpa: 10, roas: 5, spendShare: 0.625, resultShare: 0.8 },
        { platformPosition: "instagram_reels", totalSpend: 60, resultType: null, totalResultCount: null, totalRevenue: null, cpa: null, roas: null, spendShare: 0.375, resultShare: null },
      ],
    }),
  );
  const placementsTable = docWithPlacements.tables.find((t) => t.id === "posicionamentos")!;
  check("2 posicionamentos aparecem como linhas, exatamente como vieram de buildPlacementSummaries (nenhum recálculo aqui)", placementsTable.rows.length, 2);
  ok(
    "coluna '% Investimento' sempre presente (mesma unidade em toda linha)",
    placementsTable.metricColumns.some((c) => c.key === "spendShare"),
  );
  ok(
    "coluna '% Resultado' presente quando PELO MENOS um posicionamento tem resultShare (mesmo padrão de hasRevenue/hasRoas)",
    placementsTable.metricColumns.some((c) => c.key === "resultShare"),
  );
  const feedRow = placementsTable.rows.find((r) => r.name === "feed")!;
  check("linha 'feed': % Investimento formatado como percentual (62,50%)", feedRow.metrics[3].display, formatPercent(62.5));
  const reelsRow = placementsTable.rows.find((r) => r.name === "instagram_reels")!;
  check("linha sem resultShare: célula '—' (nunca 0% fabricado)", reelsRow.metrics[4].display, "—");
}

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
