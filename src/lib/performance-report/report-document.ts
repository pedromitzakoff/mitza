import { formatCurrency, formatDateWithYear, formatDateTimeWithYear, formatPercent, formatShortDate } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeCostPerResult, computeRoas, type PerformanceSummary } from "@/lib/performance";
import { NO_ANALYTICS_DATA_MESSAGE, NO_CAMPAIGNS_MESSAGE, NO_CREATIVES_MESSAGE, NO_PERFORMANCE_GOAL_MESSAGE } from "@/lib/analytics-messages";
import { buildAnalyticsKpiCards, type AnalyticsKpiCard, type AnalyticsKpiComparisonTone } from "@/lib/analytics";
import type { CampaignSummary, CampaignDailyMetricRow } from "@/lib/campaign-analytics";
import type { AdSetSummary, AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import type { CreativeSummary, AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import type { PlacementSummary, CampaignPlacementDailyMetricRow } from "@/lib/campaign-placement-analytics";
import type { PerformanceReportData, PerformanceReportDailyRow, ReportFunnelPanoramaEntry, ReportView } from "./report-data";
import {
  buildCampaignBadges,
  buildPeriodReading,
  buildTargetVariationLabel,
  findBestCostCampaign,
  findHighestVolumeCampaign,
  type PeriodReading,
} from "./report-derivatives";

/**
 * Camada 2 — ESTRUTURA (KPIs + tabelas), independente de HTML/PDF. Cada
 * tabela é dado puro (nomes já formatados, `sortValue` numérico pra
 * ordenação) — NENHUM HTML pré-montado aqui (isso é 100% do renderer,
 * Camada 4, que decide como escapar/desenhar). Modular por desenho: Idade e
 * Gênero (fora de escopo nesta rodada — sem fonte de dado ainda, ver
 * auditoria) entram no futuro como mais duas entradas de `tables`/`PerformanceReportTable`,
 * sem precisar alterar este tipo nem o HTML renderer — só um novo builder
 * `buildAgeTable`/`buildGenderTable` seguindo o mesmo contrato.
 */
export interface PerformanceReportColumn {
  key: string;
  header: string;
}

export interface PerformanceReportMetricCell {
  /** Já formatado pra exibição (ex.: "R$ 4.830,68", "12,59x", "—"). */
  display: string;
  /** `null` = sempre ordena por último (dado ausente nunca "vence" nem
   * "perde" por acaso de direção). */
  sortValue: number | null;
}

export interface PerformanceReportRow {
  id: string;
  name: string;
  /** Só a tabela de Criativos preenche isso — miniatura pequena ao lado do
   * nome, nunca uma galeria (pedido explícito do usuário). */
  thumbnailUrl?: string | null;
  /** Só a tabela de Criativos preenche isso quando a coluna "Prévia" existe
   * (`hasPreviewColumn`) — `undefined`/`null` = sem link pra ESTE criativo
   * especificamente, mesmo que outros da mesma tabela tenham. */
  previewUrl?: string | null;
  /** Etapa "Resultado Diário": quando definido, o renderer mostra este
   * texto no lugar de TODAS as células de métrica (célula única, em vez de
   * uma por coluna) — usado só pra dias sem NENHUM sinal de sincronização
   * (nem investimento, nem resultado). `metrics` continua preenchido
   * normalmente mesmo nesse caso (todas as células `null`/"—"), pra
   * ordenação por coluna continuar funcionando igual — só a APRESENTAÇÃO
   * muda. Nunca usado pelas outras tabelas (uma campanha/público/criativo só
   * existe na tabela se teve alguma linha real no período, então nunca
   * "sem dado nenhum"). */
  rowNote?: string | null;
  /** Etapa "Otimização do Performance Report": só a tabela de Campanhas
   * preenche isso (`report-derivatives.ts`, `buildCampaignBadges`) — rótulos
   * curtos e discretos ("Melhor custo", "Maior volume", "Acima da meta",
   * "Abaixo da meta"), nunca mais de um por categoria (global vs. meta), e
   * NUNCA alteram `metrics`/`sortValue`/ordenação — puramente decoração da
   * linha já pronta. `undefined`/`[]` nas demais tabelas. */
  badges?: string[];
  metrics: PerformanceReportMetricCell[];
}

export interface PerformanceReportTable {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  nameColumnHeader: string;
  metricColumns: PerformanceReportColumn[];
  hasPreviewColumn: boolean;
  rows: PerformanceReportRow[];
  emptyMessage: string;
  /** `false` só na tabela de Resultado Diário (pedido explícito do usuário:
   * "quero todos os dias visíveis, não aplique progressive disclosure
   * nesta rodada") — as demais tabelas continuam com a disclosure de
   * sempre (10 linhas + "ver todas"). */
  disclosure: boolean;
  /** Linha de total — só a tabela de Resultado Diário preenche (soma das
   * aditivas, derivadas recalculadas do total, nunca média dos dias).
   * Renderizada sempre por último, fora da ordenação/disclosure das outras
   * linhas. `null` nas demais tabelas (Campanhas/Públicos/Criativos nunca
   * tiveram um total agregado pedido). */
  totalRow: PerformanceReportRow | null;
  /** `false` só na tabela de Resultado Diário (Etapa "Otimização do
   * Performance Report", item 7 — "5 itens" não agrega valor numa tabela
   * que já é sempre o período inteiro, dia a dia). As demais continuam
   * mostrando a contagem, mesmo padrão de sempre. */
  showItemCount: boolean;
  /** Etapa "Filtro por nome (contém/não contém)": `true` só nas 3 tabelas
   * nomeadas por entidade (Campanhas/Públicos/Criativos) — cada linha tem
   * um nome real (campanha/público/criativo) que faz sentido filtrar por
   * texto. `false` na tabela de Resultado Diário: linha é uma data, nunca
   * um nome livre, filtro de texto não se aplica. Filtragem em si acontece
   * 100% client-side em `ReportTableSection` (mesmo padrão da ordenação:
   * reorganiza `rows` já buscado, nunca um novo cálculo/consulta) — este
   * campo só liga/desliga a UI do filtro por tabela. */
  nameFilterable: boolean;
}

export type PerformanceReportSummaryBlock =
  | { status: "no_goal"; message: string }
  | { status: "no_data"; message: string }
  | { status: "ok"; kpis: AnalyticsKpiCard[]; note: string };

/** Etapa "Visual Polish Mobile" — resultado principal do período, pro
 * mobile dar protagonismo visual real ao que o cliente contratou (vendas,
 * leads, novos seguidores), nunca ao investimento (que é input, não
 * resultado). `value`/`label` vêm 100% de `PerformanceSummary.resultCount`
 * + `PERFORMANCE_GOALS[goal].resultMetricLabel` — os MESMOS já usados em
 * `buildAnalyticsKpiCards` pro card "result" de leads/seguidores; pra
 * vendas, aquele card nem existe hoje (a função devolve ROAS/CPA/Receita/
 * Ticket, mas nunca a contagem de vendas isolada) — `hero` preenche essa
 * lacuna só pra apresentação, sem recalcular nada. `null` nos mesmos dois
 * estados de `summary` (sem objetivo/sem dado) — nunca um resultado
 * "chutado" sem base. */
export interface PerformanceReportHero {
  value: string;
  label: string;
}

export interface PerformanceReportDocument {
  clientName: string;
  periodLabel: string;
  generatedAtLabel: string;
  totalCampaigns: number;
  totalAdSets: number;
  totalCreatives: number;
  summary: PerformanceReportSummaryBlock;
  hero: PerformanceReportHero | null;
  /** Etapa "Otimização do Performance Report" — leitura curta e
   * determinística (`report-derivatives.ts`, `buildPeriodReading`), nunca
   * texto livre/IA generativa. `null` quando não há objetivo configurado ou
   * nenhum dado no período (mesmos estados de `summary`) — sem base
   * nenhuma pra qualquer leitura. Estruturado (não mais `string[]`) desde a
   * Etapa "Visual Polish Mobile" — mesmo texto/regras de sempre, só em
   * campos nomeados pra permitir estilizar resultado/meta/destaque
   * diferente no mobile (`flattenPeriodReadingLines` devolve a mesma
   * sequência de frases de sempre pra quem não precisa disso — HTML/PDF e
   * desktop nativo). */
  periodReading: PeriodReading | null;
  tables: PerformanceReportTable[];
  /** Etapa "Filtro no topo afeta o dashboard inteiro" — passthrough de
   * `PerformanceReportData` (Camada 1), sem NENHUM formato/cálculo próprio
   * desta camada: `ReportFilterableTables` (client-side) usa isso pra
   * recalcular o Resumo do período/"Resultado Diário" só pra quem bate no
   * filtro ativo, reaproveitando `buildDailyTable`/`buildAnalyticsKpiCards`
   * — nunca uma segunda fórmula. `performanceGoal`/`period` também
   * passam adiante porque esses recálculos precisam deles (não existiam
   * neste tipo antes por não serem exibidos diretamente). */
  performanceGoal: PerformanceGoal | null;
  period: { start: string; end: string };
  campaignDailyRows: CampaignDailyMetricRow[];
  adSetDailyRows: AdSetDailyMetricRow[];
  creativeDailyRows: AdCreativeDailyMetricRow[];
  /** Etapa "Filtro por campanha afeta o Relatório inteiro" — passthrough de
   * `PerformanceReportData.placementDailyRows`, mesmo motivo dos 3 acima:
   * `ReportFilterableTables` usa isso pra reconstruir a tabela de
   * Posicionamentos filtrada por campanha quando o filtro ativo é por
   * Campanha. */
  placementDailyRows: CampaignPlacementDailyMetricRow[];
  /** Passthrough de `PerformanceReportData.conversionRate` (vendas ÷
   * carrinhos) — `null` sem carrinho registrado no período (caso comum:
   * carrinho é uma métrica secundária, só existe pra quem tem essa coluna
   * mapeada no Stract). Nunca recalculado sob filtro (ver comentário em
   * `report-data.ts`). */
  conversionRate: number | null;
  /** Etapa "Gestão de Funis Estratégicos por Cliente": qual visão este
   * documento representa — `"geral"` (conta inteira) ou o id de um funil do
   * cliente. `ReportFilterableTables` (Camada 3) é genérico o bastante pra
   * renderizar as duas: só os DADOS mudam (tabelas/KPIs já filtrados por
   * quem monta este documento), nunca um componente de corpo separado por
   * visão. */
  view: ReportView;
  /** Funis ativos do cliente — `[]` decide se o seletor aparece (cliente sem
   * nenhum funil configurado continua com o Relatório idêntico ao de
   * sempre). */
  activeFunnels: { id: string; name: string }[];
  /** Só na Visão geral com pelo menos um funil configurado — investimento
   * total + repartição por funil (só investimento é comparável entre funis
   * diferentes, nunca soma resultado). */
  funnelPanorama: { totalSpend: number; breakdown: ReportFunnelPanoramaEntry[]; unassignedSpend: number } | null;
  /** Nomes de campanha (Visão geral) sem funil confirmado — vira o badge
   * "Pendente de funil" na tabela de Campanhas, nunca escondido. `[]` sem
   * funil configurado. */
  pendingFunnelCampaignNames: string[];
  /** `true` = Públicos/Criativos/Posicionamentos da Visão por funil podem
   * estar incompletos (campanha sem id confiável ou nome ambíguo entre
   * campanhas do período) — sinalizado na descrição da tabela, nunca
   * escondido. */
  funnelFilterMayBeIncomplete: boolean;
}

// Etapa "Otimização do Performance Report": nota de metodologia reduzida a
// uma linha discreta (pedido explícito — a regra de engenharia completa
// continua documentada no código, só não ocupa mais espaço de destaque no
// relatório do cliente).
const METHODOLOGY_NOTE = "Indicadores calculados a partir dos totais consolidados do período.";

/** Rótulo de resultado/custo — como é UMA coluna compartilhada por todas as
 * linhas da tabela, usa o objetivo comum quando todas as linhas do período o
 * compartilham (caso normal); no raro caso de objetivos MISTOS (múltiplos
 * `client_goals`), cai pro rótulo genérico "Resultado"/"Custo por
 * resultado" — nunca rotula errado uma linha classificada num objetivo
 * diferente. Mesma lógica já aprovada em `report-campaigns.tsx`/
 * `report-creatives.tsx` (o Relatório interativo existente), só reaplicada
 * aqui pro renderer HTML/PDF. */
function resolveResultLabels(resultTypes: Array<PerformanceGoal | null>): { resultLabel: string; costLabel: string } {
  const distinct = new Set(resultTypes.filter((t): t is PerformanceGoal => t !== null));
  const shared = distinct.size === 1 ? PERFORMANCE_GOALS[[...distinct][0] as PerformanceGoal] : null;
  return { resultLabel: shared?.resultMetricLabel ?? "Resultado", costLabel: shared?.costMetricShortLabel ?? "Custo por resultado" };
}

function metricCell(display: string | null, sortValue: number | null): PerformanceReportMetricCell {
  return { display: display ?? "—", sortValue };
}

/**
 * Badges de Campanhas (Etapa "Otimização do Performance Report", item 5) —
 * calculados uma única vez sobre a lista inteira (`findBestCostCampaign`/
 * `findHighestVolumeCampaign`, `report-derivatives.ts`) e aplicados por
 * linha; nunca recalculado por linha, nunca altera `totalSpend`/ordenação
 * (a lista continua ordenada por investimento, mesmo critério de sempre).
 * `targetCostPerResult` vem do MESMO `PerformanceSummary` do Resumo
 * Executivo — nunca uma meta diferente pro badge "Acima/Abaixo da meta".
 */
/**
 * Etapa "Gestão de Funis Estratégicos por Cliente": badge "Pendente de
 * funil" — só quando o cliente realmente configurou algum funil
 * (`pendingCampaignNames` vem `[]` de `report-data.ts` pra quem não usa, então
 * isso nunca aparece pra quem nunca abriu a seção Funis). Campanha pendente
 * continua 100% presente na tabela (auditoria: nunca desaparece
 * silenciosamente) — só ganha esse aviso identificável.
 */
function buildPendingFunnelBadge(campaignName: string, pendingCampaignNames: string[]): string[] | undefined {
  return pendingCampaignNames.includes(campaignName) ? ["Pendente de funil"] : undefined;
}

/** Quais colunas de indicador mostrar — `undefined` (Visão geral) sempre
 * mostra tudo que os dados tiverem; um funil (Visão por funil) restringe aos
 * indicadores que o gestor marcou como relevantes pra ELE
 * (`client_funnels.relevant_indicators`) — nunca uma segunda régua por
 * tabela. "results" (Resultado/Custo, e Receita/ROAS que dependem dele) só
 * quando o funil tem `linked_result_type` E "results" está marcado
 * (`funnelShowsResults`, `lib/client-funnels.ts`) — sem isso, mesmo
 * marcado, nunca fabrica um resultado. */
export interface FunnelTableIndicatorFilter {
  results: boolean;
  impressions: boolean;
  reach: boolean;
  clicks: boolean;
}

function buildCampaignsTable(
  campaigns: CampaignSummary[],
  targetCostPerResult: number | null,
  pendingCampaignNames: string[],
  indicatorFilter?: FunnelTableIndicatorFilter,
): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(campaigns.map((c) => c.resultType));
  const showResults = indicatorFilter ? indicatorFilter.results : true;
  const hasRevenue = showResults && campaigns.some((c) => c.totalRevenue !== null);
  const hasRoas = showResults && campaigns.some((c) => c.roas !== null);
  const hasImpressions = (indicatorFilter ? indicatorFilter.impressions : true) && campaigns.some((c) => c.totalImpressions !== null);
  const hasReach = (indicatorFilter ? indicatorFilter.reach : true) && campaigns.some((c) => c.totalReach !== null);
  const hasClicks = (indicatorFilter ? indicatorFilter.clicks : true) && campaigns.some((c) => c.totalClicks !== null);
  const bestCostCampaign = findBestCostCampaign(campaigns);
  const highestVolumeCampaign = findHighestVolumeCampaign(campaigns);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    ...(showResults ? [{ key: "result", header: resultLabel }, { key: "cost", header: costLabel }] : []),
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
    ...(hasReach ? [{ key: "reach", header: "Alcance" }] : []),
    ...(hasClicks ? [{ key: "clicks", header: "Cliques" }] : []),
  ];

  const rows: PerformanceReportRow[] = campaigns.map((c) => {
    const metrics: PerformanceReportMetricCell[] = [metricCell(formatCurrency(c.totalSpend), c.totalSpend)];
    if (showResults) {
      metrics.push(metricCell(c.totalResultCount !== null ? String(c.totalResultCount) : null, c.totalResultCount));
      metrics.push(metricCell(c.cpa !== null ? formatCurrency(c.cpa) : null, c.cpa));
    }
    if (hasRevenue) metrics.push(metricCell(c.totalRevenue !== null ? formatCurrency(c.totalRevenue) : null, c.totalRevenue));
    if (hasRoas) metrics.push(metricCell(c.roas !== null ? `${c.roas.toFixed(2)}x` : null, c.roas));
    if (hasImpressions) metrics.push(metricCell(c.totalImpressions !== null ? String(c.totalImpressions) : null, c.totalImpressions));
    if (hasReach) metrics.push(metricCell(c.totalReach !== null ? String(c.totalReach) : null, c.totalReach));
    if (hasClicks) metrics.push(metricCell(c.totalClicks !== null ? String(c.totalClicks) : null, c.totalClicks));
    const badges = [
      ...(showResults ? buildCampaignBadges(c, bestCostCampaign, highestVolumeCampaign, targetCostPerResult) ?? [] : []),
      ...(buildPendingFunnelBadge(c.campaignName, pendingCampaignNames) ?? []),
    ];
    return {
      id: `${c.channel}-${c.campaignName}`,
      name: c.campaignName,
      badges: badges.length > 0 ? badges : undefined,
      metrics,
    };
  });

  return {
    id: "campanhas",
    eyebrow: "CAMPANHAS",
    title: "Campanhas",
    description: "Desempenho das campanhas no período.",
    nameColumnHeader: "Campanha",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: NO_CAMPAIGNS_MESSAGE,
    disclosure: true,
    totalRow: null,
    showItemCount: true,
    nameFilterable: true,
  };
}

export function buildAdSetsTable(adSets: AdSetSummary[], indicatorFilter?: FunnelTableIndicatorFilter): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(adSets.map((a) => a.resultType));
  const showResults = indicatorFilter ? indicatorFilter.results : true;
  const hasRevenue = showResults && adSets.some((a) => a.totalRevenue !== null);
  const hasRoas = showResults && adSets.some((a) => a.roas !== null);
  const hasImpressions = (indicatorFilter ? indicatorFilter.impressions : true) && adSets.some((a) => a.totalImpressions !== null);
  const hasReach = (indicatorFilter ? indicatorFilter.reach : true) && adSets.some((a) => a.totalReach !== null);
  const hasClicks = (indicatorFilter ? indicatorFilter.clicks : true) && adSets.some((a) => a.totalClicks !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    ...(showResults ? [{ key: "result", header: resultLabel }, { key: "cost", header: costLabel }] : []),
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
    ...(hasReach ? [{ key: "reach", header: "Alcance" }] : []),
    ...(hasClicks ? [{ key: "clicks", header: "Cliques" }] : []),
  ];

  const rows: PerformanceReportRow[] = adSets.map((a) => {
    const metrics: PerformanceReportMetricCell[] = [metricCell(formatCurrency(a.totalSpend), a.totalSpend)];
    if (showResults) {
      metrics.push(metricCell(a.totalResultCount !== null ? String(a.totalResultCount) : null, a.totalResultCount));
      metrics.push(metricCell(a.cpa !== null ? formatCurrency(a.cpa) : null, a.cpa));
    }
    if (hasRevenue) metrics.push(metricCell(a.totalRevenue !== null ? formatCurrency(a.totalRevenue) : null, a.totalRevenue));
    if (hasRoas) metrics.push(metricCell(a.roas !== null ? `${a.roas.toFixed(2)}x` : null, a.roas));
    if (hasImpressions) metrics.push(metricCell(a.totalImpressions !== null ? String(a.totalImpressions) : null, a.totalImpressions));
    if (hasReach) metrics.push(metricCell(a.totalReach !== null ? String(a.totalReach) : null, a.totalReach));
    if (hasClicks) metrics.push(metricCell(a.totalClicks !== null ? String(a.totalClicks) : null, a.totalClicks));
    return { id: `${a.channel}-${a.adSetName}`, name: a.adSetName, metrics };
  });

  return {
    id: "publicos",
    eyebrow: "PÚBLICOS",
    title: "Públicos",
    description: "Desempenho por público no período.",
    nameColumnHeader: "Público",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Dados não disponíveis neste período.",
    disclosure: true,
    totalRow: null,
    showItemCount: true,
    nameFilterable: true,
  };
}

/**
 * "Posicionamentos" — pedido explícito do usuário (comparar investimento/
 * resultado por onde o anúncio apareceu: feed, stories, reels etc.).
 * `placements` já vem agregado no TOTAL DA CONTA (`buildPlacementSummaries`,
 * `lib/campaign-placement-analytics.ts` — escopo combinado com o usuário
 * pra esta v1, nunca por campanha). `[]` quando nenhuma fonte do cliente
 * tem `platform_position_column` configurado — vira o mesmo estado vazio
 * de Públicos/Criativos, nunca uma linha fabricada. Não é `nameFilterable`
 * (posicionamento não é uma entidade nomeada como campanha/público/
 * criativo — só um punhado de valores fixos vindos da origem) e o número de
 * linhas é sempre pequeno (poucos posicionamentos possíveis), então sem
 * `disclosure` (sempre mostra tudo, mesmo tratamento de Resultado Diário).
 */
export function buildPlacementsTable(placements: PlacementSummary[], indicatorFilter?: FunnelTableIndicatorFilter): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(placements.map((p) => p.resultType));
  const showResults = indicatorFilter ? indicatorFilter.results : true;
  const hasResultShare = showResults && placements.some((p) => p.resultShare !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    ...(showResults ? [{ key: "result", header: resultLabel }, { key: "cost", header: costLabel }] : []),
    { key: "spendShare", header: "% Investimento" },
    ...(hasResultShare ? [{ key: "resultShare", header: "% Resultado" }] : []),
  ];

  const rows: PerformanceReportRow[] = placements.map((p) => {
    const metrics: PerformanceReportMetricCell[] = [metricCell(formatCurrency(p.totalSpend), p.totalSpend)];
    if (showResults) {
      metrics.push(metricCell(p.totalResultCount !== null ? String(p.totalResultCount) : null, p.totalResultCount));
      metrics.push(metricCell(p.cpa !== null ? formatCurrency(p.cpa) : null, p.cpa));
    }
    metrics.push(metricCell(formatPercent(p.spendShare * 100), p.spendShare));
    if (hasResultShare) metrics.push(metricCell(p.resultShare !== null ? formatPercent(p.resultShare * 100) : null, p.resultShare));
    return { id: p.platformPosition, name: p.platformPosition, metrics };
  });

  return {
    id: "posicionamentos",
    eyebrow: "POSICIONAMENTOS",
    title: "Posicionamentos",
    description: "Investimento e resultado por posicionamento do anúncio no período.",
    nameColumnHeader: "Posicionamento",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Dados não disponíveis neste período.",
    disclosure: false,
    totalRow: null,
    showItemCount: true,
    nameFilterable: false,
  };
}

export function buildCreativesTable(creatives: CreativeSummary[], indicatorFilter?: FunnelTableIndicatorFilter): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(creatives.map((c) => c.resultType));
  const showResults = indicatorFilter ? indicatorFilter.results : true;
  const hasCtr = showResults && creatives.some((c) => c.ctr !== null);
  const hasCpc = creatives.some((c) => c.cpc !== null);
  const hasRevenue = showResults && creatives.some((c) => c.totalRevenue !== null);
  const hasRoas = showResults && creatives.some((c) => c.roas !== null);
  const hasImpressions = (indicatorFilter ? indicatorFilter.impressions : true) && creatives.some((c) => c.totalImpressions !== null);
  const hasReach = (indicatorFilter ? indicatorFilter.reach : true) && creatives.some((c) => c.totalReach !== null);
  const hasAnyPermalink = creatives.some((c) => c.permalinkUrl !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    ...(showResults ? [{ key: "result", header: resultLabel }, { key: "cost", header: costLabel }] : []),
    ...(hasCtr ? [{ key: "ctr", header: "CTR" }] : []),
    ...(hasCpc ? [{ key: "cpc", header: "CPC" }] : []),
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
    ...(hasReach ? [{ key: "reach", header: "Alcance" }] : []),
  ];

  const rows: PerformanceReportRow[] = creatives.map((c) => {
    const metrics: PerformanceReportMetricCell[] = [metricCell(formatCurrency(c.totalSpend), c.totalSpend)];
    if (showResults) {
      metrics.push(metricCell(c.totalResultCount !== null ? String(c.totalResultCount) : null, c.totalResultCount));
      metrics.push(metricCell(c.cpa !== null ? formatCurrency(c.cpa) : null, c.cpa));
    }
    if (hasCtr) metrics.push(metricCell(c.ctr !== null ? formatPercent(c.ctr * 100) : null, c.ctr));
    if (hasCpc) metrics.push(metricCell(c.cpc !== null ? formatCurrency(c.cpc) : null, c.cpc));
    if (hasRevenue) metrics.push(metricCell(c.totalRevenue !== null ? formatCurrency(c.totalRevenue) : null, c.totalRevenue));
    if (hasRoas) metrics.push(metricCell(c.roas !== null ? `${c.roas.toFixed(2)}x` : null, c.roas));
    if (hasImpressions) metrics.push(metricCell(c.totalImpressions !== null ? String(c.totalImpressions) : null, c.totalImpressions));
    if (hasReach) metrics.push(metricCell(c.totalReach !== null ? String(c.totalReach) : null, c.totalReach));
    return { id: c.creativeName, name: c.creativeName, thumbnailUrl: c.previewImageUrl, previewUrl: c.permalinkUrl, metrics };
  });

  return {
    id: "criativos",
    eyebrow: "CRIATIVOS",
    title: "Criativos",
    description: "Desempenho por criativo, com miniatura e link quando disponíveis.",
    nameColumnHeader: "Criativo",
    metricColumns,
    hasPreviewColumn: hasAnyPermalink,
    rows,
    emptyMessage: NO_CREATIVES_MESSAGE,
    disclosure: true,
    totalRow: null,
    showItemCount: true,
    nameFilterable: true,
  };
}

/**
 * Resultado Diário — uma linha por dia civil do período (já preenchido pra
 * TODOS os dias por `buildDailyRows`, `report-data.ts`; nunca recorta aqui).
 * "Resultado"/"Custo por resultado" usam o MESMO objetivo do cliente do
 * Resumo Executivo (`performanceGoal`) — nunca uma segunda definição de
 * resultado principal. Receita/ROAS só aparecem quando pelo menos um dia
 * tiver o dado (mesmo padrão `hasRevenue`/`hasRoas` das outras 3 tabelas).
 *
 * Dias sem NENHUM sinal (nem investimento, nem resultado) ganham
 * `rowNote: "Sem dados"` — só quando os dois lados são genuinamente
 * desconhecidos (nunca quando há investimento real mas só falta o
 * resultado, ou vice-versa: nesse caso cada célula mostra seu próprio
 * valor/"—" normalmente, mesmo padrão de qualquer métrica ausente no resto
 * do relatório).
 *
 * Total: aditivas somadas ignorando dias sem dado (nunca contam como zero),
 * derivadas recalculadas do total via os MESMOS helpers canônicos
 * (`computeCostPerResult`/`computeRoas`) — nunca média dos dias. Este total
 * reconcilia exatamente com o Resumo Executivo pra investimento/resultado/
 * receita, porque vem das MESMAS linhas de origem (`ClientAnalyticsData`),
 * só reagrupadas por data em vez de somadas direto — ver
 * `scripts/test-performance-report-daily.ts`.
 */
/** Exportada (Etapa "Filtro no topo afeta o dashboard inteiro") — o
 * client-side `ReportFilterableTables` reaproveita esta MESMA função pra
 * montar "Resultado Diário" a partir de linhas recalculadas (via
 * `recomputeDailyRows`, `report-filter-recompute.ts`) quando o filtro do
 * topo está ativo — nunca uma segunda formatação/coluna/total pra essa
 * tabela. */
export function buildDailyTable(daily: PerformanceReportDailyRow[], performanceGoal: PerformanceGoal | null): PerformanceReportTable {
  const config = performanceGoal ? PERFORMANCE_GOALS[performanceGoal] : null;
  const resultLabel = config?.resultMetricLabel ?? "Resultado";
  const costLabel = config?.costMetricShortLabel ?? "Custo por resultado";
  const hasRevenue = daily.some((d) => d.revenue !== null);
  const hasRoas = daily.some((d) => d.roas !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    { key: "result", header: resultLabel },
    { key: "cost", header: costLabel },
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
  ];

  function buildMetrics(spend: number | null, resultCount: number | null, costPerResult: number | null, revenue: number | null, roas: number | null): PerformanceReportMetricCell[] {
    const metrics: PerformanceReportMetricCell[] = [
      metricCell(spend !== null ? formatCurrency(spend) : null, spend),
      metricCell(resultCount !== null ? String(resultCount) : null, resultCount),
      metricCell(costPerResult !== null ? formatCurrency(costPerResult) : null, costPerResult),
    ];
    if (hasRevenue) metrics.push(metricCell(revenue !== null ? formatCurrency(revenue) : null, revenue));
    if (hasRoas) metrics.push(metricCell(roas !== null ? `${roas.toFixed(2)}x` : null, roas));
    return metrics;
  }

  const rows: PerformanceReportRow[] = daily.map((d) => {
    const hasNoSignalAtAll = d.spend === null && d.resultCount === null;
    return {
      id: d.date,
      name: formatShortDate(d.date),
      rowNote: hasNoSignalAtAll ? "Sem dados" : null,
      metrics: buildMetrics(d.spend, d.resultCount, d.costPerResult, d.revenue, d.roas),
    };
  });

  // Total — aditivas somadas (dias sem dado nunca contam como 0 na soma),
  // derivadas recalculadas do total.
  const daysWithSpend = daily.filter((d) => d.spend !== null);
  const totalSpend = daysWithSpend.length > 0 ? daysWithSpend.reduce((sum, d) => sum + d.spend!, 0) : null;

  const daysWithResult = daily.filter((d) => d.resultCount !== null);
  const totalResultCount = daysWithResult.length > 0 ? daysWithResult.reduce((sum, d) => sum + d.resultCount!, 0) : null;

  const daysWithRevenue = daily.filter((d) => d.revenue !== null);
  const totalRevenue = daysWithRevenue.length > 0 ? daysWithRevenue.reduce((sum, d) => sum + d.revenue!, 0) : null;

  const totalCostPerResult = computeCostPerResult(totalSpend, totalResultCount ?? 0, totalResultCount !== null);
  const totalRoas = computeRoas(totalRevenue, totalSpend);

  const totalRow: PerformanceReportRow = {
    id: "total",
    name: "Total",
    metrics: buildMetrics(totalSpend, totalResultCount, totalCostPerResult, totalRevenue, totalRoas),
  };

  return {
    id: "resultado-diario",
    eyebrow: "RESULTADO DIÁRIO",
    title: "Resultado diário",
    description: "Investimento e resultado de cada dia do período.",
    nameColumnHeader: "Data",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Nenhum dado disponível para os dias do período selecionado.",
    disclosure: false,
    totalRow,
    // Etapa "Otimização do Performance Report", item 7: a contagem de itens
    // não agrega valor numa tabela que já é sempre "todo o período, dia a
    // dia" — omitida só aqui, a estrutura de dados (`rows`) continua igual.
    showItemCount: false,
    // Cada linha aqui é uma data (`formatShortDate`), nunca um nome livre de
    // campanha/público/criativo — filtro de texto não se aplica.
    nameFilterable: false,
  };
}

/** Enriquece o card de custo (`key: "cost"`, sempre o único que
 * `buildAnalyticsKpiCards` popula com "Meta: R$X") com a variação
 * percentual — nunca recalcula a meta nem o custo, só troca o texto de
 * exibição usando `performanceSummary.comparison`/`targetCostPerResult`,
 * já canônicos. `tone` reaproveita `comparison.status` (mesma classificação
 * de `getPerformanceStatus`, ±10% de margem) — nunca uma segunda régua de
 * "isso está bom ou ruim". */
function enrichCostKpiWithTargetVariation(kpis: AnalyticsKpiCard[], performanceSummary: PerformanceSummary): AnalyticsKpiCard[] {
  const variationText = buildTargetVariationLabel(performanceSummary.comparison, performanceSummary.targetCostPerResult);
  if (!variationText) return kpis;

  const tone: AnalyticsKpiComparisonTone =
    performanceSummary.comparison.status === "worse" ? "negative" : performanceSummary.comparison.status === "better" ? "positive" : "neutral";

  return kpis.map((kpi) => (kpi.key === "cost" ? { ...kpi, comparison: { text: variationText, tone } } : kpi));
}

/** Nota mostrada quando um funil real tem dado no período mas
 * deliberadamente não tem meta de resultado vinculada (ex.: Distribuição de
 * Conteúdo) — nunca a mesma mensagem de "sem objetivo configurado", que
 * sugeriria uma lacuna a corrigir em vez de uma escolha do gestor. */
const FUNNEL_INVESTMENT_ONLY_NOTE = "Este funil não tem uma meta de resultado vinculada — mostrando apenas investimento.";

function buildSummaryBlock(data: PerformanceReportData): PerformanceReportSummaryBlock {
  if (data.summary.status === "no_goal") return { status: "no_goal", message: NO_PERFORMANCE_GOAL_MESSAGE };
  if (data.summary.status === "no_data") return { status: "no_data", message: NO_ANALYTICS_DATA_MESSAGE };
  if (data.summary.status === "investment_only") {
    const kpis = buildAnalyticsKpiCards(null, data.summary.totalSpend, null, null, formatCurrency);
    return { status: "ok", kpis, note: FUNNEL_INVESTMENT_ONLY_NOTE };
  }
  const kpis = enrichCostKpiWithTargetVariation(data.summary.kpis, data.summary.performanceSummary);
  return { status: "ok", kpis, note: METHODOLOGY_NOTE };
}

/** `null` sem objetivo configurado ou sem dado no período — mesmos dois
 * estados de `buildSummaryBlock`. `resultCount`/`resultMetricLabel` já
 * existem em `PerformanceSummary`/`PERFORMANCE_GOALS` (canônicos, os
 * mesmos usados em `buildAnalyticsKpiCards`) — nenhum cálculo novo, só a
 * seleção do que já existe. */
function buildHero(data: PerformanceReportData): PerformanceReportHero | null {
  if (data.summary.status !== "ok" || !data.performanceGoal) return null;
  return {
    value: String(data.summary.performanceSummary.resultCount),
    label: PERFORMANCE_GOALS[data.performanceGoal].resultMetricLabel,
  };
}

/** `null` sem objetivo configurado ou sem dado no período — mesmos dois
 * estados de `buildSummaryBlock`, nenhuma leitura possível sem base
 * (`report-derivatives.ts`, `buildPeriodReading`). */
function buildPeriodReadingForDocument(data: PerformanceReportData): PeriodReading | null {
  if (data.summary.status !== "ok" || !data.performanceGoal) return null;
  return buildPeriodReading({
    performanceGoal: data.performanceGoal,
    performanceSummary: data.summary.performanceSummary,
    campaigns: data.campaigns,
  });
}

export function buildPerformanceReportDocument(data: PerformanceReportData): PerformanceReportDocument {
  const targetCostPerResult = data.summary.status === "ok" ? data.summary.performanceSummary.targetCostPerResult : null;
  // `undefined` na Visão geral (sempre mostra tudo que os dados tiverem,
  // comportamento intocado) — `selectedFunnelIndicators` já vem resolvido
  // pela Camada 1 (`report-data.ts`) a partir de `client_funnels.relevant_indicators`
  // do funil selecionado, nunca recalculado aqui.
  const indicatorFilter: FunnelTableIndicatorFilter | undefined = data.selectedFunnelIndicators ?? undefined;

  const tables: PerformanceReportTable[] = [
    buildDailyTable(data.dailyRows, data.performanceGoal),
    buildCampaignsTable(data.campaigns, targetCostPerResult, data.pendingFunnelCampaignNames, indicatorFilter),
    buildAdSetsTable(data.adSets, indicatorFilter),
    buildCreativesTable(data.creatives, indicatorFilter),
    buildPlacementsTable(data.placements, indicatorFilter),
  ];

  return {
    clientName: data.client.name,
    periodLabel: `${formatDateWithYear(data.period.start)} → ${formatDateWithYear(data.period.end)}`,
    generatedAtLabel: formatDateTimeWithYear(data.generatedAt),
    totalCampaigns: data.campaigns.length,
    totalAdSets: data.adSets.length,
    totalCreatives: data.creatives.length,
    summary: buildSummaryBlock(data),
    hero: buildHero(data),
    periodReading: buildPeriodReadingForDocument(data),
    // Ordem = ordem de renderização: Resultado Diário → Campanhas →
    // Públicos → Criativos → Posicionamentos (Resumo Executivo é
    // renderizado à parte, fora deste array, por quem consome o
    // documento).
    tables,
    performanceGoal: data.performanceGoal,
    period: { start: data.period.start, end: data.period.end },
    campaignDailyRows: data.campaignDailyRows,
    adSetDailyRows: data.adSetDailyRows,
    creativeDailyRows: data.creativeDailyRows,
    placementDailyRows: data.placementDailyRows,
    conversionRate: data.conversionRate,
    view: data.view,
    activeFunnels: data.activeFunnels,
    funnelPanorama: data.funnelPanorama,
    pendingFunnelCampaignNames: data.pendingFunnelCampaignNames,
    funnelFilterMayBeIncomplete: data.funnelFilterMayBeIncomplete,
  };
}
