import type { AttentionAlert } from "./attention-alerts";
import type { OperationClientCard } from "@/app/operation/operation-data";

/**
 * Bloco "Precisa de atenção" no nível da agência — não reimplementa
 * nenhuma regra: só conta, sobre os cards já calculados (mesma saúde,
 * ritmo, atividade e sprint-sem-execução usados na página do cliente e
 * na Operação), quantos clientes caem em cada situação real. Cada item só
 * aparece se a contagem for maior que zero.
 */
export interface AgencyAlert extends AttentionAlert {
  /** Chave usada pra aplicar o filtro certo na tabela quando o item é clicado. */
  filterKey: "critico" | "acima" | "abaixo" | "atrasadas" | "sem_execucao" | "inativo" | "sem_meta" | "sem_sync";
}

const SEVERITY_ORDER: Record<AttentionAlert["severity"], number> = {
  critico: 0,
  atencao: 1,
  informativo: 2,
};

export function buildAgencyAttentionAlerts(cards: OperationClientCard[]): AgencyAlert[] {
  const alerts: AgencyAlert[] = [];

  const criticos = cards.filter((c) => c.accountHealth === "critico").length;
  if (criticos > 0) {
    alerts.push({
      severity: "critico",
      filterKey: "critico",
      message: `${criticos} cliente${criticos !== 1 ? "s" : ""} crítico${criticos !== 1 ? "s" : ""}.`,
    });
  }

  const acima = cards.filter((c) => c.hasMonthGoal && c.monthStatus === "acima").length;
  if (acima > 0) {
    alerts.push({
      severity: "critico",
      filterKey: "acima",
      message: `${acima} cliente${acima !== 1 ? "s" : ""} acima do investimento planejado.`,
    });
  }

  const atrasadas = cards.reduce((sum, c) => sum + c.taskCounts.overdue, 0);
  if (atrasadas > 0) {
    alerts.push({
      severity: "critico",
      filterKey: "atrasadas",
      message: `${atrasadas} tarefa${atrasadas !== 1 ? "s" : ""} atrasada${atrasadas !== 1 ? "s" : ""}.`,
    });
  }

  const semExecucao = cards.filter((c) => c.sprintFilterBucket === "sem_execucao").length;
  if (semExecucao > 0) {
    alerts.push({
      severity: "critico",
      filterKey: "sem_execucao",
      message: `${semExecucao} sprint${semExecucao !== 1 ? "s" : ""} sem execução.`,
    });
  }

  const inativos = cards.filter((c) => c.activityStatus === "inativo").length;
  if (inativos > 0) {
    alerts.push({
      severity: "critico",
      filterKey: "inativo",
      message: `${inativos} cliente${inativos !== 1 ? "s" : ""} inativo${inativos !== 1 ? "s" : ""} operacionalmente.`,
    });
  }

  const abaixo = cards.filter((c) => c.hasMonthGoal && c.monthStatus === "abaixo").length;
  if (abaixo > 0) {
    alerts.push({
      severity: "atencao",
      filterKey: "abaixo",
      message: `${abaixo} cliente${abaixo !== 1 ? "s" : ""} abaixo do ritmo de investimento.`,
    });
  }

  const semSync = cards.filter((c) => c.alerts.some((a) => a.message.includes("sincronização"))).length;
  if (semSync > 0) {
    alerts.push({
      severity: "atencao",
      filterKey: "sem_sync",
      message: `${semSync} conta${semSync !== 1 ? "s" : ""} com Meta sem sincronização recente.`,
    });
  }

  const semMeta = cards.filter((c) => !c.hasMonthGoal).length;
  if (semMeta > 0) {
    alerts.push({
      severity: "informativo",
      filterKey: "sem_meta",
      message: `${semMeta} cliente${semMeta !== 1 ? "s" : ""} sem meta configurada.`,
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
