import type { SpendStatus } from "@/lib/spend-status";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { MonthProjection, TaskCounts } from "@/lib/client-metrics";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import { formatCurrency } from "@/lib/format";

const PROJECTION_LABEL: Record<SpendStatus, string> = {
  dentro: "No ritmo",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
};

/** Cor de acento da última atividade — o mesmo sinal que já vira alerta em
 * "Precisa de atenção" quando é atenção/inativo, só reaproveitado aqui como
 * destaque visual em vez de mais um badge separado. */
const ACTIVITY_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
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

/**
 * Só os 4 indicadores essenciais pra decisão rápida no primeiro viewport —
 * saúde da conta já aparece no ClientContextBar (sticky), então não repete
 * aqui; tarefas atrasadas (não "tarefas do mês" done/total, que já aparece
 * na barra de progresso de cada sprint) e última atividade substituem os
 * cards de "Reuniões" (vazio) e "Saúde da conta" (duplicado) de antes.
 */
export function ClientMetricsCards({
  monthPlanned,
  monthActual,
  projection,
  taskCounts,
  activityStatus,
  activityLabel,
}: {
  monthPlanned: number;
  monthActual: number;
  projection: MonthProjection;
  taskCounts: TaskCounts;
  activityStatus: OperationalActivityStatus;
  activityLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <MetricCard label="Tarefas atrasadas">
        <p
          className={`text-base font-semibold tabular-nums ${taskCounts.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
        >
          {taskCounts.overdue}
        </p>
        <p className="text-xs text-muted-foreground">de {taskCounts.total} tarefas no mês</p>
      </MetricCard>

      <MetricCard label="Última atividade">
        <p className={`text-base font-semibold ${ACTIVITY_TEXT_CLASSES[activityStatus]}`}>{activityLabel}</p>
      </MetricCard>
    </div>
  );
}
