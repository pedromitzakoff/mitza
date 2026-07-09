import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency, formatDateRange } from "@/lib/format";

const STATUS_LABEL = {
  dentro: "Dentro do esperado",
  acima: "Acima do esperado",
  abaixo: "Abaixo do esperado",
} as const;

const STATUS_BADGE_CLASSES = {
  dentro: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
} as const;

const PROGRESS_BAR_CLASSES = {
  dentro: "bg-zinc-500",
  acima: "bg-red-500",
  abaixo: "bg-amber-500",
} as const;

const DIFFERENCE_TEXT_CLASSES = {
  dentro: "",
  acima: "text-red-600 dark:text-red-400",
  abaixo: "text-amber-600 dark:text-amber-400",
} as const;

export function SprintCard({ sprint }: { sprint: SprintFinancials }) {
  const difference = sprint.actualSpend - sprint.plannedSpend;
  const barWidth = Math.min(Math.max(sprint.progressPct, 0), 100);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-black dark:text-zinc-50">
            {formatDateRange(sprint.startDate, sprint.endDate)}
          </p>
          <p className="text-xs text-zinc-500">
            Planejado {formatCurrency(sprint.plannedSpend)} · Gasto até agora{" "}
            {formatCurrency(sprint.actualSpend)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[sprint.status]}`}
        >
          {STATUS_LABEL[sprint.status]}
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${PROGRESS_BAR_CLASSES[sprint.status]}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Diferença:{" "}
        <span className={DIFFERENCE_TEXT_CLASSES[sprint.status]}>
          {difference > 0 ? "+" : ""}
          {formatCurrency(difference)}
        </span>
      </p>

      <p className="mt-3 text-xs text-zinc-400">Comentários chegam na Etapa 7.</p>
    </div>
  );
}
