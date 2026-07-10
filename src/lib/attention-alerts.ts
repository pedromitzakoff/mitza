import type { SpendStatus } from "@/lib/spend-status";
import { classifyOperationalActivityStatus } from "./operational-activity";

export type AlertSeverity = "critico" | "atencao" | "informativo";

/** Categoria do alerta, usada só pela página do cliente pra priorizar quais
 * 3 alertas mostrar primeiro (ver AttentionPanel). Opcional pra não quebrar
 * quem já constrói AttentionAlert sem isso (ex.: client-group.tsx, em
 * Sprints) — essas telas continuam ordenando só por severidade, como sempre. */
export type AlertKind =
  | "tarefas_atrasadas"
  | "investimento"
  | "atividade"
  | "meta_sync"
  | "otimizacao"
  | "sem_responsavel"
  | "outro";

export interface AttentionAlert {
  severity: AlertSeverity;
  message: string;
  kind?: AlertKind;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critico: 0,
  atencao: 1,
  informativo: 2,
};

const SYNC_STALE_AFTER_HOURS = 48;

export interface AttentionAlertsInput {
  monthStatus: SpendStatus;
  overdueTasksCount: number;
  /** Alguma tarefa de otimização com prazo recente já foi concluída? */
  optimizationRecentlyDone: boolean;
  lastSyncedAt: string | null;
  /** Planejado da sprint atual, ou null se não há sprint em andamento. */
  currentSprintPlannedSpend: number | null;
  /** Quantas tarefas a sprint atual tem vinculadas (de qualquer status). */
  currentSprintTaskCount: number;
  /** Tarefas da sprint atual sem responsável definido. */
  currentSprintUnassignedCount: number;
  /** Dias úteis desde a última atividade operacional relevante do cliente
   * (null = nunca houve nenhuma). */
  clientInactivityBusinessDays: number | null;
  now?: Date;
}

/**
 * Gera os alertas do bloco "Precisa de atenção" a partir de dados reais —
 * nada de alerta hardcoded. Função pura e testável: toda a lógica de
 * severidade/ordenação mora aqui, não espalhada pela UI.
 */
export function buildAttentionAlerts(input: AttentionAlertsInput): AttentionAlert[] {
  const alerts: AttentionAlert[] = [];
  const now = input.now ?? new Date();

  if (input.monthStatus === "acima") {
    alerts.push({ severity: "critico", kind: "investimento", message: "Investimento do mês acima do esperado." });
  } else if (input.monthStatus === "abaixo") {
    alerts.push({ severity: "atencao", kind: "investimento", message: "Investimento do mês abaixo do esperado." });
  }

  if (input.overdueTasksCount > 0) {
    const plural = input.overdueTasksCount > 1 ? "s" : "";
    alerts.push({
      severity: "critico",
      kind: "tarefas_atrasadas",
      message: `${input.overdueTasksCount} tarefa${plural} atrasada${plural}.`,
    });
  }

  if (!input.optimizationRecentlyDone) {
    alerts.push({
      severity: "atencao",
      kind: "otimizacao",
      message: "Nenhuma tarefa de otimização concluída recentemente.",
    });
  }

  if (!input.lastSyncedAt) {
    alerts.push({ severity: "atencao", kind: "meta_sync", message: "Dados do Meta sem sincronização recente." });
  } else {
    const hoursSinceSync = (now.getTime() - new Date(input.lastSyncedAt).getTime()) / 3_600_000;
    if (hoursSinceSync > SYNC_STALE_AFTER_HOURS) {
      alerts.push({ severity: "atencao", kind: "meta_sync", message: "Dados do Meta sem sincronização recente." });
    }
  }

  if (input.currentSprintPlannedSpend !== null) {
    if (input.currentSprintPlannedSpend <= 0) {
      alerts.push({ severity: "critico", kind: "outro", message: "Sprint atual sem planejado configurado." });
    }

    if (input.currentSprintTaskCount === 0) {
      alerts.push({ severity: "atencao", kind: "outro", message: "Sprint atual sem tarefas padrão." });
    }

    if (input.currentSprintUnassignedCount > 0) {
      const plural = input.currentSprintUnassignedCount > 1 ? "s" : "";
      alerts.push({
        severity: "informativo",
        kind: "sem_responsavel",
        message: `${input.currentSprintUnassignedCount} tarefa${plural} da sprint atual sem responsável.`,
      });
    }
  }

  const activityStatus = classifyOperationalActivityStatus(input.clientInactivityBusinessDays);
  if (activityStatus === "atencao") {
    alerts.push({
      severity: "atencao",
      kind: "atividade",
      message: `Cliente sem atividade operacional há ${input.clientInactivityBusinessDays} dias úteis.`,
    });
  } else if (activityStatus === "inativo") {
    alerts.push({
      severity: "critico",
      kind: "atividade",
      message:
        input.clientInactivityBusinessDays === null
          ? "Cliente nunca teve atividade operacional registrada."
          : `Cliente sem atividade operacional há ${input.clientInactivityBusinessDays} dias úteis.`,
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export type AccountHealth = "saudavel" | "atencao" | "critico";

/** Saúde da conta derivada da severidade máxima entre os alertas ativos. */
export function computeAccountHealth(alerts: AttentionAlert[]): AccountHealth {
  if (alerts.some((alert) => alert.severity === "critico")) return "critico";
  if (alerts.some((alert) => alert.severity === "atencao")) return "atencao";
  return "saudavel";
}
