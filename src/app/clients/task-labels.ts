import type { TaskPriority, TaskRecurrence, TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { TASK_PRIORITY_REGISTRY, TASK_STATUS_REGISTRY } from "@/lib/status-registry";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  otimizacao: "Otimização",
  verificacao_saldo: "Verificação de saldo",
  report: "Report",
  outro: "Outro",
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
};

/** Título gerado automaticamente pro template de sprint a partir do tipo —
 * evita o campo redundante de "título" na tela de templates (são tarefas
 * padronizadas, o tipo já diz o nome). Só "outro" mantém título livre,
 * escolhido por quem cria o template. */
export const TASK_TYPE_DEFAULT_TITLE: Record<Exclude<TaskType, "outro">, string> = {
  otimizacao: "Otimização",
  verificacao_saldo: "Checar Saldo",
  report: "Report",
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
};

export const TASK_RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  nenhuma: "Não repete",
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

/** Deriva do Status Registry (`@/lib/status-registry`) — fonte única da
 * representação (label/cor) de `task.*`, ver Platform Integrity Wave 1. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: TASK_STATUS_REGISTRY["task.pendente"].label,
  em_andamento: TASK_STATUS_REGISTRY["task.em_andamento"].label,
  aguardando: TASK_STATUS_REGISTRY["task.aguardando"].label,
  bloqueado: TASK_STATUS_REGISTRY["task.bloqueado"].label,
  feito: TASK_STATUS_REGISTRY["task.feito"].label,
  atrasado: TASK_STATUS_REGISTRY["task.atrasado"].label,
  nao_realizado: TASK_STATUS_REGISTRY["task.nao_realizado"].label,
};

export const TASK_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pendente: TASK_STATUS_REGISTRY["task.pendente"].badgeClassName,
  em_andamento: TASK_STATUS_REGISTRY["task.em_andamento"].badgeClassName,
  aguardando: TASK_STATUS_REGISTRY["task.aguardando"].badgeClassName,
  bloqueado: TASK_STATUS_REGISTRY["task.bloqueado"].badgeClassName,
  feito: TASK_STATUS_REGISTRY["task.feito"].badgeClassName,
  atrasado: TASK_STATUS_REGISTRY["task.atrasado"].badgeClassName,
  nao_realizado: TASK_STATUS_REGISTRY["task.nao_realizado"].badgeClassName,
};

/** Status "editáveis" por um gestor via seletor inline — nunca inclui
 * "atrasado" (derivado, nunca escolhido) nem "nao_realizado" (terminal,
 * só via markTaskNotDoneAction, exclusivo de reuniao/entrega_criativo). */
export const TASK_EDITABLE_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = (
  ["pendente", "em_andamento", "aguardando", "bloqueado", "feito"] as const
).map((status) => ({ value: status, label: TASK_STATUS_LABEL[status] }));

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgente: TASK_PRIORITY_REGISTRY["task_priority.urgente"].label,
  alta: TASK_PRIORITY_REGISTRY["task_priority.alta"].label,
  normal: TASK_PRIORITY_REGISTRY["task_priority.normal"].label,
  baixa: TASK_PRIORITY_REGISTRY["task_priority.baixa"].label,
};

export const TASK_PRIORITY_BADGE_CLASSES: Record<TaskPriority, string> = {
  urgente: TASK_PRIORITY_REGISTRY["task_priority.urgente"].badgeClassName,
  alta: TASK_PRIORITY_REGISTRY["task_priority.alta"].badgeClassName,
  normal: TASK_PRIORITY_REGISTRY["task_priority.normal"].badgeClassName,
  baixa: TASK_PRIORITY_REGISTRY["task_priority.baixa"].badgeClassName,
};

export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = (["urgente", "alta", "normal", "baixa"] as const).map(
  (priority) => ({ value: priority, label: TASK_PRIORITY_LABEL[priority] }),
);
