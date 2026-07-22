import type { HealthStatus } from "@/lib/account-health-engine";
import type { ClientOperationalState } from "@/lib/client-operational-state";

/**
 * Camada de projeção da Visão Geral (Etapa "Consolidação da Arquitetura —
 * Fase B") — transforma `ClientOperationalState` no shape que os componentes
 * desta tela já esperavam. Nenhuma função aqui recalcula severidade,
 * prioridade ou motivo — só lê os valores já resolvidos pelo Motor de Saúde
 * e reformata o shape.
 *
 * Etapa "MITZA 2.0 — Fase E": a projeção das tabelas por objetivo
 * (`ClientObjectiveTableRow`/`buildClientObjectiveRow`) foi removida daqui —
 * essas tabelas saíram do Painel Geral (ver constituição do produto: o
 * Painel Geral nunca lista clientes individualmente). Só a projeção de
 * "Prioridades de hoje" permanece.
 */
export interface OverviewPriorityItem {
  clientId: string;
  clientName: string;
  healthStatus: HealthStatus;
  primaryReason: string;
  actionHref: string;
}

/** Uma linha de "Prioridades de hoje" — motivo sempre vem de
 * `evaluation.primaryReason` (Prioridade 1: nunca reconstruído/analisado
 * localmente). Quem chama já deve ter filtrado `healthStatus !== "saudavel"`
 * e restringido ao recorte de filtros ativo — esta função só transforma o
 * shape de UM cliente já elegível. */
export function buildOverviewPriorityItem(state: ClientOperationalState): OverviewPriorityItem {
  return {
    clientId: state.clientId,
    clientName: state.clientName,
    healthStatus: state.evaluation.healthStatus,
    primaryReason: state.evaluation.primaryReason,
    actionHref: `/clients/${state.clientId}`,
  };
}
