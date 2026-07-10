import type { TaskRecurrence, TaskStatus, TaskType } from "@/lib/supabase/database.types";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  otimizacao: "Otimização",
  verificacao_saldo: "Verificação de saldo",
  report: "Report",
  outro: "Outro",
};

/** Título gerado automaticamente pro template de sprint a partir do tipo —
 * evita o campo redundante de "título" na tela de templates (são tarefas
 * padronizadas, o tipo já diz o nome). Só "outro" mantém título livre,
 * escolhido por quem cria o template. */
export const TASK_TYPE_DEFAULT_TITLE: Record<Exclude<TaskType, "outro">, string> = {
  otimizacao: "Otimização",
  verificacao_saldo: "Checar Saldo",
  report: "Report",
};

export const TASK_RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  nenhuma: "Não repete",
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: "Pendente",
  feito: "Feito",
  atrasado: "Atrasado",
};

export const TASK_STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pendente: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  feito: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atrasado: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
