/**
 * Testes da Etapa "KOFF Analytics — Refinamento de UX e filtros globais do
 * Cockpit" (filtro global de performance, prioridade máxima do pedido).
 * Cobre: normalização do estado do filtro, filtragem das 4 linhas
 * granulares (campanha/conjunto/anúncio/posicionamento — sempre pela
 * CAMPANHA a que pertencem, nunca pelo próprio nome), isolamento entre
 * objetivos (nunca somar leads com vendas) e entre conjuntos de linhas
 * (pureza das funções — nunca misturar dado de um array com outro),
 * indisponibilidade explícita quando um indicador não pode ser recalculado
 * no escopo filtrado (grupo multicanal, alcance/frequência — sempre da
 * conta inteira), e o default dos dois gráficos de Evolução.
 *
 * Checagens estruturais via grep de código-fonte pras partes de UI que não
 * têm DOM neste ambiente (mesmo padrão das suites anteriores).
 *
 * Rodar: npx tsx scripts/test-koff-filtro-global-cockpit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCockpitFilterState,
  filterCampaignDailyRows,
  filterAdSetDailyRows,
  filterCreativeDailyRows,
  filterPlacementDailyRows,
  filterCampaignSummaries,
  isResultGroupFilterable,
  resolveFilteredExecutiveCardOverride,
  type CockpitFilterState,
} from "../src/lib/cockpit-global-filter";
import type { CampaignDailyMetricRow, CampaignSummary } from "../src/lib/campaign-analytics";
import type { AdSetDailyMetricRow } from "../src/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "../src/lib/creative-analytics";
import type { CampaignPlacementDailyMetricRow } from "../src/lib/campaign-placement-analytics";
import { resolveDefaultEvolutionSeriesId, type EvolutionSeriesOption } from "../src/lib/cockpit-evolution-merge";
import { buildMetricCardViewModels } from "../src/lib/meta-ads-dashboard/metric-cards";
import type { MetaAdsDashboardData } from "../src/lib/meta-ads-dashboard/dashboard-data";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function campaignRow(overrides: Partial<CampaignDailyMetricRow>): CampaignDailyMetricRow {
  return {
    date: "2026-10-01",
    channel: "meta",
    campaignName: "Campanha",
    campaignId: null,
    spend: 100,
    impressions: 1000,
    reach: 500,
    clicks: 10,
    linkClicks: 8,
    resultType: "leads",
    resultCount: 5,
    revenue: null,
    ...overrides,
  };
}

function adSetRow(overrides: Partial<AdSetDailyMetricRow>): AdSetDailyMetricRow {
  return {
    date: "2026-10-01",
    channel: "meta",
    campaignName: "Campanha",
    campaignId: null,
    adSetName: "Público",
    spend: 50,
    impressions: 500,
    reach: 300,
    clicks: 5,
    linkClicks: 4,
    resultType: "leads",
    resultCount: 2,
    revenue: null,
    ...overrides,
  };
}

function creativeRow(overrides: Partial<AdCreativeDailyMetricRow>): AdCreativeDailyMetricRow {
  return {
    date: "2026-10-01",
    campaignName: "Campanha",
    campaignId: null,
    creativeName: "Criativo",
    creativePermalinkUrl: null,
    previewImageUrl: null,
    spend: 20,
    impressions: 200,
    reach: 100,
    clicks: 2,
    linkClicks: 1,
    resultType: "leads",
    resultCount: 1,
    revenue: null,
    ...overrides,
  };
}

function placementRow(overrides: Partial<CampaignPlacementDailyMetricRow>): CampaignPlacementDailyMetricRow {
  return {
    date: "2026-10-01",
    channel: "meta",
    campaignName: "Campanha",
    campaignId: null,
    platformPosition: "feed",
    spend: 30,
    resultType: "leads",
    resultCount: 3,
    revenue: null,
    ...overrides,
  };
}

function campaignSummary(overrides: Partial<CampaignSummary>): CampaignSummary {
  return {
    campaignName: "Campanha",
    channel: "meta",
    totalSpend: 100,
    totalImpressions: 1000,
    totalReach: 500,
    totalClicks: 10,
    totalLinkClicks: 8,
    resultType: "leads",
    totalResultCount: 5,
    totalRevenue: null,
    cpa: null,
    cpc: null,
    ctr: null,
    cpm: null,
    linkCtr: null,
    linkCpc: null,
    roas: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — resolveCockpitFilterState: normalização (única definição de escopo)\n");
{
  ok("texto vazio/ausente nunca ativa o filtro", !resolveCockpitFilterState(undefined, undefined).isActive);
  ok("texto só com espaços também não ativa o filtro", !resolveCockpitFilterState("   ", "contains").isActive);
  ok("texto com conteúdo ativa o filtro", resolveCockpitFilterState("Estêncil", "contains").isActive);
  ok("texto é normalizado (trim + lowercase) — mesma convenção de matchesNameFilter", resolveCockpitFilterState("  Estêncil  ", "contains").text === "estêncil");
  ok("modo inválido/ausente cai pro default seguro 'contains'", resolveCockpitFilterState("x", undefined).mode === "contains");
  ok("modo 'not_contains' é preservado", resolveCockpitFilterState("x", "not_contains").mode === "not_contains");
}

// ---------------------------------------------------------------------------
console.log("\nB — filtro é SEMPRE pela campanha a que a linha pertence (nunca pelo próprio nome do conjunto/anúncio/posicionamento)\n");
{
  const inactive: CockpitFilterState = resolveCockpitFilterState(undefined, undefined);
  const active: CockpitFilterState = resolveCockpitFilterState("Estêncil", "contains");
  const notContainsActive: CockpitFilterState = resolveCockpitFilterState("Estêncil", "not_contains");

  const campaignRows = [campaignRow({ campaignName: "Campanha Estêncil" }), campaignRow({ campaignName: "Campanha Verão" })];
  ok("sem filtro ativo, campanhas não são tocadas (mesma referência de conteúdo)", filterCampaignDailyRows(campaignRows, inactive).length === 2);
  ok("'contém' mantém só a campanha cujo nome bate", filterCampaignDailyRows(campaignRows, active).length === 1 && filterCampaignDailyRows(campaignRows, active)[0].campaignName === "Campanha Estêncil");
  ok("'não contém' é o complemento exato de 'contém'", filterCampaignDailyRows(campaignRows, notContainsActive).length === 1 && filterCampaignDailyRows(campaignRows, notContainsActive)[0].campaignName === "Campanha Verão");

  // Um Público/Conjunto cujo PRÓPRIO nome não bate no texto, mas que
  // pertence à campanha filtrada, precisa ser mantido — é a campanha que
  // rege o escopo, nunca o nome da entidade (pedido explícito do usuário).
  const adSetRows = [
    adSetRow({ campaignName: "Campanha Estêncil", adSetName: "Público frio" }),
    adSetRow({ campaignName: "Campanha Verão", adSetName: "Público quente" }),
  ];
  const filteredAdSets = filterAdSetDailyRows(adSetRows, active);
  ok(
    "Conjunto mantido pela campanha a que pertence, mesmo com nome próprio diferente do texto buscado",
    filteredAdSets.length === 1 && filteredAdSets[0].adSetName === "Público frio",
  );

  const creativeRows = [
    creativeRow({ campaignName: "Campanha Estêncil", creativeName: "Vídeo A" }),
    creativeRow({ campaignName: "Campanha Verão", creativeName: "Vídeo B" }),
  ];
  const filteredCreatives = filterCreativeDailyRows(creativeRows, active);
  ok(
    "Anúncio mantido pela campanha a que pertence, mesmo com nome próprio diferente do texto buscado",
    filteredCreatives.length === 1 && filteredCreatives[0].creativeName === "Vídeo A",
  );

  const placementRows = [
    placementRow({ campaignName: "Campanha Estêncil", platformPosition: "feed" }),
    placementRow({ campaignName: "Campanha Verão", platformPosition: "stories" }),
  ];
  ok("Posicionamento também segue a mesma regra (pela campanha)", filterPlacementDailyRows(placementRows, active).length === 1);

  const summaries = [campaignSummary({ campaignName: "Campanha Estêncil" }), campaignSummary({ campaignName: "Campanha Verão" })];
  ok("Resumos de campanha (Exploração, aba Campanhas) seguem a mesma definição única de escopo", filterCampaignSummaries(summaries, active).length === 1);
}

// ---------------------------------------------------------------------------
console.log("\nC — pureza/isolamento: as funções de filtro nunca enxergam nada fora do array recebido (base do isolamento entre clientes — cada chamador já passa só as linhas do SEU cliente)\n");
{
  const active = resolveCockpitFilterState("estêncil", "contains");
  const clientARows = [campaignRow({ campaignName: "Campanha Estêncil A" })];
  const clientBRows = [campaignRow({ campaignName: "Campanha Estêncil B" })];

  const resultA = filterCampaignDailyRows(clientARows, active);
  const resultB = filterCampaignDailyRows(clientBRows, active);
  ok("filtrar as linhas do cliente A nunca retorna nenhuma linha do cliente B", resultA.every((r) => r.campaignName.endsWith("A")));
  ok("filtrar as linhas do cliente B nunca retorna nenhuma linha do cliente A", resultB.every((r) => r.campaignName.endsWith("B")));
  ok("chamar duas vezes em sequência não deixa estado vazar de uma chamada pra outra", filterCampaignDailyRows(clientARows, active).length === 1 && filterCampaignDailyRows(clientBRows, active).length === 1);

  // Mesmas linhas, filtro inativo: devolve os MESMOS dados (nenhuma cópia
  // mutada, nenhum dado perdido quando o filtro está desligado).
  const inactive = resolveCockpitFilterState(undefined, undefined);
  const untouched = filterCampaignDailyRows(clientARows, inactive);
  ok("filtro inativo devolve as linhas originais, sem nenhuma perda", untouched.length === 1 && untouched[0].campaignName === "Campanha Estêncil A");
}

// ---------------------------------------------------------------------------
console.log("\nD — isResultGroupFilterable: só um grupo 100% Meta tem granularidade de campanha pra recalcular\n");
{
  ok("grupo só Meta é recalculável", isResultGroupFilterable(["meta"]));
  ok("grupo Meta + Google NÃO é recalculável (Google não tem granularidade de campanha aqui)", !isResultGroupFilterable(["meta", "google"]));
  ok("grupo só Google NÃO é recalculável", !isResultGroupFilterable(["google"]));
  ok("grupo vazio NÃO é recalculável", !isResultGroupFilterable([]));
}

// ---------------------------------------------------------------------------
console.log("\nE — resolveFilteredExecutiveCardOverride: Resultado/Custo recalculados sem NUNCA comparar com a meta global, sem NUNCA misturar objetivos, e indisponibilidade explícita quando não é seguro calcular\n");
{
  const active = resolveCockpitFilterState("estêncil", "contains");

  const rows: CampaignDailyMetricRow[] = [
    campaignRow({ campaignName: "Campanha Estêncil", resultType: "leads", spend: 100, resultCount: 10 }),
    campaignRow({ campaignName: "Campanha Verão", resultType: "leads", spend: 200, resultCount: 20 }),
    // Linha de OUTRO objetivo na mesma campanha filtrada — nunca deve
    // entrar na soma de "leads" (isolamento entre objetivos, pedido
    // explícito: "não somar resultados incompatíveis").
    campaignRow({ campaignName: "Campanha Estêncil", resultType: "sales", spend: 999, resultCount: 999 }),
  ];

  const leadsOverride = resolveFilteredExecutiveCardOverride("leads", ["meta"], rows, active);
  ok("grupo recalculável + linhas existentes → status calculável (sem unavailableReason)", leadsOverride.unavailableReason === undefined);
  ok("soma só a campanha que bate no filtro ('Campanha Estêncil', leads) — nunca 'Campanha Verão'", leadsOverride.resultCount === 10);
  ok("nunca mistura o objetivo 'sales' da mesma campanha na soma de 'leads'", leadsOverride.resultCount !== 999 && leadsOverride.resultCount !== 1009);
  ok("nunca compara o subconjunto filtrado com a meta da carteira inteira (filteredNotice, não um número de meta)", typeof leadsOverride.filteredNotice === "string");

  const salesOverride = resolveFilteredExecutiveCardOverride("sales", ["meta"], rows, active);
  ok("objetivo 'sales' filtrado por 'estêncil' soma só a própria linha de sales (isolamento confirmado nos dois sentidos)", salesOverride.resultCount === 999);

  const noMatchOverride = resolveFilteredExecutiveCardOverride("followers", ["meta"], rows, active);
  ok(
    "objetivo sem NENHUMA linha de campanha → indisponível explícito, nunca 0 fabricado nem número global disfarçado",
    noMatchOverride.unavailableReason !== undefined && noMatchOverride.resultCount === null,
  );

  const multiChannelOverride = resolveFilteredExecutiveCardOverride("leads", ["meta", "google"], rows, active);
  ok(
    "grupo multicanal nunca é recalculado — indisponibilidade explícita em vez de um valor incompleto/global disfarçado",
    multiChannelOverride.unavailableReason !== undefined && multiChannelOverride.resultCount === null && multiChannelOverride.filteredNotice === undefined,
  );

  const emptyRowsOverride = resolveFilteredExecutiveCardOverride("leads", ["meta"], [], active);
  ok("cliente sem NENHUMA linha de campanha (sem integração Meta) → indisponível, nunca um 0 fabricado", emptyRowsOverride.unavailableReason !== undefined);
}

// ---------------------------------------------------------------------------
console.log("\nF — resolveDefaultEvolutionSeriesId: defaults resilientes (nunca um id fixo que pode não existir pro cliente/escopo)\n");
{
  const series: EvolutionSeriesOption[] = [
    { id: "goal:leads:result", label: "Leads", unit: "count", current: [] },
    { id: "results", label: "Resultados", unit: "count", current: [] },
    { id: "investment", label: "Investimento", unit: "currency", current: [] },
  ];
  ok("primeiro id preferido presente é escolhido", resolveDefaultEvolutionSeriesId(series, ["goal:leads:result", "results"]) === "goal:leads:result");
  ok("cai pro segundo preferido quando o primeiro não existe nesta lista", resolveDefaultEvolutionSeriesId(series, ["goal:sales:result", "results"]) === "results");
  ok("cai pro primeiro disponível quando NENHUM preferido existe", resolveDefaultEvolutionSeriesId(series, ["não-existe"]) === series[0].id);
  ok("lista vazia nunca quebra — devolve string vazia, nunca um id fabricado", resolveDefaultEvolutionSeriesId([], ["qualquer"]) === "");
}

// ---------------------------------------------------------------------------
console.log("\nG — buildMetricCardViewModels com filtro ativo: Alcance/Frequência (sempre da conta inteira) nunca se misturam com os demais cards já filtrados\n");
{
  const baseData: MetaAdsDashboardData = {
    client: { id: "client-1", name: "Cliente Teste" },
    metaAdAccountId: "act_123",
    comparison: {
      current: {
        period: { start: "2026-10-01", end: "2026-10-31" },
        hasAnyRecord: true,
        totals: { spend: 100, impressions: 1000, clicks: 10, linkClicks: 8, resultCount: 5, revenue: null },
        derived: { cpm: 100, ctr: 0.01, cpc: 10, linkCtr: 0.008, linkCpc: 12.5, costPerResult: 20, roas: null },
      },
      previous: null,
      spendChangePct: null,
      resultCountChangePct: null,
    },
    reachComparison: {
      current: { status: "ok", impressions: 1000, reach: 800, frequency: 1.25 },
      previous: { status: "ok", impressions: 900, reach: 700, frequency: 1.1 },
      reachChangePct: null,
      frequencyChangePct: null,
    },
    evolution: [],
    explorationCampaigns: [],
    explorationAdSetRows: [],
    explorationCreativeRows: [],
    resultSource: "meta_attributed",
    resultType: "leads",
    lastSyncAt: null,
    generatedAt: new Date().toISOString(),
  };

  const unfiltered = buildMetricCardViewModels(baseData, false);
  const reachUnfiltered = unfiltered.find((c) => c.id === "reach");
  ok("sem filtro ativo, Alcance mostra o número normalmente (comportamento de sempre, intocado)", reachUnfiltered?.value === "800");

  const filtered = buildMetricCardViewModels(baseData, true);
  const reachFiltered = filtered.find((c) => c.id === "reach");
  const frequencyFiltered = filtered.find((c) => c.id === "frequency");
  ok(
    "com filtro ativo, Alcance NUNCA mostra o número global disfarçado de filtrado — indisponibilidade explícita",
    reachFiltered?.value !== "800" && Boolean(reachFiltered?.value.toLowerCase().includes("escopo filtrado")),
  );
  ok(
    "mesma regra pra Frequência",
    frequencyFiltered?.value !== "1,25" && Boolean(frequencyFiltered?.value.toLowerCase().includes("escopo filtrado")),
  );
  ok("sem variação fabricada pra um card indisponível", reachFiltered?.comparison === null && frequencyFiltered?.comparison === null);

  const impressionsFiltered = filtered.find((c) => c.id === "impressions");
  ok(
    "os demais cards (vêm de `campaignDailyRows` já filtrado por quem chama) continuam mostrando o valor normalmente — só Alcance/Frequência são bloqueados",
    impressionsFiltered?.value === "1.000",
  );
}

// ---------------------------------------------------------------------------
console.log("\nH — checagens estruturais (UI sem DOM neste ambiente)\n");
{
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "page.tsx filtra as 4 linhas granulares ANTES de montar buildCockpitAdPerformanceData — única passada, nunca um cálculo paralelo",
    pageSource.includes("filterCampaignDailyRows(performanceReportData.campaignDailyRows, cockpitFilter)") &&
      pageSource.includes("filterCampaignSummaries(performanceReportData.campaigns, cockpitFilter)") &&
      pageSource.includes("filterAdSetDailyRows(performanceReportData.adSetDailyRows, cockpitFilter)") &&
      pageSource.includes("filterCreativeDailyRows(performanceReportData.creativeDailyRows, cockpitFilter)") &&
      /campaignDailyRows: filteredCampaignDailyRows/.test(pageSource),
  );

  ok(
    "a barra de filtro global é renderizada ANTES da Visão executiva (pedido explícito: 'local visível acima')",
    pageSource.indexOf("<CockpitGlobalFilterBar") > 0 &&
      pageSource.indexOf("<CockpitGlobalFilterBar") < pageSource.indexOf('text-overview-text-primary">Visão executiva'),
  );

  ok(
    "ordem obrigatória na grade: CockpitBudgetCard (Investimento) vem ANTES do map de Resultado/Custo",
    pageSource.indexOf("<CockpitBudgetCard") < pageSource.indexOf("resultCards.map"),
  );

  ok(
    "resultCards aplica o override filtrado (filteredNotice/unavailableReason) em vez do número global quando o filtro está ativo",
    pageSource.includes("resolveFilteredExecutiveCardOverride(group.resultType, group.channels, performanceReportData.campaignDailyRows, cockpitFilter)"),
  );

  ok(
    "séries por OBJETIVO saem inteiras da Evolução quando o filtro está ativo (não recalculáveis por campanha)",
    /cockpitFilter\.isActive\s*\?[\s\S]{0,200}adPerformanceData\.evolution/.test(pageSource),
  );

  const evolutionSource = loadSource("src", "app", "clients", "cockpit-evolution-section.tsx");
  ok(
    "Evolução sempre renderiza EXATAMENTE dois painéis (side/left+right), lado a lado no desktop",
    evolutionSource.includes('side="left"') && evolutionSource.includes('side="right"') && evolutionSource.includes("lg:grid-cols-2"),
  );
  const evolutionSourceWithoutComments = evolutionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(
    "o terceiro seletor 'Outra métrica' foi removido da UI (só sobrevive como nota histórica em comentário, nunca como opção/rótulo renderizado)",
    !evolutionSourceWithoutComments.toLowerCase().includes("outra métrica") && !evolutionSource.includes("comparisonMode"),
  );

  const explorationSource = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");
  ok(
    "as 3 abas (Campanhas|Conjuntos|Anúncios) ficam SEMPRE visíveis — não mais condicionadas a 'selectedCampaign'",
    /<nav[\s\S]{0,2000}Campanhas[\s\S]{0,2000}Conjuntos[\s\S]{0,2000}Anúncios/.test(explorationSource) &&
      !/selectedCampaign &&[\s\S]{0,50}<div className="inline-flex w-fit items-center gap-1 rounded-full border border-overview-border bg-overview-surface p-1/.test(
        explorationSource,
      ),
  );
  ok(
    "entrada direta em Conjuntos/Anúncios funciona sem campanha selecionada (agrega todas, nunca retorna vazio só por falta de escopo)",
    /adSetDailyRows\s*$/m.test(explorationSource) === false && explorationSource.includes("const scoped = selectedCampaign"),
  );
  ok(
    "linha de Conjunto/Anúncio em modo de entrada direta mostra a própria campanha (nunca ambíguo de onde veio)",
    explorationSource.includes("showCampaignNames") && explorationSource.includes("row.campaignNames.join"),
  );

  const metricCardsSource = loadSource("src", "lib", "meta-ads-dashboard", "metric-cards.ts");
  ok(
    "Alcance/Frequência nunca são somados a partir das linhas de campanha filtradas (sempre vêm de reachComparison, consulta própria de conta inteira)",
    !/reach.*sumAdditiveTotals|frequency.*sumAdditiveTotals/.test(metricCardsSource),
  );
}

console.log(`\n${passed} verificações OK.\n`);
