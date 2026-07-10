import type { SpendStatus } from "@/lib/spend-status";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { MonthProjection, TaskCounts } from "@/lib/client-metrics";
import type { AccountHealth } from "@/lib/attention-alerts";
import { formatCurrency } from "@/lib/format";

const PROJECTION_LABEL: Record<SpendStatus, string> = {
  dentro: "No ritmo",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Meta não configurada",
};

const HEALTH_LABEL: Record<AccountHealth, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critico: "Crítico",
};

const HEALTH_BADGE_CLASSES: Record<AccountHealth, string> = {
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function MetricCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function ClientMetricsCards({
  monthPlanned,
  monthActual,
  projection,
  taskCounts,
  health,
}: {
  monthPlanned: number;
  monthActual: number;
  projection: MonthProjection;
  taskCounts: TaskCounts;
  health: AccountHealth;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <MetricCard label="Investimento">
        <p className="text-base font-semibold tabular-nums text-foreground">{formatCurrency(monthActual)}</p>
        <p className="text-xs text-muted-foreground">de {formatCurrency(monthPlanned)} planejado</p>
      </MetricCard>

      <MetricCard label="Projeção do mês">
        <p className="text-base font-semibold tabular-nums text-foreground">
          {formatCurrency(projection.projectedSpend)}
        </p>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[projection.status]}`}
        >
          {PROJECTION_LABEL[projection.status]}
          {projection.projectedPct !== null && ` · ${projection.projectedPct.toFixed(0)}%`}
        </span>
      </MetricCard>

      <MetricCard label="Tarefas do mês">
        <p className="text-base font-semibold tabular-nums text-foreground">
          {taskCounts.done}/{taskCounts.total}
        </p>
        <p className="text-xs text-muted-foreground">
          {taskCounts.pending} pendente{taskCounts.pending !== 1 ? "s" : ""} ·{" "}
          <span className={taskCounts.overdue > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}>
            {taskCounts.overdue} atrasada{taskCounts.overdue !== 1 ? "s" : ""}
          </span>
        </p>
      </MetricCard>

      <MetricCard label="Reuniões">
        <p className="text-sm text-muted-foreground">Em breve</p>
      </MetricCard>

      <MetricCard label="Saúde da conta">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${HEALTH_BADGE_CLASSES[health]}`}
        >
          {HEALTH_LABEL[health]}
        </span>
      </MetricCard>
    </div>
  );
}
