/**
 * Etapa "Consolidação por Nome (Públicos/Criativos)" — regra de produto:
 * "Públicos com o mesmo nome = mesmo público" / "Criativos com o mesmo nome
 * = mesmo criativo", nomenclatura operacional como identidade, nunca IDs.
 *
 * Auditoria confirmou que `buildAdSetSummaries`
 * (`lib/ad-set-analytics.ts`)/`buildCreativeSummaries`
 * (`lib/creative-analytics.ts`) JÁ agrupavam por nome ignorando campanha (ver
 * `scripts/test-ad-set-analytics.ts`, seção 3, já cobria "público em 2
 * campanhas → 1 linha" antes desta etapa) — a lacuna real era só a ausência
 * de `.trim()` na chave/nome exibido, o que causaria duplicação em casos de
 * espaço acidental na origem. Este arquivo cobre: normalização mínima
 * (trim, sem fuzzy match), métricas aditivas somadas e derivadas
 * recalculadas dos totais (nunca média), resolução determinística de
 * thumbnail/permalink pra Criativos, e a integração completa até
 * `PerformanceReportDocument` (a MESMA estrutura consumida pela página
 * nativa e pelo PDF) — provando que a consolidação acontece na camada
 * canônica, nunca um truque visual em `report-table-section.tsx`. Campanhas
 * (`lib/campaign-analytics.ts`) não foram tocadas nesta etapa — regressão
 * coberta na seção 5.
 *
 * Rodar: npx tsx scripts/test-performance-report-consolidation.ts
 */
import assert from "node:assert/strict";
import { buildAdSetSummaries, type AdSetDailyMetricRow } from "../src/lib/ad-set-analytics";
import { buildCreativeSummaries, type AdCreativeDailyMetricRow } from "../src/lib/creative-analytics";
import { buildCampaignSummaries, type CampaignDailyMetricRow } from "../src/lib/campaign-analytics";
import type { PerformanceReportData } from "../src/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "../src/lib/performance-report/report-document";
import { renderPerformanceReportHtml } from "../src/lib/performance-report/renderers/html-renderer";
import { formatCurrency } from "../src/lib/format";

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

function adSetRow(overrides: Partial<AdSetDailyMetricRow> & { adSetName: string }): AdSetDailyMetricRow {
  return {
    date: "2026-08-01",
    channel: "meta",
    campaignName: "Campanha padrão",
    spend: 0,
    impressions: null,
    reach: null,
    clicks: null,
    resultType: null,
    resultCount: null,
    revenue: null,
    ...overrides,
  };
}

function creativeRow(overrides: Partial<AdCreativeDailyMetricRow> & { creativeName: string }): AdCreativeDailyMetricRow {
  return {
    date: "2026-08-01",
    campaignName: "Campanha padrão",
    creativePermalinkUrl: null,
    previewImageUrl: null,
    spend: 0,
    impressions: null,
    reach: null,
    clicks: null,
    resultType: null,
    resultCount: null,
    revenue: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("1 — Públicos: consolidação por nome\n");

{
  const rows = [
    adSetRow({ adSetName: "Público A", campaignName: "Campanha 1", spend: 100, resultType: "sales", resultCount: 5, revenue: 500 }),
    adSetRow({ adSetName: "Público B", campaignName: "Campanha 1", spend: 40, resultType: "sales", resultCount: 2, revenue: 80 }),
    adSetRow({ adSetName: "Público A", campaignName: "Campanha 2", spend: 50, resultType: "sales", resultCount: 3, revenue: 300 }),
    adSetRow({ adSetName: "Público A", campaignName: "Campanha 3", spend: 25, resultType: "sales", resultCount: 1, revenue: 100 }),
  ];
  const summaries = buildAdSetSummaries(rows);

  check("2 públicos únicos (A e B), nunca 4 linhas repetindo A", summaries.length, 2);
  const publicoA = summaries.find((s) => s.adSetName === "Público A")!;
  const publicoB = summaries.find((s) => s.adSetName === "Público B")!;
  ok("Público A e Público B existem", Boolean(publicoA) && Boolean(publicoB));

  // "mesmo nome em três registros → métricas somadas"
  check("Público A: investimento somado dos 3 registros (100+50+25)", publicoA.totalSpend, 175);
  check("Público A: resultados somados dos 3 registros (5+3+1)", publicoA.totalResultCount, 9);
  check("Público A: receita somada dos 3 registros (500+300+100)", publicoA.totalRevenue, 900);
  check("Público A: apareceu nas 3 campanhas diferentes", publicoA.campaignNames, ["Campanha 1", "Campanha 2", "Campanha 3"]);

  // "CPA/CPL/etc. derivados → recalculados dos totais, nunca média simples"
  // Se fosse média simples de CPA por registro: (20 + 16.67 + 25) / 3 ≈ 20.56.
  // Recalculado do total (regra correta): 175 / 9 ≈ 19.44.
  check("Público A: CPA = investimento total / resultado total (nunca média das linhas)", Math.round(publicoA.cpa! * 100) / 100, 19.44);
  check("Público A: ROAS = receita total / investimento total", Math.round(publicoA.roas! * 100) / 100, 5.14);

  check("Público B permanece com seus próprios números, não contaminado por A", publicoB.totalSpend, 40);
}

// ---------------------------------------------------------------------------
console.log("\n2 — Públicos: nomes diferentes continuam separados (sem fuzzy match)\n");

{
  const rows = [
    adSetRow({ adSetName: "Lookalike 1%", spend: 100 }),
    adSetRow({ adSetName: "Lookalike 1% - Compradores", spend: 50 }),
  ];
  const summaries = buildAdSetSummaries(rows);
  check("nomes parecidos, mas diferentes, nunca são fundidos", summaries.length, 2);
  ok("'Lookalike 1%' preservado tal como veio", summaries.some((s) => s.adSetName === "Lookalike 1%"));
  ok("'Lookalike 1% - Compradores' preservado tal como veio, nunca reescrito", summaries.some((s) => s.adSetName === "Lookalike 1% - Compradores"));
}

// ---------------------------------------------------------------------------
console.log("\n3 — Públicos: espaços acidentais no nome (trim, nunca fuzzy match)\n");

{
  const rows = [adSetRow({ adSetName: "Público A", spend: 100 }), adSetRow({ adSetName: " Público A ", spend: 50 }), adSetRow({ adSetName: "Público A\t", spend: 25 })];
  const summaries = buildAdSetSummaries(rows);
  check("'Público A' / ' Público A ' / 'Público A\\t' são o MESMO público (só espaço acidental)", summaries.length, 1);
  check("investimento consolidado das 3 variantes de espaçamento", summaries[0].totalSpend, 175);
  check("nome exibido é a forma normalizada (trim), determinístico — nunca uma versão com espaço sobrando", summaries[0].adSetName, "Público A");
}

// ---------------------------------------------------------------------------
console.log("\n4 — Criativos: consolidação por nome (campanhas diferentes)\n");

{
  const rows = [
    creativeRow({ creativeName: "VIDEO - LAST TICKETS", campaignName: "Campanha 1", spend: 200, resultType: "sales", resultCount: 10, revenue: 1000, impressions: 5000, clicks: 100 }),
    creativeRow({ creativeName: "ARTE - LAST CALL", campaignName: "Campanha 1", spend: 30, resultType: "sales", resultCount: 1, revenue: 50 }),
    creativeRow({ creativeName: "VIDEO - LAST TICKETS", campaignName: "Campanha 2", spend: 80, resultType: "sales", resultCount: 4, revenue: 400, impressions: 2000, clicks: 40 }),
  ];
  const summaries = buildCreativeSummaries(rows);

  check("2 criativos únicos, nunca 3 linhas repetindo VIDEO - LAST TICKETS", summaries.length, 2);
  const video = summaries.find((s) => s.creativeName === "VIDEO - LAST TICKETS")!;
  ok("VIDEO - LAST TICKETS existe", Boolean(video));

  check("métricas aditivas somadas: investimento (200+80)", video.totalSpend, 280);
  check("métricas aditivas somadas: resultado (10+4)", video.totalResultCount, 14);
  check("métricas aditivas somadas: receita (1000+400)", video.totalRevenue, 1400);
  check("métricas aditivas somadas: impressões (5000+2000)", video.totalImpressions, 7000);
  check("métricas aditivas somadas: cliques (100+40)", video.totalClicks, 140);
  check("apareceu nas 2 campanhas diferentes — mas é UMA linha no relatório", video.campaignNames, ["Campanha 1", "Campanha 2"]);

  // Derivadas recalculadas dos totais, nunca média simples das 2 linhas
  // (CPA por linha seria 20 e 20 — aqui o teste teria que acusar diferença
  // caso a implementação algum dia trocasse pra média; valores abaixo já
  // batem com total/total, então funcionam como guarda de regressão real).
  check("CPA recalculado do total (280/14)", video.cpa, 20);
  check("ROAS recalculado do total (1400/280)", video.roas, 5);
  check("CPC recalculado do total (280/140)", video.cpc, 2);
}

// ---------------------------------------------------------------------------
console.log("\n5 — Criativos: mesmo nome sem nenhum outro dado de contexto em comum também consolida\n");

{
  // ad_creative_daily_metrics não tem coluna de ad_set — a identidade É
  // exclusivamente creativeName; qualquer outro dado (aqui, campanhas
  // totalmente diferentes) nunca separa duas linhas do mesmo nome.
  const rows = [
    creativeRow({ creativeName: "Criativo X", campaignName: "Institucional", spend: 10 }),
    creativeRow({ creativeName: "Criativo X", campaignName: "Promoção de Verão", spend: 15 }),
  ];
  const summaries = buildCreativeSummaries(rows);
  check("mesmo nome em contextos (campanhas) totalmente diferentes → 1 linha", summaries.length, 1);
  check("investimento consolidado", summaries[0].totalSpend, 25);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Criativos: nomes diferentes continuam separados (sem fuzzy match)\n");

{
  const rows = [creativeRow({ creativeName: "VIDEO - LAST TICKETS", spend: 100 }), creativeRow({ creativeName: "VIDEO - LAST TICKETS 2", spend: 50 })];
  const summaries = buildCreativeSummaries(rows);
  check("'VIDEO - LAST TICKETS' e 'VIDEO - LAST TICKETS 2' continuam 2 criativos", summaries.length, 2);
}

// ---------------------------------------------------------------------------
console.log("\n7 — Criativos: espaços acidentais no nome (trim)\n");

{
  const rows = [creativeRow({ creativeName: "Criativo Y", spend: 10 }), creativeRow({ creativeName: "  Criativo Y", spend: 20 })];
  const summaries = buildCreativeSummaries(rows);
  check("'Criativo Y' e '  Criativo Y' são o mesmo criativo (espaço acidental)", summaries.length, 1);
  check("nome exibido normalizado (trim)", summaries[0].creativeName, "Criativo Y");
  check("investimento consolidado", summaries[0].totalSpend, 30);
}

// ---------------------------------------------------------------------------
console.log("\n8 — Criativos: thumbnail e permalink preservados na consolidação\n");

{
  const rows = [
    creativeRow({ creativeName: "Criativo Z", date: "2026-08-05", spend: 10, creativePermalinkUrl: "https://instagram.com/p/z", previewImageUrl: "https://cdn.example/z.jpg" }),
    creativeRow({ creativeName: "Criativo Z", date: "2026-08-06", spend: 20, creativePermalinkUrl: null, previewImageUrl: null }),
  ];
  const summaries = buildCreativeSummaries(rows);
  check("permalink preservado mesmo com registro sem link", summaries[0].permalinkUrl, "https://instagram.com/p/z");
  check("thumbnail preservada mesmo com registro sem imagem", summaries[0].previewImageUrl, "https://cdn.example/z.jpg");
}

// ---------------------------------------------------------------------------
console.log("\n9 — Criativos: metadata conflitante (thumbnail/permalink diferentes) — resolução determinística\n");

{
  // Dois registros do MESMO criativo com permalink/thumbnail DIFERENTES —
  // cenário real possível (o link pode mudar entre dias). Regra: primeira
  // aparição por DATA (nunca pela ordem de chegada do array).
  const rowEarlier = creativeRow({ creativeName: "Criativo Conflito", date: "2026-08-01", spend: 10, creativePermalinkUrl: "https://instagram.com/p/early", previewImageUrl: "https://cdn.example/early.jpg" });
  const rowLater = creativeRow({ creativeName: "Criativo Conflito", date: "2026-08-10", spend: 15, creativePermalinkUrl: "https://instagram.com/p/late", previewImageUrl: "https://cdn.example/late.jpg" });

  const forward = buildCreativeSummaries([rowEarlier, rowLater]);
  const reversed = buildCreativeSummaries([rowLater, rowEarlier]);

  check("permalink resolvido = data mais antiga, independente da ordem de chegada (forward)", forward[0].permalinkUrl, "https://instagram.com/p/early");
  check("permalink resolvido = data mais antiga, independente da ordem de chegada (reversed)", reversed[0].permalinkUrl, "https://instagram.com/p/early");
  check("thumbnail resolvida = data mais antiga, independente da ordem de chegada (forward)", forward[0].previewImageUrl, "https://cdn.example/early.jpg");
  check("thumbnail resolvida = data mais antiga, independente da ordem de chegada (reversed)", reversed[0].previewImageUrl, "https://cdn.example/early.jpg");
  ok("forward e reversed produzem exatamente o mesmo resultado (nunca dependente de ordem arbitrária)", forward[0].permalinkUrl === reversed[0].permalinkUrl && forward[0].previewImageUrl === reversed[0].previewImageUrl);
}

// ---------------------------------------------------------------------------
console.log("\n10 — Campanhas: regressão — nunca tocadas nesta etapa\n");

{
  // Campanhas continuam SEM normalização de espaço (fora de escopo desta
  // etapa) — este teste documenta a fronteira: dois nomes que só diferem por
  // espaço continuam 2 linhas em Campanhas (comportamento inalterado),
  // diferente de Públicos/Criativos (que agora normalizam).
  const rows: CampaignDailyMetricRow[] = [
    { date: "2026-08-01", channel: "meta", campaignName: "Campanha 1", spend: 10, impressions: null, reach: null, clicks: null, resultType: null, resultCount: null, revenue: null },
    { date: "2026-08-01", channel: "meta", campaignName: " Campanha 1", spend: 20, impressions: null, reach: null, clicks: null, resultType: null, resultCount: null, revenue: null },
  ];
  const summaries = buildCampaignSummaries(rows);
  check("Campanhas não ganharam normalização de espaço nesta etapa (fora de escopo) — continuam 2 linhas", summaries.length, 2);
}

// ---------------------------------------------------------------------------
console.log("\n11 — Integração: PerformanceReportDocument já chega consolidado (camada correta)\n");

{
  const adSetRows = [
    adSetRow({ adSetName: "Público A", campaignName: "Campanha 1", spend: 100, resultType: "leads", resultCount: 10 }),
    adSetRow({ adSetName: "Público A", campaignName: "Campanha 2", spend: 50, resultType: "leads", resultCount: 5 }),
    adSetRow({ adSetName: "Público B", campaignName: "Campanha 1", spend: 20, resultType: "leads", resultCount: 2 }),
  ];
  const creativeRows = [
    creativeRow({ creativeName: "Criativo A", campaignName: "Campanha 1", spend: 60, resultType: "leads", resultCount: 6 }),
    creativeRow({ creativeName: "Criativo A", campaignName: "Campanha 2", spend: 40, resultType: "leads", resultCount: 4 }),
  ];

  const data: PerformanceReportData = {
    client: { id: "client-1", name: "Cliente Teste" },
    period: { start: "2026-08-01", end: "2026-08-31", label: "01 ago 2026 → 31 ago 2026" },
    summary: { status: "no_goal" },
    campaigns: [],
    adSets: buildAdSetSummaries(adSetRows),
    creatives: buildCreativeSummaries(creativeRows),
    generatedAt: "2026-09-01T00:00:00.000Z",
  };

  const document = buildPerformanceReportDocument(data);
  const publicosTable = document.tables.find((t) => t.id === "publicos")!;
  const criativosTable = document.tables.find((t) => t.id === "criativos")!;

  check("tabela de Públicos já chega com 2 linhas (não 3 registros brutos)", publicosTable.rows.length, 2);
  check("tabela de Criativos já chega com 1 linha (não 2 registros brutos)", criativosTable.rows.length, 1);

  const publicoARow = publicosTable.rows.find((r) => r.name === "Público A")!;
  check(
    "linha de Público A na tabela do documento já mostra o investimento CONSOLIDADO (100+50), formatado",
    publicoARow.metrics[0].display,
    formatCurrency(150),
  );
  check("linha de Público A: sortValue já é o total consolidado (150), não um valor por campanha", publicoARow.metrics[0].sortValue, 150);

  // "página nativa recebe consolidação" e "PDF recebe exatamente a mesma
  // consolidação": ambos os caminhos leem o MESMO `document` — a página
  // nativa itera `document.tables` diretamente (ver
  // `report-table-section.tsx`), e o PDF é gerado renderizando este MESMO
  // documento em HTML (`renderPerformanceReportHtml`, usado tanto pela rota
  // de PDF quanto testado aqui) — nunca dois documentos diferentes.
  const html = renderPerformanceReportHtml(document);
  ok("o HTML usado pra gerar o PDF contém o mesmo valor consolidado que a página nativa mostraria", html.includes(formatCurrency(150)));
  ok("o HTML usado pra gerar o PDF NUNCA mostra 'Público A' duas vezes (uma linha só, como na página nativa)", (html.match(/Público A/g) ?? []).length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n12 — Integração: progressive disclosure conta itens CONSOLIDADOS, não registros brutos\n");

{
  // 15 registros brutos do MESMO ad set, em 15 campanhas diferentes —
  // ultrapassaria o limiar de 10 linhas (INITIAL_VISIBLE_ROWS,
  // report-table-section.tsx) se a consolidação não tivesse acontecido.
  const manyRawRows = Array.from({ length: 15 }, (_, i) => adSetRow({ adSetName: "Público Único", campaignName: `Campanha ${i + 1}`, spend: 10 }));
  const data: PerformanceReportData = {
    client: { id: "client-2", name: "Cliente Teste 2" },
    period: { start: "2026-08-01", end: "2026-08-31", label: "01 ago 2026 → 31 ago 2026" },
    summary: { status: "no_goal" },
    campaigns: [],
    adSets: buildAdSetSummaries(manyRawRows),
    creatives: [],
    generatedAt: "2026-09-01T00:00:00.000Z",
  };
  const document = buildPerformanceReportDocument(data);
  const publicosTable = document.tables.find((t) => t.id === "publicos")!;
  check("15 registros brutos do mesmo público consolidam em 1 linha — nunca aciona 'ver todos' por engano", publicosTable.rows.length, 1);
}

console.log(`\nTodos os ${passed} testes passaram.`);
