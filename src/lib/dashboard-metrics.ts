import type { PerformanceGoal } from "@/lib/performance-goals";

/**
 * Catálogo global de métricas do Dashboard (Etapa "Catálogo de métricas") —
 * fonte única de verdade dos 17 indicadores selecionáveis em "Métricas
 * exibidas" (`clients.dashboard_metrics`, `supabase/dashboard-metrics-
 * catalog.sql`). Decide só O QUE APARECE na apresentação — nunca qual
 * evento da Meta conta pra cada objetivo (isso é sempre `metric_mappings`,
 * ponto 3 do pedido) nem participa do Planejamento de Metas (`client_goals`/
 * `is_primary`, ponto 6 — intocados por este arquivo).
 *
 * Deliberadamente independente de `client_goals` (ponto 2 do pedido):
 * marcar "Leads" aqui nunca cria, exige ou depende de uma linha em
 * `client_goals` — são dois sistemas paralelos a partir desta etapa.
 */
export type DashboardMetricKey =
  | "leads"
  | "sales"
  | "conversations"
  | "registrations"
  | "followers"
  | "cpl"
  | "cpa"
  | "cost_per_conversation"
  | "cost_per_registration"
  | "roas"
  | "spend"
  | "impressions"
  | "reach"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm";

export type DashboardMetricGroup = "resultado" | "eficiencia" | "entrega";

export interface DashboardMetricConfig {
  key: DashboardMetricKey;
  label: string;
  group: DashboardMetricGroup;
  /** De qual objetivo (`PerformanceGoal`) esta métrica depende pra saber se
   * tem evento configurado — `null` pra Entrega, que nunca depende de
   * objetivo nenhum (sempre disponível, exceto falha real da API). */
  dependsOnGoal: PerformanceGoal | null;
}

export const DASHBOARD_METRIC_CATALOG: Record<DashboardMetricKey, DashboardMetricConfig> = {
  leads: { key: "leads", label: "Leads", group: "resultado", dependsOnGoal: "leads" },
  sales: { key: "sales", label: "Vendas", group: "resultado", dependsOnGoal: "sales" },
  conversations: { key: "conversations", label: "Conversas", group: "resultado", dependsOnGoal: "conversations" },
  registrations: { key: "registrations", label: "Cadastros", group: "resultado", dependsOnGoal: "registrations" },
  followers: { key: "followers", label: "Seguidores", group: "resultado", dependsOnGoal: "followers" },
  cpl: { key: "cpl", label: "CPL", group: "eficiencia", dependsOnGoal: "leads" },
  cpa: { key: "cpa", label: "CPA", group: "eficiencia", dependsOnGoal: "sales" },
  cost_per_conversation: { key: "cost_per_conversation", label: "Custo por conversa", group: "eficiencia", dependsOnGoal: "conversations" },
  cost_per_registration: { key: "cost_per_registration", label: "Custo por cadastro", group: "eficiencia", dependsOnGoal: "registrations" },
  roas: { key: "roas", label: "ROAS", group: "eficiencia", dependsOnGoal: "sales" },
  spend: { key: "spend", label: "Investimento", group: "entrega", dependsOnGoal: null },
  impressions: { key: "impressions", label: "Impressões", group: "entrega", dependsOnGoal: null },
  reach: { key: "reach", label: "Alcance", group: "entrega", dependsOnGoal: null },
  clicks: { key: "clicks", label: "Cliques", group: "entrega", dependsOnGoal: null },
  ctr: { key: "ctr", label: "CTR", group: "entrega", dependsOnGoal: null },
  cpc: { key: "cpc", label: "CPC", group: "entrega", dependsOnGoal: null },
  cpm: { key: "cpm", label: "CPM", group: "entrega", dependsOnGoal: null },
};

export const DASHBOARD_METRIC_OPTIONS: DashboardMetricConfig[] = Object.values(DASHBOARD_METRIC_CATALOG);

/** Conjunto inicial pra clientes NOVOS (ponto 8) — investimento + o
 * resultado mais comum + a eficiência dele + entrega básica. Pendente de
 * confirmação final do usuário antes de virar o default real da tela de
 * criação de cliente. */
export const DEFAULT_NEW_CLIENT_DASHBOARD_METRICS: DashboardMetricKey[] = ["spend", "leads", "cpl", "impressions", "clicks", "ctr"];

function isDashboardMetricKey(value: string): value is DashboardMetricKey {
  return Object.prototype.hasOwnProperty.call(DASHBOARD_METRIC_CATALOG, value);
}

/** Nunca confia cegamente num array vindo do banco — filtra qualquer chave
 * que não exista mais no catálogo (ex.: se um item for descontinuado no
 * futuro, uma linha antiga nunca quebra a tela). */
export function parseDashboardMetricKeys(values: readonly string[]): DashboardMetricKey[] {
  return values.filter(isDashboardMetricKey);
}

const LEGACY_DELIVERY_METRICS: DashboardMetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "cpm"];

const LEGACY_COST_KEY_BY_GOAL: Record<PerformanceGoal, DashboardMetricKey | null> = {
  leads: "cpl",
  sales: "cpa",
  conversations: "cost_per_conversation",
  registrations: "cost_per_registration",
  followers: null,
};

/**
 * Pontos 2/8 do pedido aprovado: a seleção nova nunca depende de
 * `client_goals`, e clientes já existentes preservam a experiência atual
 * até configurarem "Métricas exibidas" de propósito. `stored` vazio
 * (cliente ainda não abriu a tela nova — o default real da coluna) deriva
 * um conjunto equivalente ao que a tela já mostra hoje (objetivo + custo
 * dele + a mesma entrega básica que sempre apareceu) — cálculo de
 * LEITURA, nunca escrito de volta no banco por esta função.
 */
export function resolveEffectiveDashboardMetrics(stored: readonly string[], legacyGoal: PerformanceGoal | null): DashboardMetricKey[] {
  const parsed = parseDashboardMetricKeys(stored);
  if (parsed.length > 0) return parsed;

  if (!legacyGoal) return LEGACY_DELIVERY_METRICS;

  const costKey = LEGACY_COST_KEY_BY_GOAL[legacyGoal];
  return [legacyGoal, ...(costKey ? [costKey] : []), ...LEGACY_DELIVERY_METRICS];
}

/** Ponto 3 do pedido: uma métrica marcada nunca vira um número sem dizer
 * de onde veio. `reason` sempre explica — nunca um traço silencioso nem um
 * 0 fabricado quando não há evento configurado. */
export type MetricUnavailableReason =
  | "sem_evento_configurado"
  | "sem_conta_meta"
  | "api_indisponivel"
  | "sem_investimento_classificado";

export type MetricView = { status: "available"; value: number } | { status: "unavailable"; reason: MetricUnavailableReason };

export const METRIC_UNAVAILABLE_REASON_LABEL: Record<MetricUnavailableReason, string> = {
  sem_evento_configurado: "Evento não configurado",
  sem_conta_meta: "Conta Meta não conectada",
  api_indisponivel: "Indisponível no momento",
  sem_investimento_classificado: "Sem investimento classificado",
};
