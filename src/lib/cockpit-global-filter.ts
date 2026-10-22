import type { CampaignDailyMetricRow } from "./campaign-analytics";
import type { AdSetDailyMetricRow } from "./ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "./creative-analytics";
import type { CampaignPlacementDailyMetricRow } from "./campaign-placement-analytics";
import type { CampaignSummary } from "./campaign-analytics";
import type { PerformanceGoal } from "./performance-goals";
import type { PerformanceSummary } from "./performance";
import type { TrafficChannel } from "./traffic-channels";
import { matchesNameFilter, recomputeFilteredSummary, type NameFilterMode, type FilterableDailyRow } from "./performance-report/report-filter-recompute";

/**
 * KOFF Analytics — "Refinamento de UX e filtros globais do Cockpit" (pedido
 * explícito do usuário: "o filtro de texto 'contém' deve passar a ser um
 * filtro GLOBAL do Cockpit, não apenas da tabela"). Definição ÚNICA de
 * escopo — todo componente do Cockpit que precisa saber "o filtro está
 * ativo? com qual texto/operador?" lê daqui, nunca uma segunda
 * implementação local.
 *
 * Reaproveita INTEGRALMENTE `matchesNameFilter`/`recomputeFilteredSummary`
 * (`lib/performance-report/report-filter-recompute.ts`, já validados pelo
 * filtro do `/relatorio`, mesma etapa "Filtro no topo afeta o dashboard
 * inteiro") — nenhuma segunda fórmula de filtro/recálculo criada aqui, só
 * a camada de adaptação pro Cockpit (campanha é sempre a chave de
 * agrupamento do filtro global, nunca o nome de um conjunto/anúncio
 * individual — ver auditoria desta etapa: só as tabelas granulares têm
 * `campaign_name`; `daily_performance`/`performance_records`, fonte da
 * Visão executiva, não têm NENHUMA coluna de campanha).
 */

export interface CockpitFilterState {
  /** Texto já normalizado (trim + lowercase) — "" significa "sem filtro
   * ativo" (mesma convenção de `matchesNameFilter`). */
  text: string;
  mode: NameFilterMode;
  /** `true` só quando `text !== ""` — qualquer componente que precise saber
   * "estou em modo filtrado?" lê este campo, nunca `text !== ""` solto
   * (única definição, nunca duas checagens que podem divergir). */
  isActive: boolean;
}

export function resolveCockpitFilterState(rawText: string | undefined, rawMode: string | undefined): CockpitFilterState {
  const text = (rawText ?? "").trim().toLowerCase();
  const mode: NameFilterMode = rawMode === "not_contains" ? "not_contains" : "contains";
  return { text, mode, isActive: text !== "" };
}

function matchesCampaign(campaignName: string, filter: CockpitFilterState): boolean {
  return matchesNameFilter(campaignName, filter.mode, filter.text);
}

/** Campanha é SEMPRE a chave do filtro global (pedido do usuário: "se eu
 * filtrar campanhas cujo nome contém... toda a página deve refletir
 * somente essas campanhas") — Conjuntos/Anúncios/Posicionamentos são
 * filtrados pela campanha a que PERTENCEM (`row.campaignName`), nunca pelo
 * próprio nome do conjunto/anúncio — isso é o que faz o filtro ser
 * consistente entre as 3 abas de Exploração e os gráficos/indicadores. */
export function filterCampaignDailyRows(rows: CampaignDailyMetricRow[], filter: CockpitFilterState): CampaignDailyMetricRow[] {
  if (!filter.isActive) return rows;
  return rows.filter((row) => matchesCampaign(row.campaignName, filter));
}

export function filterAdSetDailyRows(rows: AdSetDailyMetricRow[], filter: CockpitFilterState): AdSetDailyMetricRow[] {
  if (!filter.isActive) return rows;
  return rows.filter((row) => matchesCampaign(row.campaignName, filter));
}

export function filterCreativeDailyRows(rows: AdCreativeDailyMetricRow[], filter: CockpitFilterState): AdCreativeDailyMetricRow[] {
  if (!filter.isActive) return rows;
  return rows.filter((row) => matchesCampaign(row.campaignName, filter));
}

export function filterPlacementDailyRows(rows: CampaignPlacementDailyMetricRow[], filter: CockpitFilterState): CampaignPlacementDailyMetricRow[] {
  if (!filter.isActive) return rows;
  return rows.filter((row) => matchesCampaign(row.campaignName, filter));
}

export function filterCampaignSummaries(rows: CampaignSummary[], filter: CockpitFilterState): CampaignSummary[] {
  if (!filter.isActive) return rows;
  return rows.filter((row) => matchesCampaign(row.campaignName, filter));
}

function toFilterableRows(rows: CampaignDailyMetricRow[]): FilterableDailyRow[] {
  return rows.map((row) => ({ date: row.date, name: row.campaignName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
}

export type FilteredExecutiveSummary =
  | { status: "ok"; summary: PerformanceSummary }
  /** O objetivo em jogo não tem nenhuma linha de `campaign_daily_metrics`
   * pra recalcular (cliente sem integração Meta — só `performance_records`
   * manual, sem coluna de campanha nenhuma; ou objetivo secundário sem
   * mapeamento por campanha). Nunca mostra o número GLOBAL disfarçado de
   * filtrado (pedido explícito do usuário). */
  | { status: "unavailable"; reason: "no_campaign_level_data" };

/**
 * Recalcula Investimento/Resultado/Custo por resultado do objetivo
 * PRINCIPAL a partir de `campaign_daily_metrics` já filtrado — única fonte
 * granular com identidade de campanha (achado da auditoria: `daily_performance`/
 * `performance_records`, fonte original destes cards, não têm essa coluna).
 * `allCampaignDailyRows` SEMPRE o conjunto COMPLETO (não filtrado) — a
 * disponibilidade é decidida aqui (existe dado granular pra este cliente?),
 * o filtro em si é aplicado dentro de `recomputeFilteredSummary` (mesma
 * função usada pelo `/relatorio`, nunca uma segunda).
 */
export function buildFilteredExecutiveSummary(
  goal: PerformanceGoal,
  allCampaignDailyRows: CampaignDailyMetricRow[],
  filter: CockpitFilterState,
): FilteredExecutiveSummary {
  if (allCampaignDailyRows.length === 0) return { status: "unavailable", reason: "no_campaign_level_data" };
  const rows = toFilterableRows(allCampaignDailyRows);
  return { status: "ok", summary: recomputeFilteredSummary(goal, rows, filter.mode, filter.text) };
}

/** Um grupo de objetivo (`groupChannelsByResultType`) só tem dado granular
 * com identidade de campanha quando TODO o investimento dele vem de um
 * canal com essa granularidade — hoje, só Meta (`campaign_daily_metrics`).
 * Um grupo "Meta + Google" ou só-Google nunca é recalculável no escopo
 * filtrado (o filtro é por nome de CAMPANHA — Google não tem essa
 * dimensão aqui): pedido explícito do usuário, "se algum indicador não
 * puder ser calculado corretamente no escopo filtrado, exibir
 * indisponibilidade clara, não valores globais disfarçados de filtrados". */
export function isResultGroupFilterable(channels: TrafficChannel[]): boolean {
  return channels.length === 1 && channels[0] === "meta";
}

export interface FilteredExecutiveCardOverride {
  /** `null` = indisponível neste escopo — o card deve mostrar "—", nunca o
   * número global disfarçado de filtrado. */
  resultCount: number | null;
  costPerResult: number | null;
  /** Presente (card calculável, mas sem meta comparável — ver
   * `CockpitResultCardView.filteredNotice`) OU... */
  filteredNotice?: string;
  /** ...presente (card não calculável neste escopo — ver
   * `CockpitResultCardView.unavailableReason`). Nunca os dois ao mesmo
   * tempo. */
  unavailableReason?: string;
}

/**
 * Decide o que os cards RESULTADO/CUSTO devem mostrar quando o filtro
 * global está ativo, pra UM grupo de objetivo — só chamada quando
 * `filter.isActive` (quem monta a página decide; sem filtro ativo, os
 * cards continuam exatamente como sempre, sem passar por aqui).
 * `allCampaignDailyRows` é SEMPRE o conjunto completo (não filtrado por
 * nome) de `campaign_daily_metrics` do cliente (canal Meta) — a função
 * recorta por `resultType` (nunca somar objetivos incompatíveis) e aplica
 * o filtro de nome por dentro de `buildFilteredExecutiveSummary`.
 */
export function resolveFilteredExecutiveCardOverride(
  resultType: PerformanceGoal,
  channels: TrafficChannel[],
  allCampaignDailyRows: CampaignDailyMetricRow[],
  filter: CockpitFilterState,
): FilteredExecutiveCardOverride {
  if (!isResultGroupFilterable(channels)) {
    return {
      resultCount: null,
      costPerResult: null,
      unavailableReason: "Indisponível no escopo filtrado — este objetivo combina canais sem granularidade de campanha.",
    };
  }
  const rowsForGoal = allCampaignDailyRows.filter((row) => row.resultType === resultType);
  const result = buildFilteredExecutiveSummary(resultType, rowsForGoal, filter);
  if (result.status === "unavailable") {
    return {
      resultCount: null,
      costPerResult: null,
      unavailableReason: "Indisponível no escopo filtrado — sem dados de campanha para este objetivo.",
    };
  }
  return {
    resultCount: result.summary.resultCount,
    costPerResult: result.summary.costPerResult,
    filteredNotice: "Escopo filtrado — meta do mês não é comparável aqui.",
  };
}
