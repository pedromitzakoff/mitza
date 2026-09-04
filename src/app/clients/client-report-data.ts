import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatCurrency } from "@/lib/format";
import { resolvePerformanceSummaryForGoal } from "@/lib/instagram-metrics";
import {
  getClientIdsWithActiveImportSource,
  getDailyPerformanceForPeriod,
  getDailySpendRowsForPeriod,
  getPerformanceRecordsForPeriod,
} from "@/lib/performance-queries";
import {
  CLIENT_REPORT_INVESTMENT_METRIC,
  CLIENT_REPORT_METRICS_BY_GOAL,
  type ClientReportMetric,
  type ClientReportStatus,
} from "@/lib/client-reports";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { AVAILABLE_TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import { firstDayOfMonth } from "@/lib/achievement-dates";
import { todayDateString } from "@/lib/today";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface ClientReportMetricsResult {
  /** `null` = cliente sem objetivo de performance configurado ainda — o
   * report só recebe Investimento, nenhum resultado/custo inventado. */
  performanceGoal: PerformanceGoal | null;
  metrics: ClientReportMetric[];
}

/**
 * Métricas pré-preenchidas de UM cliente pra UM período arbitrário (Etapa 2
 * — Buscar métricas) — investimento é sempre a soma direta de `daily_spend`
 * no intervalo (não passa pela lógica de override manual por sprint,
 * `lib/effective-spend.ts`: um report é sempre editável de qualquer forma,
 * então não faz sentido herdar a complexidade de "manual vs. sincronizado
 * por sprint" aqui — se faltar dado, o gestor completa na Revisão). Resultado
 * e custo por resultado reaproveitam o núcleo já existente
 * (`computePerformanceSummary`) e a mesma decisão manual/Stract já usada em
 * qualquer outra tela (`getClientIdsWithActiveImportSource`).
 */
export async function fetchClientReportMetrics(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<ClientReportMetricsResult> {
  const [client, dailySpendRows, activeImportClientIds, planChangeRows] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("performance_goal, target_cost_per_result").eq("id", clientId),
      "clients:report-metrics",
    ),
    getDailySpendRowsForPeriod(supabase, clientId, { firstDay: period.start, lastDay: period.end }),
    getClientIdsWithActiveImportSource(supabase, [clientId]),
    // Etapa "Meta/Custo-Alvo: Centralizar a Regra" — mesma resolução
    // canônica de `resolveTargetCostPerResult` (plano do mês vigente antes
    // do fallback legado), nunca mais só `clients.target_cost_per_result`
    // cru. `.lte` (carry-forward), filtro de objetivo em JS abaixo (o
    // objetivo principal só é conhecido depois que `client` resolve).
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, result_type, month, changed_at, new_amount, target_result_count")
        .eq("client_id", clientId)
        .lte("month", firstDayOfMonth(todayDateString())),
      "monthly_budget_changes:target",
    ),
  ]);

  const performanceGoal = client[0]?.performance_goal ?? null;
  const planChanges: ClientPlanChangeRow[] = planChangeRows
    .filter((row) => row.result_type == null || row.result_type === performanceGoal)
    .map((row) => ({
      channel: row.channel as TrafficChannel,
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
    }));
  const clientMonthlyPlan = resolveClientMonthlyPlan({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: planChanges,
    selectedMonth: firstDayOfMonth(todayDateString()),
  });
  const targetCostPerResult = resolveTargetCostPerResult({
    channel: "consolidated",
    plan: clientMonthlyPlan,
    legacyFallback: client[0]?.target_cost_per_result ?? null,
  });
  const actualSpend = dailySpendRows.reduce((sum, row) => sum + row.spend, 0);

  const metrics: ClientReportMetric[] = [
    { key: CLIENT_REPORT_INVESTMENT_METRIC.key, label: CLIENT_REPORT_INVESTMENT_METRIC.label, value: formatCurrency(actualSpend) },
  ];

  if (!performanceGoal) return { performanceGoal, metrics };

  const spendByChannel: Partial<Record<TrafficChannel, number>> = {};
  for (const row of dailySpendRows) {
    spendByChannel[row.channel] = (spendByChannel[row.channel] ?? 0) + row.spend;
  }

  const dateRange = { firstDay: period.start, lastDay: period.end };
  const records = activeImportClientIds.has(clientId)
    ? await getDailyPerformanceForPeriod(supabase, clientId, dateRange)
    : await getPerformanceRecordsForPeriod(supabase, clientId, dateRange);

  // Etapa Integração Instagram: mesma função usada por Analytics
  // (`analytics-data.ts`) — "followers" cruza investimento só de Meta Ads,
  // nunca uma segunda versão do cálculo neste módulo.
  const summary = resolvePerformanceSummaryForGoal({
    goal: performanceGoal,
    records,
    totalActualSpend: actualSpend,
    spendByChannel,
    targetCostPerResult,
  });

  for (const definition of CLIENT_REPORT_METRICS_BY_GOAL[performanceGoal]) {
    let value = "";
    if (!definition.manualOnly) {
      switch (definition.key) {
        case "leads":
        case "sales":
        case "followers":
          value = summary.hasAnyRecord ? String(summary.resultCount) : "";
          break;
        case "cpl":
        case "cpa":
        case "cost_per_follower":
          value = summary.costPerResult !== null ? formatCurrency(summary.costPerResult) : "";
          break;
        case "roas":
          value = summary.roas !== null ? `${summary.roas.toFixed(2)}x` : "";
          break;
        case "revenue":
          value = summary.revenue !== null ? formatCurrency(summary.revenue) : "";
          break;
      }
    }
    metrics.push({ key: definition.key, label: definition.label, value });
  }

  return { performanceGoal, metrics };
}

export interface ClientReportSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  createdByName: string | null;
  status: ClientReportStatus;
  sentAt: string | null;
  sentByName: string | null;
}

const HISTORY_SUMMARY_SELECT =
  "id, period_start, period_end, created_at, status, sent_at, created_by_member:team_members!client_reports_created_by_fkey(name), sent_by_member:team_members!client_reports_sent_by_fkey(name)";

function toReportSummary(row: {
  id: string;
  period_start: string;
  period_end: string;
  created_at: string;
  status: ClientReportStatus;
  sent_at: string | null;
  created_by_member: { name: string } | null;
  sent_by_member: { name: string } | null;
}): ClientReportSummary {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    createdByName: row.created_by_member?.name ?? null,
    status: row.status,
    sentAt: row.sent_at,
    sentByName: row.sent_by_member?.name ?? null,
  };
}

/** Histórico do módulo Reports (dentro da Visão Geral do cliente, nunca uma
 * aba própria) — mais recente primeiro por PERÍODO analisado (não por
 * `created_at`: um report gerado atrasado pra uma semana antiga deve
 * aparecer na posição cronológica do período, não no topo). Pertence só ao
 * cliente e ao período — nenhuma referência a sprint. */
export async function fetchClientReportHistory(supabase: Supabase, clientId: string): Promise<ClientReportSummary[]> {
  const rows = await requireQuery(
    supabase.from("client_reports").select(HISTORY_SUMMARY_SELECT).eq("client_id", clientId).order("period_start", { ascending: false }),
    "client_reports:history",
  );

  return rows.map(toReportSummary);
}

export interface ClientReportDetail extends ClientReportSummary {
  performanceGoal: PerformanceGoal | null;
  metrics: ClientReportMetric[];
  observations: string | null;
  finalText: string;
}

/** Valida a forma bruta de `metrics` (jsonb, `unknown` no tipo do banco) —
 * nunca confia cegamente no shape vindo do Postgres. */
function parseStoredMetrics(raw: unknown): ClientReportMetric[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ClientReportMetric =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).key === "string" &&
      typeof (item as Record<string, unknown>).label === "string" &&
      typeof (item as Record<string, unknown>).value === "string",
  );
}

export async function fetchClientReportDetail(supabase: Supabase, clientId: string, reportId: string): Promise<ClientReportDetail | null> {
  const rows = await requireQuery(
    supabase
      .from("client_reports")
      .select(`performance_goal, metrics, observations, final_text, ${HISTORY_SUMMARY_SELECT}`)
      .eq("client_id", clientId)
      .eq("id", reportId),
    "client_reports:detail",
  );

  const row = rows[0];
  if (!row) return null;

  return {
    ...toReportSummary(row),
    performanceGoal: row.performance_goal,
    metrics: parseStoredMetrics(row.metrics),
    observations: row.observations,
    finalText: row.final_text,
  };
}

/**
 * Resolve qual recorrência "Reportar cliente" (`uses_report = true`) se
 * aplica a este cliente — usado só quando o report é marcado como enviado
 * SEM ter vindo do drawer da recorrência (ex.: criado direto pelo módulo do
 * cliente), pra ainda assim registrar a execução automaticamente sem exigir
 * um passo manual à parte. Nunca cria uma recorrência nova — só encontra uma
 * já ativa e aplicável (por `applies_to_all` ou por `recurring_task_clients`).
 * Genérico por dado (`uses_report`), nunca hardcoded pelo título da tarefa.
 */
export async function findActiveReportRecurringTaskId(supabase: Supabase, clientId: string): Promise<string | null> {
  const tasks = await requireQuery(
    supabase.from("recurring_tasks").select("id, applies_to_all").eq("uses_report", true).eq("is_active", true),
    "recurring_tasks:report-lookup",
  );
  if (tasks.length === 0) return null;

  const applicableToAll = tasks.find((task) => task.applies_to_all);
  if (applicableToAll) return applicableToAll.id;

  const scopedTaskIds = tasks.map((task) => task.id);
  const scopedRows = await requireQuery(
    supabase.from("recurring_task_clients").select("recurring_task_id").eq("client_id", clientId).in("recurring_task_id", scopedTaskIds),
    "recurring_task_clients:report-lookup",
  );
  return scopedRows[0]?.recurring_task_id ?? null;
}
