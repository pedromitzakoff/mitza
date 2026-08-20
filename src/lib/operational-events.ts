import type {
  OperationalEntityType,
  OperationalEventSource,
  OperationalEventType as OperationalEventTypeValue,
} from "@/lib/supabase/database.types";
export type { OperationalEntityType, OperationalEventSource };

/**
 * Taxonomia central de eventos de negócio (Etapa 56) — nenhuma string solta
 * de event_type deve ser escrita fora daqui. Os valores batem exatamente com
 * a constraint `check` de `operational_events.event_type`
 * (supabase/operational-events.sql); qualquer novo tipo precisa ser
 * adicionado nos dois lugares.
 *
 * Alguns tipos ficam registrados aqui mas NÃO são emitidos nesta etapa —
 * ver `NOT_YET_EMITTED` logo abaixo — porque o recurso de domínio
 * correspondente ainda não existe (reabertura de tarefa) ou porque não há
 * uma ação distinta de "agendar"/"cancelar" separada de task_created/
 * task_due_date_changed pra reuniões e criativos (que hoje são só
 * `tasks.type`, sem tabela própria).
 */
export const OperationalEventType = {
  TEAM_MEMBER_CREATED: "team_member_created",
  TEAM_MEMBER_UPDATED: "team_member_updated",
  TEAM_MEMBER_DEACTIVATED: "team_member_deactivated",
  TEAM_MEMBER_REACTIVATED: "team_member_reactivated",
  TEAM_MEMBER_INVITED: "team_member_invited",
  TEAM_MEMBER_ACCESS_ACTIVATED: "team_member_access_activated",
  TEAM_MEMBER_ACCESS_REVOKED: "team_member_access_revoked",
  TEAM_MEMBER_DELETED: "team_member_deleted",

  CLIENT_CREATED: "client_created",
  CLIENT_MANAGER_ASSIGNED: "client_manager_assigned",
  CLIENT_MANAGER_CHANGED: "client_manager_changed",
  CLIENT_STATUS_CHANGED: "client_status_changed",

  TASK_CREATED: "task_created",
  TASK_ASSIGNED: "task_assigned",
  TASK_REASSIGNED: "task_reassigned",
  TASK_DUE_DATE_CHANGED: "task_due_date_changed",
  TASK_COMPLETED: "task_completed",
  TASK_REOPENED: "task_reopened",
  TASK_DELETED: "task_deleted",

  OPTIMIZATION_COMPLETED: "optimization_completed",

  MEETING_SCHEDULED: "meeting_scheduled",
  MEETING_RESCHEDULED: "meeting_rescheduled",
  MEETING_COMPLETED: "meeting_completed",
  MEETING_CANCELLED: "meeting_cancelled",

  CREATIVE_DELIVERY_SCHEDULED: "creative_delivery_scheduled",
  CREATIVE_DELIVERY_COMPLETED: "creative_delivery_completed",
  CREATIVE_DELIVERY_LATE: "creative_delivery_late",

  MONTHLY_BUDGET_CREATED: "monthly_budget_created",
  MONTHLY_BUDGET_CHANGED: "monthly_budget_changed",

  MONTHLY_REPORT_STARTED: "monthly_report_started",
  MONTHLY_REPORT_READY_FOR_REVIEW: "monthly_report_ready_for_review",
  MONTHLY_REPORT_FINALIZED: "monthly_report_finalized",
  MONTHLY_REPORT_REOPENED: "monthly_report_reopened",

  // Etapa 57 — Análises da Conta e Otimizações.
  ACCOUNT_REVIEW_RECORDED: "account_review_recorded",
  ACCOUNT_REVIEW_NO_CHANGE: "account_review_no_change",
  ACCOUNT_REVIEW_OPTIMIZATION_PERFORMED: "account_review_optimization_performed",
  ACCOUNT_REVIEW_ISSUE_IDENTIFIED: "account_review_issue_identified",
  ACCOUNT_OPTIMIZATION_RECORDED: "account_optimization_recorded",

  // Etapa 59 — Atualização para o Cliente.
  CLIENT_UPDATE_GENERATED: "client_update_generated",
  CLIENT_UPDATE_EDITED: "client_update_edited",
  CLIENT_UPDATE_COPIED: "client_update_copied",
  CLIENT_UPDATE_MARKED_SENT: "client_update_marked_sent",
  CLIENT_UPDATE_MARKED_UNSENT: "client_update_marked_unsent",

  // Etapa Reports — histórico oficial de comunicação de resultados.
  CLIENT_REPORT_GENERATED: "client_report_generated",
  CLIENT_REPORT_EDITED: "client_report_edited",
  CLIENT_REPORT_SENT: "client_report_sent",

  // Sistema de Conquistas — detectado pelo motor (`achievement-engine.ts`),
  // nunca uma ação de um usuário logado. Um único event_type pra qualquer
  // conquista (Cliente/Agência/Pessoa) — o tipo específico vive em
  // `metadata.achievement_type`, evitando inflar esta taxonomia com uma
  // entrada por regra.
  ACHIEVEMENT_UNLOCKED: "achievement_unlocked",
} as const satisfies Record<string, OperationalEventTypeValue>;

export type OperationalEventType = (typeof OperationalEventType)[keyof typeof OperationalEventType];

/**
 * Tipos presentes na taxonomia mas ainda não emitidos por nenhum código —
 * documentado explicitamente em vez de simplesmente nunca aparecerem, pra
 * quem for implementar o recurso de domínio que falta saber que o evento já
 * está reservado e não precisa inventar um novo nome.
 *
 * - TASK_REOPENED: não existe funcionalidade de reabrir tarefa concluída no
 *   app hoje (só existe "reabrir relatório mensal", outra entidade). Emitir
 *   este evento fica pra quando essa funcionalidade for implementada.
 * - MEETING_SCHEDULED/RESCHEDULED/CANCELLED e
 *   CREATIVE_DELIVERY_SCHEDULED: reunião e entrega de criativo são só
 *   `tasks.type`, sem tabela própria — "agendar"/"reagendar" já SÃO
 *   task_created/task_due_date_changed (o mesmo acontecimento, seria
 *   duplicar o evento sem informação nova). Só "cancelar" seria um evento
 *   genuinamente novo: excluir uma tarefa de reunião/criativo hoje emite
 *   TASK_DELETED (genérico), não um MEETING_CANCELLED/CREATIVE_DELIVERY_*
 *   próprio — não há como saber, só pelo delete, se o motivo foi
 *   cancelamento ou outra coisa (ex.: tarefa criada por engano).
 * - CREATIVE_DELIVERY_LATE: evento de TRANSIÇÃO DE ESTADO (seção 21/20 do
 *   pedido) — exigiria um job de monitoramento que este round explicitamente
 *   não implementa ("não criar jobs complexos de monitoramento").
 *
 * OPTIMIZATION_COMPLETED (Etapa 56) passa a ser só histórico/legado a partir
 * da Etapa 57 — o template global "Otimização" foi desativado (não gera mais
 * tarefas novas desse tipo), então este evento só volta a ser emitido se uma
 * tarefa de otimização já existente (anterior a esta etapa) for concluída.
 * O conceito vivo agora é ACCOUNT_OPTIMIZATION_RECORDED, ligado a uma
 * Análise da Conta.
 */
export const NOT_YET_EMITTED_EVENT_TYPES: readonly OperationalEventType[] = [
  OperationalEventType.TASK_REOPENED,
  OperationalEventType.MEETING_SCHEDULED,
  OperationalEventType.MEETING_RESCHEDULED,
  OperationalEventType.MEETING_CANCELLED,
  OperationalEventType.CREATIVE_DELIVERY_SCHEDULED,
  OperationalEventType.CREATIVE_DELIVERY_LATE,
];

export const OPERATIONAL_EVENT_TYPE_LABEL: Record<OperationalEventType, string> = {
  team_member_created: "Membro cadastrado",
  team_member_updated: "Membro atualizado",
  team_member_deactivated: "Membro desativado",
  team_member_reactivated: "Membro reativado",
  team_member_invited: "Convite enviado",
  team_member_access_activated: "Acesso ativado",
  team_member_access_revoked: "Acesso revogado",
  team_member_deleted: "Excluiu membro definitivamente",
  client_created: "Cliente cadastrado",
  client_manager_assigned: "Gestor atribuído",
  client_manager_changed: "Gestor alterado",
  client_status_changed: "Status do cliente alterado",
  task_created: "Criou tarefa",
  task_assigned: "Atribuiu tarefa",
  task_reassigned: "Reatribuiu tarefa",
  task_due_date_changed: "Alterou prazo da tarefa",
  task_completed: "Concluiu tarefa",
  task_reopened: "Reabriu tarefa",
  task_deleted: "Excluiu tarefa",
  optimization_completed: "Realizou otimização",
  meeting_scheduled: "Agendou reunião",
  meeting_rescheduled: "Reagendou reunião",
  meeting_completed: "Realizou reunião",
  meeting_cancelled: "Cancelou reunião",
  creative_delivery_scheduled: "Agendou entrega de criativos",
  creative_delivery_completed: "Realizou entrega de criativos",
  creative_delivery_late: "Entrega de criativos atrasou",
  monthly_budget_created: "Definiu orçamento mensal",
  monthly_budget_changed: "Alterou orçamento mensal",
  monthly_report_started: "Iniciou relatório mensal",
  monthly_report_ready_for_review: "Enviou relatório pra revisão",
  monthly_report_finalized: "Finalizou relatório mensal",
  monthly_report_reopened: "Reabriu relatório mensal",
  account_review_recorded: "Analisou a conta",
  account_review_no_change: "Analisou a conta — sem alteração",
  account_review_optimization_performed: "Analisou a conta — otimização realizada",
  account_review_issue_identified: "Analisou a conta — problema identificado",
  account_optimization_recorded: "Registrou otimização",
  client_update_generated: "Gerou atualização para o cliente",
  client_update_edited: "Editou atualização para o cliente",
  client_update_copied: "Copiou atualização para o cliente",
  client_update_marked_sent: "Marcou atualização como enviada",
  client_update_marked_unsent: "Marcou atualização como não enviada",
  client_report_generated: "Gerou report para o cliente",
  client_report_edited: "Editou report do cliente",
  client_report_sent: "Marcou report como enviado",
  achievement_unlocked: "Conquista registrada",
};

/** Converte segundos de atraso pra um texto compacto (horas/dias) — usado
 * na apresentação (timeline, indicadores); o armazenamento continua em
 * segundos, unidade única e consistente (seção 3 do pedido). */
export function formatDelay(delaySeconds: number | null): string {
  if (!delaySeconds || delaySeconds <= 0) return "No prazo";

  const hours = delaySeconds / 3600;
  if (hours < 24) {
    const rounded = Math.round(hours);
    return rounded <= 1 ? "1 hora atrasado" : `${rounded} horas atrasado`;
  }

  const days = Math.round(hours / 24);
  return days === 1 ? "1 dia atrasado" : `${days} dias atrasado`;
}
