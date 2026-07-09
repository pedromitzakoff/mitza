import type { TaskRecurrence, TaskStatus, TaskType } from "@/lib/supabase/database.types";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  otimizacao: "Otimização",
  verificacao_saldo: "Verificação de saldo",
  report: "Report",
  outro: "Outro",
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
