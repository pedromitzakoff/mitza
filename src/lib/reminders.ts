import type { ReminderScopeDb, ReminderStatusDb } from "@/lib/supabase/database.types";

/**
 * Módulo "Pendências" (Visão Geral da Agência) — lógica pura (ordenação,
 * agrupamento, contadores, filtros). Nunca confundir com o conceito
 * homônimo do Core de diagnóstico (`diagnostics.pendencias`, tarefas em
 * aberto de um cliente) — são entidades independentes que só compartilham
 * o nome em português; nunca reaproveitar tarefas/sprints/performance/
 * otimizações aqui.
 */
export type ReminderScope = ReminderScopeDb;
export type ReminderStatus = ReminderStatusDb;

export interface ReminderRow {
  id: string;
  title: string;
  scope: ReminderScope;
  clientId: string | null;
  clientName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  completedByName: string | null;
  completedAt: string | null;
}

export type ReminderBucket = "overdue" | "today" | "future" | "none";

export function getReminderBucket(dueDate: string | null, todayStr: string): ReminderBucket {
  if (!dueDate) return "none";
  if (dueDate < todayStr) return "overdue";
  if (dueDate === todayStr) return "today";
  return "future";
}

const BUCKET_RANK: Record<ReminderBucket, number> = { overdue: 0, today: 1, future: 2, none: 3 };

/**
 * Ordenação oficial do módulo: atrasadas → vencem hoje → prazo futuro → sem
 * prazo. Dentro de cada grupo COM prazo, prazo mais antigo primeiro (mais
 * atrasada primeiro / prazo mais próximo primeiro); dentro do grupo SEM
 * prazo, a mais antiga CRIADA primeiro (não existe outro critério possível).
 */
export function sortReminders(reminders: ReminderRow[], todayStr: string): ReminderRow[] {
  return [...reminders].sort((a, b) => {
    const bucketA = getReminderBucket(a.dueDate, todayStr);
    const bucketB = getReminderBucket(b.dueDate, todayStr);
    if (bucketA !== bucketB) return BUCKET_RANK[bucketA] - BUCKET_RANK[bucketB];
    if (bucketA === "none") return a.createdAt.localeCompare(b.createdAt);
    return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.createdAt.localeCompare(b.createdAt);
  });
}

export interface ReminderCounts {
  openCount: number;
  overdueCount: number;
  dueTodayCount: number;
}

export function computeReminderCounts(reminders: ReminderRow[], todayStr: string): ReminderCounts {
  let overdueCount = 0;
  let dueTodayCount = 0;
  for (const reminder of reminders) {
    const bucket = getReminderBucket(reminder.dueDate, todayStr);
    if (bucket === "overdue") overdueCount++;
    else if (bucket === "today") dueTodayCount++;
  }
  return { openCount: reminders.length, overdueCount, dueTodayCount };
}

export type ReminderFilter = "todas" | "agencia" | "clientes" | "minhas";

export function filterReminders(reminders: ReminderRow[], filter: ReminderFilter, currentTeamMemberId: string): ReminderRow[] {
  switch (filter) {
    case "agencia":
      return reminders.filter((reminder) => reminder.scope === "agency");
    case "clientes":
      return reminders.filter((reminder) => reminder.scope === "client");
    case "minhas":
      return reminders.filter((reminder) => reminder.assigneeId === currentTeamMemberId);
    default:
      return reminders;
  }
}

export const REMINDER_FILTER_LABEL: Record<ReminderFilter, string> = {
  todas: "Todas",
  agencia: "Agência",
  clientes: "Clientes",
  minhas: "Minhas",
};
