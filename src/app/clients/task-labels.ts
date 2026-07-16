import type { TaskRecurrence, TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { TASK_STATUS_REGISTRY } from "@/lib/status-registry";

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
  feito: TASK_STATUS_REGISTRY["task.feito"].label,
  atrasado: TASK_STATUS_REGISTRY["task.atrasado"].label,
  nao_realizado: TASK_STATUS_REGISTRY["task.nao_realizado"].label,
};

export const TASK_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pendente: TASK_STATUS_REGISTRY["task.pendente"].badgeClassName,
  feito: TASK_STATUS_REGISTRY["task.feito"].badgeClassName,
  atrasado: TASK_STATUS_REGISTRY["task.atrasado"].badgeClassName,
  nao_realizado: TASK_STATUS_REGISTRY["task.nao_realizado"].badgeClassName,
};
