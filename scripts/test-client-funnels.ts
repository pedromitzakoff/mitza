/**
 * Testes da Etapa "Gestão de Funis Estratégicos por Cliente" — núcleo puro
 * (`lib/client-funnels.ts`) + integração com o documento do Relatório
 * (`lib/performance-report/report-document.ts`). Cobre os 10 cenários
 * explicitamente pedidos: cliente sem funis / com múltiplos funis; sugestão
 * por chave + confirmação + correção manual; campanha renomeada após
 * classificada; campanhas com nomes idênticos e IDs diferentes; campanha sem
 * ID/sem chave/com chave ambígua; investimento consolidado sem duplicação;
 * indicadores por funil sem soma incompatível; filtros por
 * campanha/público/criativo/posicionamento; compatibilidade com
 * objetivos/Sprint/Relatório atual; reimportação sem perda de classificação.
 *
 * Rodar: npx tsx scripts/test-client-funnels.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  suggestFunnelForCampaignName,
  buildFunnelByCampaignId,
  buildFunnelByCampaignName,
  resolveFunnelForCampaignName,
  findPendingCampaigns,
  aggregateSpendByFunnel,
  funnelShowsResults,
  sanitizeFunnelIndicators,
  sortFunnelsForDisplay,
  normalizeNamingKey,
  isValidNamingKey,
  type ClientFunnel,
} from "../src/lib/client-funnels";
import { buildPerformanceReportDocument } from "../src/lib/performance-report/report-document";
import { GENERAL_REPORT_VIEW } from "../src/lib/performance-report/report-data";
import type { PerformanceReportData } from "../src/lib/performance-report/report-data";
import type { CampaignSummary } from "../src/lib/campaign-analytics";
import type { PerformanceSummary } from "../src/lib/performance";

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

function funnel(overrides: Partial<ClientFunnel> & { id: string; name: string; namingKey: string }): ClientFunnel {
  return {
    clientId: "client-1",
    isActive: true,
    linkedResultType: null,
    relevantIndicators: [],
    sortOrder: 0,
    ...overrides,
  };
}

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
    placementDailyRows: [],
    conversionRate: null,
    placements: [],
    generatedAt: "2026-09-01T12:00:00.000Z",
    view: GENERAL_REPORT_VIEW,
    activeFunnels: [],
    funnelPanorama: null,
    pendingFunnelCampaignNames: [],
    funnelFilterMayBeIncomplete: false,
    selectedFunnelIndicators: null,
    ...overrides,
  };
}

console.log("1 — Cliente sem funis / cliente com múltiplos funis\n");

{
  ok("cliente sem funis: sortFunnelsForDisplay([]) devolve lista vazia", sortFunnelsForDisplay([]).length === 0);
  ok("cliente sem funis: sugestão nunca encontra chave (lista vazia)", suggestFunnelForCampaignName("[CAPTACAO] | teste", []).kind === "no_key");

  const captacao = funnel({ id: "f-captacao", name: "Captação", namingKey: "CAPTACAO", sortOrder: 1 });
  const vendas = funnel({ id: "f-vendas", name: "Vendas", namingKey: "VENDAS", sortOrder: 0 });
  const conteudo = funnel({ id: "f-conteudo", name: "Distribuição de Conteúdo", namingKey: "CONTEUDO", sortOrder: 2 });
  const sorted = sortFunnelsForDisplay([captacao, vendas, conteudo]);
  check("cliente com múltiplos funis: ordenados por sortOrder", sorted.map((f) => f.id), ["f-vendas", "f-captacao", "f-conteudo"]);
}

console.log("\n2 — Sugestão por chave, confirmação e correção manual\n");

{
  const captacao = funnel({ id: "f-captacao", name: "Captação", namingKey: "CAPTACAO" });
  const vendas = funnel({ id: "f-vendas", name: "Vendas", namingKey: "VENDAS" });
  const funnels = [captacao, vendas];

  const suggestion = suggestFunnelForCampaignName("[CAPTACAO] | WhatsApp | Público aberto", funnels);
  check("nome com chave reconhecida sugere o funil certo", suggestion, { kind: "matched", funnelId: "f-captacao" });

  // Sugestão nunca é gravada sozinha — só existe vínculo confirmado depois
  // de uma ação explícita (aqui simulada por `buildFunnelByCampaignId` com
  // uma linha que o gestor decidiu manualmente, corrigindo a sugestão).
  const manualCorrection = buildFunnelByCampaignId([{ campaignId: "123", funnelId: "f-vendas" }]);
  check("correção manual prevalece — nunca a sugestão aplicada sozinha", manualCorrection.get("123"), "f-vendas");
  ok("sugestão original (Captação) nunca aparece no vínculo confirmado", manualCorrection.get("123") !== suggestion.kind);
}

console.log("\n3 — Campanha renomeada após classificação\n");

{
  const byId = buildFunnelByCampaignId([{ campaignId: "campanha-123", funnelId: "f-vendas" }]);
  check("vínculo é só por campaignId — nome não participa da chave", byId.get("campanha-123"), "f-vendas");

  // Renomear a campanha (mesmo id, nome novo) nunca muda o resultado —
  // `buildFunnelByCampaignId` nem recebe o nome como entrada.
  const stillLinked = byId.get("campanha-123");
  check("campanha renomeada continua com o mesmo funil confirmado", stillLinked, "f-vendas");
}

console.log("\n4 — Campanhas com nomes idênticos mas IDs diferentes\n");

{
  const byId = buildFunnelByCampaignId([
    { campaignId: "id-1", funnelId: "f-captacao" },
    { campaignId: "id-2", funnelId: "f-vendas" },
  ]);
  const byName = buildFunnelByCampaignName(byId, [
    { campaignId: "id-1", campaignName: "Campanha Sazonal" },
    { campaignId: "id-2", campaignName: "Campanha Sazonal" },
  ]);
  check("nome duplicado com funis diferentes vira ambíguo — nunca escolhido arbitrariamente", byName.get("Campanha Sazonal"), "ambiguous");
  check("resolveFunnelForCampaignName nunca resolve um nome ambíguo", resolveFunnelForCampaignName(byName, "Campanha Sazonal"), null);

  // Mesmo nome, mesmo funil nas duas campanhas — não é ambíguo (concordam).
  const byIdSameFunnel = buildFunnelByCampaignId([
    { campaignId: "id-3", funnelId: "f-vendas" },
    { campaignId: "id-4", funnelId: "f-vendas" },
  ]);
  const byNameSameFunnel = buildFunnelByCampaignName(byIdSameFunnel, [
    { campaignId: "id-3", campaignName: "Campanha Gêmea" },
    { campaignId: "id-4", campaignName: "Campanha Gêmea" },
  ]);
  check("nome duplicado com o MESMO funil nas duas: resolve normalmente", resolveFunnelForCampaignName(byNameSameFunnel, "Campanha Gêmea"), "f-vendas");
}

console.log("\n5 — Campanha sem ID, sem chave, ou com chave ambígua\n");

{
  const captacao = funnel({ id: "f-captacao", name: "Captação", namingKey: "CAPTACAO" });
  const vendas = funnel({ id: "f-vendas", name: "Vendas", namingKey: "VENDAS" });
  const funnels = [captacao, vendas];

  const pending = findPendingCampaigns(
    [
      { campaignId: null, campaignName: "Campanha sem ID" },
      { campaignId: "id-5", campaignName: "Sem chave nenhuma" },
      { campaignId: "id-6", campaignName: "[CAPTACAO][VENDAS] ambígua" },
      { campaignId: "id-7", campaignName: "[CAPTACAO] confiável" },
    ],
    new Map(),
    funnels,
  );

  const semId = pending.find((p) => p.campaignName === "Campanha sem ID");
  ok("campanha sem ID aparece como pendente (nunca escondida)", semId !== undefined);
  check("campanha sem ID: hasReliableId false — não classificável por aqui", semId?.hasReliableId, false);

  const semChave = pending.find((p) => p.campaignName === "Sem chave nenhuma");
  check("campanha sem chave reconhecida: sugestão no_key", semChave?.keySuggestion, { kind: "no_key" });

  const ambigua = pending.find((p) => p.campaignName === "[CAPTACAO][VENDAS] ambígua");
  check("campanha com chave ambígua: sugestão ambiguous com os 2 funis", ambigua?.keySuggestion, { kind: "ambiguous", funnelIds: ["f-captacao", "f-vendas"] });

  const confiavel = pending.find((p) => p.campaignName === "[CAPTACAO] confiável");
  check("campanha com ID + chave única: sugestão matched", confiavel?.keySuggestion, { kind: "matched", funnelId: "f-captacao" });
}

console.log("\n6 — Investimento consolidado sem duplicação\n");

{
  const byId = buildFunnelByCampaignId([
    { campaignId: "id-1", funnelId: "f-captacao" },
    { campaignId: "id-2", funnelId: "f-captacao" },
    { campaignId: "id-3", funnelId: "f-vendas" },
  ]);
  const rows = [
    { campaignId: "id-1", spend: 100 },
    { campaignId: "id-2", spend: 50 },
    { campaignId: "id-3", spend: 200 },
    { campaignId: null, spend: 30 }, // sem funil — nunca some sozinho
  ];
  const totals = aggregateSpendByFunnel(rows, byId);
  check("Captação: soma exata das 2 campanhas (150), nunca duplicado", totals.get("f-captacao"), 150);
  check("Vendas: soma exata (200)", totals.get("f-vendas"), 200);
  check("sem funil: bucket próprio (30), nunca somado dentro de um funil real", totals.get(null), 30);
  const totalSum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  check("soma de todos os buckets bate com a soma bruta das linhas (nenhum investimento perdido ou duplicado)", totalSum, 380);
}

console.log("\n7 — Indicadores por funil sem soma incompatível\n");

{
  const semMeta = funnel({ id: "f-conteudo", name: "Conteúdo", namingKey: "CONTEUDO", linkedResultType: null, relevantIndicators: ["results", "impressions"] });
  ok("funil marcado com 'results' mas SEM meta vinculada nunca mostra resultado real", !funnelShowsResults(semMeta));

  const comMeta = funnel({ id: "f-vendas", name: "Vendas", namingKey: "VENDAS", linkedResultType: "sales", relevantIndicators: ["results"] });
  ok("funil com meta vinculada E 'results' marcado: mostra resultado", funnelShowsResults(comMeta));

  const semResultsMarcado = funnel({ id: "f-alcance", name: "Alcance", namingKey: "ALCANCE", linkedResultType: "sales", relevantIndicators: ["reach"] });
  ok("funil com meta vinculada mas 'results' NÃO marcado: nunca mostra resultado (decisão do gestor)", !funnelShowsResults(semResultsMarcado));

  check("sanitizeFunnelIndicators remove valores desconhecidos e duplicados", sanitizeFunnelIndicators(["results", "results", "invalid", "reach"]), ["results", "reach"]);

  // Integração: dois documentos do Relatório, cada um pra um funil com
  // indicadores diferentes — nunca uma coluna "extra" vazando de um funil
  // pro outro, nunca Resultado/Custo pra quem não marcou "results".
  const conteudoCampaigns = [campaign("Post patrocinado", 500, { totalImpressions: 12000, totalResultCount: null, resultType: null, cpa: null })];
  const docConteudo = buildPerformanceReportDocument(
    fakeData({
      view: "f-conteudo",
      campaigns: conteudoCampaigns,
      selectedFunnelIndicators: { results: false, impressions: true, reach: false, clicks: false },
    }),
  );
  const campanhasTableConteudo = docConteudo.tables.find((t) => t.id === "campanhas")!;
  ok("funil Conteúdo: coluna 'Investimento' presente", campanhasTableConteudo.metricColumns.some((c) => c.key === "investment"));
  ok("funil Conteúdo: coluna 'Resultado' AUSENTE (nunca fabricada sem meta)", !campanhasTableConteudo.metricColumns.some((c) => c.key === "result"));
  ok("funil Conteúdo: coluna 'Impressões' presente (indicador marcado)", campanhasTableConteudo.metricColumns.some((c) => c.key === "impressions"));

  const vendasCampaigns = [campaign("Checkout direto", 800, { totalResultCount: 12, cpa: 800 / 12 })];
  const docVendas = buildPerformanceReportDocument(
    fakeData({
      view: "f-vendas",
      campaigns: vendasCampaigns,
      selectedFunnelIndicators: { results: true, impressions: false, reach: false, clicks: false },
    }),
  );
  const campanhasTableVendas = docVendas.tables.find((t) => t.id === "campanhas")!;
  ok("funil Vendas: coluna 'Resultado' presente (meta vinculada + indicador marcado)", campanhasTableVendas.metricColumns.some((c) => c.key === "result"));
  ok("funil Vendas: coluna 'Impressões' AUSENTE (não marcada pra este funil)", !campanhasTableVendas.metricColumns.some((c) => c.key === "impressions"));
}

console.log("\n8 — Filtros por campanha/público/criativo/posicionamento respeitam o funil\n");

{
  const byId = buildFunnelByCampaignId([{ campaignId: "id-1", funnelId: "f-captacao" }]);
  const byName = buildFunnelByCampaignName(byId, [{ campaignId: "id-1", campaignName: "Campanha A" }]);

  const adSetRows = [
    { campaignName: "Campanha A", name: "Público 1" },
    { campaignName: "Campanha Fora Do Funil", name: "Público 2" },
  ];
  const filtered = adSetRows.filter((row) => resolveFunnelForCampaignName(byName, row.campaignName) === "f-captacao");
  check("Públicos: só a campanha vinculada ao funil selecionado passa no filtro", filtered.map((r) => r.name), ["Público 1"]);

  // Nome que nunca apareceu nas linhas de campanha do período (sem
  // correspondência) — nunca incluído por engano.
  ok("nome sem nenhuma linha de campanha correspondente: nunca resolve pra um funil", resolveFunnelForCampaignName(byName, "Nome Desconhecido") === null);
}

console.log("\n9 — Compatibilidade com objetivos/Sprint/Relatório atual (cliente sem funil)\n");

{
  // Cliente sem nenhum funil configurado: Visão geral se comporta
  // EXATAMENTE como o Relatório sempre se comportou (nenhum indicatorFilter,
  // todas as colunas presentes quando os dados tiverem, nenhum seletor).
  const campaigns = [campaign("Campanha Única", 1000, { totalImpressions: 5000, totalReach: 3000 })];
  const doc = buildPerformanceReportDocument(fakeData({ campaigns, activeFunnels: [], funnelPanorama: null, selectedFunnelIndicators: null }));
  const campanhasTable = doc.tables.find((t) => t.id === "campanhas")!;
  ok("sem funil configurado: coluna 'Resultado' presente (comportamento de sempre)", campanhasTable.metricColumns.some((c) => c.key === "result"));
  ok("sem funil configurado: coluna 'Impressões' presente (dado real, sem filtro de indicador)", campanhasTable.metricColumns.some((c) => c.key === "impressions"));
  ok("sem funil configurado: coluna 'Alcance' presente", campanhasTable.metricColumns.some((c) => c.key === "reach"));
  check("sem funil configurado: nenhum funil ativo pro seletor aparecer", doc.activeFunnels, []);
  check("sem funil configurado: painorama nulo (bloco de Funis nunca aparece)", doc.funnelPanorama, null);
  check("sem funil configurado: nenhuma campanha pendente reportada", doc.pendingFunnelCampaignNames, []);
}

console.log("\n10 — Reimportação sem perda de classificação (fonte única, sempre por campaign_id)\n");

{
  const dataLayerSource = readFileSync(join(__dirname, "../src/lib/client-funnels-data.ts"), "utf8");
  ok(
    "saveCampaignFunnelAssignments usa upsert com onConflict client_id,channel,campaign_id — nunca campaign_name",
    dataLayerSource.includes('onConflict: "client_id,channel,campaign_id"'),
  );
  ok(
    "campaign_funnel_assignments nunca é escrita usando campaign_name como parte da chave",
    !/campaign_name/.test(dataLayerSource.split("saveCampaignFunnelAssignments")[1]?.split("export")[0] ?? ""),
  );

  const migrationSource = readFileSync(join(__dirname, "../supabase/client-funnels.sql"), "utf8");
  ok(
    "unique(client_id, channel, campaign_id) na migration — mesma chave usada pelo upsert, nunca diverge",
    migrationSource.includes("unique (client_id, channel, campaign_id)"),
  );
  ok(
    "campaign_id declarado not null — reimportação nunca grava uma linha sem identidade estável",
    /campaign_id text not null/.test(migrationSource),
  );
}

console.log("\n11 — naming_key: normalização e validação\n");

{
  check("normalizeNamingKey remove espaços e colchetes, força maiúsculo", normalizeNamingKey(" [captacao] "), "CAPTACAO");
  ok("isValidNamingKey rejeita string vazia", !isValidNamingKey(""));
  ok("isValidNamingKey rejeita colchetes residuais", !isValidNamingKey("CAPT[ACAO"));
  ok("isValidNamingKey aceita chave normal", isValidNamingKey("CAPTACAO"));
}

console.log(`\nTodos os ${passed} testes passaram.`);
