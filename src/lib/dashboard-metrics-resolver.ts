import { DASHBOARD_METRIC_CATALOG, type DashboardMetricKey, type MetricView } from "./dashboard-metrics";
import type { GoalCostUnavailableReason } from "./goal-spend";
import type { PerformanceGoal } from "./performance-goals";
import type { MetaAdsReachSnapshot } from "./meta-ads-dashboard/dashboard-data";

/**
 * Fase B ("integração das métricas selecionadas com o Dashboard") — núcleo
 * PURO (sem Supabase/Graph API) que decide, pra cada métrica marcada em
 * "Métricas exibidas", qual dos 3 estados ela está (ponto 4 do pedido):
 *
 *  - `available` (valor 0 incluso): dado real do período.
 *  - `unavailable`: lacuna de CONFIGURAÇÃO — sem evento mapeado, sem conta
 *    Meta conectada, sem investimento classificado, ou sem base pra formar
 *    uma razão (ex.: CTR sem impressões).
 *  - `error`: falha de INTEGRAÇÃO — sincronização com erro registrado
 *    (`hasMetaSyncError`, mesmo sinal que `/clients/[id]/dados` já usa pra
 *    "Erro de sincronização" — nunca uma segunda checagem) ou a Graph API
 *    não respondeu agora (alcance).
 *
 * Quem chama (camada de leitura, Supabase-aware) resolve TODOS os
 * ingredientes antes — este módulo nunca busca nada, só decide.
 */

export interface ResolvedGoalPerformance {
  resultCount: number;
  costPerResult: number | null;
  costUnavailableReason: GoalCostUnavailableReason;
}

export interface DeliveryTotals {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
}

export interface ResolveMetricViewsInput {
  /** Chaves efetivas a resolver — normalmente `resolveEffectiveDashboardMetrics(...)`. */
  keys: readonly DashboardMetricKey[];
  /** `true` = há uma atenção de severidade "erro" mencionando o canal Meta
   * em `dadosData.attentions` (mesma lista que `/dados` já mostra) — toda
   * métrica que dependeria de dado Meta vira `error`, nunca "disponível"
   * nem "não configurado" disfarçando uma sincronização que falhou agora. */
  hasMetaSyncError: boolean;
  /** `clientChannels.includes("meta")` — sem conta Meta conectada, nenhuma
   * métrica Resultado/Eficiência/Entrega (exceto quem já tem valor em
   * `goals`, ver abaixo) tem de onde vir. */
  hasMetaAccount: boolean;
  /** Objetivos com pelo menos um evento ATIVO em `metric_mappings` — decide
   * "sem_evento_configurado" pra quem não está em `goals`. */
  goalsWithActiveMapping: ReadonlySet<PerformanceGoal>;
  /** Um item por objetivo com QUALQUER dado já resolvido (campanhas
   * classificadas via `client_goals` OU fallback pra objetivo marcado sem
   * `client_goals`, ambos tratados identicamente aqui — ponto 2 da Fase A:
   * nunca dois caminhos de cálculo diferentes). */
  goals: ReadonlyMap<PerformanceGoal, ResolvedGoalPerformance>;
  /** Totais de Entrega (Investimento/Impressões/Cliques/CTR/CPC/CPM) do
   * período — `null` quando `hasMetaAccount` é `false` (nenhuma campanha
   * Meta existe pra somar). Nunca inclui Alcance (ver `reach`, abaixo). */
  delivery: DeliveryTotals | null;
  /** Alcance do período — SEMPRE uma fonte própria (Graph API no nível da
   * conta, nunca somado entre dias/campanhas — mesma regra de sempre, ver
   * `fetchAccountPeriodReachSnapshot`). */
  reach: MetaAdsReachSnapshot;
  /** KOFF Analytics — "Filtro global de performance": com o filtro ativo,
   * Alcance é a ÚNICA métrica desta Etapa que não pode ser recalculada no
   * escopo filtrado (não é aditivo — somar só as campanhas filtradas
   * duplicaria público sobreposto) — mesma regra que `buildMetricCardViewModels`
   * já aplica (`REACH_FILTERED_UNAVAILABLE_LABEL`). Investimento/Impressões/
   * Cliques/CTR/CPC/CPM continuam normais: `delivery` já chega recalculado
   * do escopo filtrado por quem monta este input, nenhum ajuste aqui. */
  isGlobalFilterActive: boolean;
}

function resolveGoalView(goal: PerformanceGoal, input: ResolveMetricViewsInput): MetricView {
  if (input.hasMetaSyncError) return { status: "error", reason: "falha_sincronizacao" };
  const resolved = input.goals.get(goal);
  if (resolved) return { status: "available", value: resolved.resultCount };
  if (!input.hasMetaAccount) return { status: "unavailable", reason: "sem_conta_meta" };
  return { status: "unavailable", reason: "sem_evento_configurado" };
}

function resolveEficienciaView(goal: PerformanceGoal, input: ResolveMetricViewsInput): MetricView {
  if (input.hasMetaSyncError) return { status: "error", reason: "falha_sincronizacao" };
  const resolved = input.goals.get(goal);
  if (!resolved) {
    if (!input.hasMetaAccount) return { status: "unavailable", reason: "sem_conta_meta" };
    return { status: "unavailable", reason: "sem_evento_configurado" };
  }
  if (resolved.costUnavailableReason === "available") return { status: "available", value: resolved.costPerResult as number };
  if (resolved.costUnavailableReason === "no_result") return { status: "unavailable", reason: "sem_base_para_calculo" };
  // "no_campaign_spend" | "incomplete_coverage" | "scope_not_comparable" — todos
  // são, na prática, "o investimento existe mas não dá pra atribuí-lo com
  // confiança a este objetivo" (ver `goal-spend.ts`).
  return { status: "unavailable", reason: "sem_investimento_classificado" };
}

function resolveReachView(input: ResolveMetricViewsInput): MetricView {
  if (input.hasMetaSyncError) return { status: "error", reason: "falha_sincronizacao" };
  if (input.isGlobalFilterActive) return { status: "unavailable", reason: "sem_base_para_calculo" };
  const { reach } = input;
  if (reach.status === "ok") return { status: "available", value: reach.reach };
  if (reach.reason === "not_configured") return { status: "unavailable", reason: "sem_conta_meta" };
  // "token_missing" | "timeout" | "fetch_error" — a conta existe e está
  // configurada, só não foi possível confirmar o número agora.
  return { status: "error", reason: "api_indisponivel" };
}

function resolveDeliveryTotalView(key: "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "cpm", input: ResolveMetricViewsInput): MetricView {
  if (input.hasMetaSyncError) return { status: "error", reason: "falha_sincronizacao" };
  if (!input.delivery) return { status: "unavailable", reason: "sem_conta_meta" };
  const value = input.delivery[key];
  if (value === null) return { status: "unavailable", reason: "sem_base_para_calculo" };
  return { status: "available", value };
}

export function resolveOneMetricView(key: DashboardMetricKey, input: ResolveMetricViewsInput): MetricView {
  const config = DASHBOARD_METRIC_CATALOG[key];

  if (key === "reach") return resolveReachView(input);
  if (config.group === "entrega") return resolveDeliveryTotalView(key as "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "cpm", input);
  if (config.group === "resultado") return resolveGoalView(config.dependsOnGoal as PerformanceGoal, input);
  return resolveEficienciaView(config.dependsOnGoal as PerformanceGoal, input);
}

/** Resolve todas as chaves de uma vez — ordem de `keys` preservada no Map
 * (nunca reordenado pra ordem do catálogo; quem renderiza decide a ordem). */
export function resolveDashboardMetricViews(input: ResolveMetricViewsInput): Map<DashboardMetricKey, MetricView> {
  const views = new Map<DashboardMetricKey, MetricView>();
  for (const key of input.keys) views.set(key, resolveOneMetricView(key, input));
  return views;
}
