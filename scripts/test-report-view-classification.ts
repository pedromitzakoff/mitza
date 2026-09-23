/**
 * Testes da Etapa "Separar o Relatório por finalidade das campanhas".
 *
 * Cobre: 1) núcleo puro de classificação (`lib/report-view-classification.ts`)
 * — resolução de visão, ponte por nome, ambiguidade; 2) Camada 2
 * (`report-document.ts`) — tabelas da visão "secundario" nunca mostram
 * Resultado/Custo, badge "Não classificada" só quando aplicável, consolidado
 * secundário só soma investimento; 3) as garantias de consistência do
 * pedido original (seção 5): campanha nunca aparece nas duas visões ao
 * mesmo tempo, campanha sem classificação nunca desaparece.
 *
 * Rodar: npx tsx scripts/test-report-view-classification.ts
 */
import assert from "node:assert/strict";
import {
  buildPurposeByCampaignId,
  buildPurposeByCampaignName,
  isConfidentlySecondaryByName,
  resolveReportView,
  REPORT_PURPOSE_CONFIG,
  REPORT_PURPOSE_OPTIONS,
  type ReportCampaignPurpose,
} from "../src/lib/report-view-classification";
import { buildPerformanceReportDocument } from "../src/lib/performance-report/report-document";
import type { PerformanceReportData } from "../src/lib/performance-report/report-data";
import type { CampaignSummary } from "../src/lib/campaign-analytics";
import type { AdSetSummary } from "../src/lib/ad-set-analytics";
import type { CreativeSummary } from "../src/lib/creative-analytics";
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

// ---------------------------------------------------------------------------
console.log("1 — resolveReportView: leads/sales são 'principal', o resto é 'secundario'\n");
{
  check("leads -> principal", resolveReportView("leads"), "principal");
  check("sales -> principal", resolveReportView("sales"), "principal");
  for (const p of ["awareness", "reach", "followers", "profile_visits", "traffic"] as ReportCampaignPurpose[]) {
    check(`${p} -> secundario`, resolveReportView(p), "secundario");
  }
  check("REPORT_PURPOSE_OPTIONS tem as 7 finalidades, nenhuma a mais/a menos", REPORT_PURPOSE_OPTIONS.length, 7);
}

// ---------------------------------------------------------------------------
console.log("\n2 — buildPurposeByCampaignId: direto da tabela, chave é campaignId\n");
{
  const map = buildPurposeByCampaignId([
    { campaignId: "c1", purpose: "leads" },
    { campaignId: "c2", purpose: "awareness" },
  ]);
  check("c1 -> leads", map.get("c1"), "leads");
  check("c2 -> awareness", map.get("c2"), "awareness");
  check("campanha nunca classificada não existe no mapa (nunca um valor default)", map.has("c3"), false);
}

// ---------------------------------------------------------------------------
console.log("\n3 — buildPurposeByCampaignName: ponte por nome, nunca escolhe arbitrariamente em caso de ambiguidade\n");
{
  const purposeByCampaignId = buildPurposeByCampaignId([
    { campaignId: "c1", purpose: "awareness" },
    { campaignId: "c2", purpose: "traffic" },
    { campaignId: "c3", purpose: "leads" },
  ]);

  const byName = buildPurposeByCampaignName(purposeByCampaignId, [
    { campaignId: "c1", campaignName: "Campanha Awareness" },
    { campaignId: "c3", campaignName: "Campanha Leads" },
    { campaignId: null, campaignName: "Sem ID" }, // fonte sem campaign_id_column — nunca classificável.
    { campaignId: "c4", campaignName: "Não classificada" }, // campanha real, sem linha em classifications.
  ]);

  check("nome resolve pro purpose do id correspondente", byName.get("Campanha Awareness"), "awareness");
  check("nome resolve pro purpose do id correspondente (leads)", byName.get("Campanha Leads"), "leads");
  ok("campanha sem campaignId nunca entra no lookup por nome", !byName.has("Sem ID"));
  ok("campanha com campaignId mas sem classificação nunca entra no lookup por nome", !byName.has("Não classificada"));

  // Mesmo nome, dois ids DIFERENTES com finalidades DIFERENTES no período —
  // nunca escolhe uma das duas, vira "ambiguous".
  const ambiguousByName = buildPurposeByCampaignName(purposeByCampaignId, [
    { campaignId: "c1", campaignName: "Campanha Duplicada" }, // awareness
    { campaignId: "c2", campaignName: "Campanha Duplicada" }, // traffic
  ]);
  check("mesmo nome, finalidades diferentes -> ambiguous (nunca uma escolha arbitrária)", ambiguousByName.get("Campanha Duplicada"), "ambiguous");

  // Mesmo nome, MESMO purpose duas vezes (campanha pausada e recriada com o
  // mesmo id/purpose) — nunca vira "ambiguous" por engano.
  const consistentByName = buildPurposeByCampaignName(purposeByCampaignId, [
    { campaignId: "c1", campaignName: "Campanha Repetida" },
    { campaignId: "c1", campaignName: "Campanha Repetida" },
  ]);
  check("mesmo nome, mesma finalidade repetida -> nunca vira ambiguous", consistentByName.get("Campanha Repetida"), "awareness");
}

// ---------------------------------------------------------------------------
console.log("\n4 — isConfidentlySecondaryByName: só true pra finalidade secundária SEM ambiguidade\n");
{
  const byName = new Map<string, ReportCampaignPurpose | "ambiguous">([
    ["Awareness", "awareness"],
    ["Leads", "leads"],
    ["Ambígua", "ambiguous"],
  ]);
  ok("finalidade secundária, sem ambiguidade -> true", isConfidentlySecondaryByName(byName, "Awareness"));
  ok("finalidade principal (leads) -> false (nunca tratada como secundária)", !isConfidentlySecondaryByName(byName, "Leads"));
  ok("ambígua -> false (nunca tratada como secundária só porque uma das duas era)", !isConfidentlySecondaryByName(byName, "Ambígua"));
  ok("nome desconhecido (nunca classificado) -> false", !isConfidentlySecondaryByName(byName, "Nunca vista"));
}

// ---------------------------------------------------------------------------
// Camada 2 — fixtures compartilhadas
// ---------------------------------------------------------------------------
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
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
    cpa: null,
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
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
    cpa: null,
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
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
    cpa: null,
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
    summary: { status: "ok", kpis: [], performanceSummary: NEUTRAL_PERFORMANCE_SUMMARY },
    performanceGoal: "leads",
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
console.log("\n5 — Visão 'secundario': Campanhas nunca mostra Resultado/Custo, só Investimento + Impressões/Alcance/Cliques\n");
{
  const doc = buildPerformanceReportDocument(
    fakeData({
      view: "secundario",
      campaigns: [campaign("Awareness A", 100, { totalImpressions: 5000 }), campaign("Alcance B", 50, { totalReach: 2000 })],
      campaignPurposeByName: { "Awareness A": "awareness", "Alcance B": "reach" },
      secondarySummary: { totalSpend: 150, breakdown: [{ purpose: "awareness", label: "Reconhecimento", spend: 100 }, { purpose: "reach", label: "Alcance", spend: 50 }] },
    }),
  );
  const table = doc.tables.find((t) => t.id === "campanhas-secundarias")!;
  const columnKeys = table.metricColumns.map((c) => c.key);
  ok("coluna 'result'/'cost' NUNCA existe na visão secundário", !columnKeys.includes("result") && !columnKeys.includes("cost"));
  ok("coluna Impressões existe (pelo menos uma campanha tem)", columnKeys.includes("impressions"));
  ok("coluna Alcance existe (pelo menos uma campanha tem)", columnKeys.includes("reach"));
  const awarenessRow = table.rows.find((r) => r.name === "Awareness A")!;
  check("badge da linha é a finalidade (Reconhecimento)", awarenessRow.badges, ["Reconhecimento"]);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Visão 'secundario': nunca uma tabela de Resultado Diário (não existe resultado único combinável)\n");
{
  const doc = buildPerformanceReportDocument(fakeData({ view: "secundario" }));
  ok("nenhuma tabela 'resultado-diario' na visão secundário", !doc.tables.some((t) => t.id === "resultado-diario"));
  check("4 tabelas na visão secundário (Campanhas/Públicos/Criativos/Posicionamentos, nunca Resultado Diário)", doc.tables.length, 4);
}

// ---------------------------------------------------------------------------
console.log("\n7 — Visão 'secundario': consolidado só soma investimento, nunca impressões/alcance/cliques combinados\n");
{
  const doc = buildPerformanceReportDocument(
    fakeData({
      view: "secundario",
      secondarySummary: {
        totalSpend: 300,
        breakdown: [
          { purpose: "awareness", label: "Reconhecimento", spend: 200 },
          { purpose: "reach", label: "Alcance", spend: 100 },
        ],
      },
    }),
  );
  check("totalSpend é a soma exata do breakdown (200+100)", doc.secondarySummary!.totalSpend, 300);
  ok("secondarySummary nunca carrega um campo de 'resultado'/'impressões total' combinado", !("resultCount" in doc.secondarySummary!) && !("totalImpressions" in doc.secondarySummary!));
}

// ---------------------------------------------------------------------------
console.log("\n8 — Visão 'principal': badge 'Não classificada' só quando hasSecondaryCampaigns E a campanha não tem classificação\n");
{
  const docWithSecondary = buildPerformanceReportDocument(
    fakeData({
      view: "principal",
      hasSecondaryCampaigns: true,
      campaigns: [campaign("Leads A", 100, { resultType: "leads", totalResultCount: 10, cpa: 10 }), campaign("Sem classificação", 50)],
      unclassifiedCampaignNames: ["Sem classificação"],
    }),
  );
  const table1 = docWithSecondary.tables.find((t) => t.id === "campanhas")!;
  const classifiedRow = table1.rows.find((r) => r.name === "Leads A")!;
  const unclassifiedRow = table1.rows.find((r) => r.name === "Sem classificação")!;
  ok("campanha classificada não ganha o badge", !(classifiedRow.badges ?? []).includes("Não classificada"));
  ok("campanha sem classificação ganha o badge, mas CONTINUA na tabela (nunca desaparece)", (unclassifiedRow.badges ?? []).includes("Não classificada"));

  const docWithoutSecondary = buildPerformanceReportDocument(
    fakeData({
      view: "principal",
      hasSecondaryCampaigns: false,
      campaigns: [campaign("Qualquer", 50)],
      unclassifiedCampaignNames: [], // report-data.ts sempre devolve [] quando hasSecondaryCampaigns é false.
    }),
  );
  const table2 = docWithoutSecondary.tables.find((t) => t.id === "campanhas")!;
  ok("cliente que nunca usa a separação nunca vê o badge (Relatório idêntico ao de sempre)", !(table2.rows[0].badges ?? []).includes("Não classificada"));
}

// ---------------------------------------------------------------------------
console.log("\n9 — Visão 'principal' continua com as colunas/Resultado Diário de sempre, agora só com Alcance/Cliques a mais quando aplicável\n");
{
  const doc = buildPerformanceReportDocument(
    fakeData({
      view: "principal",
      dailyRows: [{ date: "2026-08-01", spend: 100, resultCount: 5, revenue: null, costPerResult: 20, roas: null }],
      campaigns: [campaign("C", 100, { resultType: "leads", totalResultCount: 5, cpa: 20, totalReach: 300, totalClicks: 40 })],
    }),
  );
  ok("tabela 'resultado-diario' continua existindo na visão principal", doc.tables.some((t) => t.id === "resultado-diario"));
  const table = doc.tables.find((t) => t.id === "campanhas")!;
  const columnKeys = table.metricColumns.map((c) => c.key);
  ok("coluna 'result'/'cost' continuam existindo na visão principal (nunca removidas)", columnKeys.includes("result") && columnKeys.includes("cost"));
  ok("coluna Alcance aparece quando a campanha tem o dado (aditivo, nunca substitui nada)", columnKeys.includes("reach"));
  ok("coluna Cliques aparece quando a campanha tem o dado", columnKeys.includes("clicks"));
}

// ---------------------------------------------------------------------------
console.log("\n10 — Consistência: mesma campanha nunca aparece classificada em duas finalidades ao mesmo tempo (garantia do schema)\n");
{
  // client_campaign_goal_assignments/campaign_report_classifications são
  // ambas unique(client_id, channel, campaign_id) — uma linha só, nunca
  // duas finalidades simultâneas pra mesma campanha. Aqui, a garantia
  // equivalente em memória: o lookup por id é um Map (1 valor por chave).
  const map = buildPurposeByCampaignId([
    { campaignId: "c1", purpose: "leads" },
    { campaignId: "c1", purpose: "awareness" }, // "reclassificação" — última sobrescreve, nunca as duas coexistem.
  ]);
  check("última classificação da mesma campanha vence — nunca duas ao mesmo tempo", map.get("c1"), "awareness");
  check("mapa tem só 1 entrada pra c1, nunca 2", map.size, 1);
}

console.log(`\n${passed} verificações passaram.`);
