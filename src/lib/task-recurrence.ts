import type { TaskRecurrence } from "@/lib/supabase/database.types";

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Data da próxima ocorrência de uma tarefa recorrente, a partir da due_date
 * da ocorrência que acabou de ser marcada como feita. Retorna null se a
 * tarefa não é recorrente.
 */
export function nextDueDate(dueDate: string, recurrence: TaskRecurrence): string | null {
  if (recurrence === "nenhuma") return null;

  const date = parseDateUTC(dueDate);

  switch (recurrence) {
    case "diaria":
      date.setUTCDate(date.getUTCDate() + 1);
      return toDateString(date);
    case "semanal":
      date.setUTCDate(date.getUTCDate() + 7);
      return toDateString(date);
    case "mensal": {
      // Não usar setUTCMonth direto: em dias como 31 ele estoura pro mês
      // depois do seguinte quando o mês seguinte tem menos dias (ex.: 31/01
      // -> 31/02 não existe -> viraria 03/03). Em vez disso, tranca no
      // último dia do mês seguinte.
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const day = date.getUTCDate();
      const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
      return toDateString(new Date(Date.UTC(year, month + 1, Math.min(day, lastDayOfNextMonth))));
    }
  }
}
