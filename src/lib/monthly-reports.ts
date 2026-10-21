import type { KpiDirection, KpiUnit, MonthlyReportStatus, ReportActionItemDependency } from "@/lib/supabase/database.types";
import { formatCurrency } from "@/lib/format";
import { KPI_TARGET_STATUS_REGISTRY, MONTHLY_REPORT_STATUS_REGISTRY } from "@/lib/status-registry";

/** Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1 — `em_andamento` agora é "Relatório em andamento"
 * (qualificado: o mesmo valor de enum também existe, com outro
 * significado, em `SpendStatus` e `ReportActionItemStatus`). */
export const MONTHLY_REPORT_STATUS_LABEL: Record<MonthlyReportStatus, string> = {
  nao_iniciado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.nao_iniciado"].label,
  em_andamento: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.em_andamento"].label,
  pronto_revisao: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.pronto_revisao"].label,
  finalizado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.finalizado"].label,
};

export const MONTHLY_REPORT_STATUS_BADGE_CLASSES: Record<MonthlyReportStatus, string> = {
  nao_iniciado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.nao_iniciado"].badgeClassName,
  em_andamento: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.em_andamento"].badgeClassName,
  pronto_revisao: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.pronto_revisao"].badgeClassName,
  finalizado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.finalizado"].badgeClassName,
};

export const KPI_UNIT_LABEL: Record<KpiUnit, string> = {
  numero: "Número",
  moeda: "Moeda (R$)",
  percentual: "Percentual (%)",
};

export const KPI_DIRECTION_LABEL: Record<KpiDirection, string> = {
  maior_melhor: "Maior é melhor",
  menor_melhor: "Menor é melhor",
};

/** Formata o valor de um KPI conforme a unidade configurada — nunca um
 * número cru sem contexto (R$, %, ou só o número, conforme o cliente
 * configurou aquele KPI). */
export function formatKpiValue(value: number | null, unit: KpiUnit): string {
  if (value === null) return "—";
  if (unit === "moeda") return formatCurrency(value);
  if (unit === "percentual") return `${value}%`;
  return new Intl.NumberFormat("pt-BR").format(value);
}

export type KpiTargetStatus = "atingiu" | "abaixo" | "sem_meta";

/** "Situação" do KPI (Bloco 2) — bateu a meta ou não, respeitando a direção
 * configurada (CPL/CPA: menor é melhor; Leads/ROAS/Vendas: maior é melhor).
 * Sem meta configurada, não inventa situação nenhuma. */
export function classifyKpiTargetStatus(
  result: number | null,
  target: number | null,
  direction: KpiDirection,
): KpiTargetStatus {
  if (result === null || target === null) return "sem_meta";
  const hit = direction === "maior_melhor" ? result >= target : result <= target;
  return hit ? "atingiu" : "abaixo";
}

/** Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1. */
export const KPI_TARGET_STATUS_LABEL: Record<KpiTargetStatus, string> = {
  atingiu: KPI_TARGET_STATUS_REGISTRY["kpi_target.atingiu"].label,
  abaixo: KPI_TARGET_STATUS_REGISTRY["kpi_target.abaixo"].label,
  sem_meta: KPI_TARGET_STATUS_REGISTRY["kpi_target.sem_meta"].label,
};

export const KPI_TARGET_STATUS_BADGE_CLASSES: Record<KpiTargetStatus, string> = {
  atingiu: KPI_TARGET_STATUS_REGISTRY["kpi_target.atingiu"].badgeClassName,
  abaixo: KPI_TARGET_STATUS_REGISTRY["kpi_target.abaixo"].badgeClassName,
  sem_meta: KPI_TARGET_STATUS_REGISTRY["kpi_target.sem_meta"].badgeClassName,
};

/** Variação percentual entre o resultado do mês e o do mês anterior — não
 * carrega direção (bom/ruim): "Situação" (acima) já cobre isso; aqui é só a
 * comparação objetiva pedida na tabela do Bloco 2. */
export function computeKpiVariationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export const REPORT_ACTION_ITEM_DEPENDENCY_LABEL: Record<ReportActionItemDependency, string> = {
  agencia: "Agência",
  cliente: "Cliente",
  terceiro: "Terceiro",
};
