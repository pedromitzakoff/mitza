import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import { resolveMonthPeriodSummary, computeRitmoDiff } from "@/lib/financial-period";
import { AlertsSummaryLine } from "./current-client-group";

const TEMPORAL_LABEL = {
  futura: "futura",
  atual: "atual",
  concluida: "concluída",
} as const;

const TEMPORAL_TEXT_CLASSES = {
  futura: "text-muted-foreground",
  atual: "font-medium text-brand",
  concluida: "text-muted-foreground",
} as const;

const ACTIVITY_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
};

/** Mesmo texto de ritmo usado em SprintFinancialBar (sprint), aqui reaplicado
 * ao período mensal — nunca compara o realizado com 100% do orçamento antes
 * do mês acabar, sempre com o esperado até a data observada. */
function ritmoText(status: "dentro" | "acima" | "abaixo" | "sem_meta", diffPct: number): string | null {
  if (status === "acima") return `${Math.round(diffPct)} p.p. acima do ritmo`;
  if (status === "abaixo") return `${Math.round(diffPct)} p.p. abaixo do ritmo`;
  if (status === "dentro") return "Dentro do ritmo esperado";
  return null;
}

/**
 * Resumo mensal compacto por cliente — visão "Mensal" da tela Sprints.
 * Todo valor financeiro aqui vem de `resolveMonthPeriodSummary` (empacota
 * `card.monthPlanned/monthActual/monthExpectedToDate/monthStatus`, os
 * mesmos campos que a Visão Geral e a página do cliente já usam — nenhuma
 * conta nova). Recolhido por padrão; ao expandir mostra a lista das sprints
 * do mês com o status de cada uma (concluída/atual/futura), sem abrir
 * nenhuma sprint individual automaticamente.
 */
export function SprintMonthlyClientGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const expectedPct = summary.planned > 0 ? (summary.expectedToDate / summary.planned) * 100 : 0;
  const diffPct = Math.abs((summary.pct ?? 0) - expectedPct);
  const topAlert = card.alerts[0];
  const remainingAlerts = card.alerts.length - 1;
  const activityLabel = card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel;

  return (
    <details className="group/client rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground transition-transform group-open/client:rotate-90">
          ▸
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <Link href={`/clients/${card.clientId}`} className="font-bold text-foreground hover:underline">
              {card.clientName}
            </Link>
            {primaryManagerName && (
              <span className="shrink-0 text-xs text-muted-foreground">{primaryManagerName}</span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">{monthLabel}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(summary.actual)} / {formatCurrency(summary.planned)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {summary.pct !== null ? `${Math.round(summary.pct)}% realizado no mês` : "Sem orçamento mensal"}
            </span>
            {summary.planned > 0 && (
              <span className="tabular-nums text-muted-foreground">
                Esperado até hoje no mês: {Math.round(expectedPct)}%
              </span>
            )}
            <span className={ACTIVITY_TEXT_CLASSES[card.activityStatus]}>Última atividade: {activityLabel}</span>
          </div>

          {summary.planned > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ritmoText(summary.status, diffPct)}
              {" · "}
              Diferença pro ritmo esperado no mês: {formatCurrency(diff)}
            </p>
          )}

          {topAlert && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
            </div>
          )}
        </div>
      </summary>

      <div className="border-t border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sprints do mês</p>
        {card.monthSprints.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs">
            {card.monthSprints.map((sprint, index) => (
              <li key={sprint.sprintId} className="flex items-center justify-between">
                <span className="text-foreground">Sprint {index + 1}</span>
                <span className={TEMPORAL_TEXT_CLASSES[sprint.temporalStatus]}>
                  {TEMPORAL_LABEL[sprint.temporalStatus]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">Nenhuma sprint neste mês.</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <Link href={`/clients/${card.clientId}`} className="font-medium text-brand hover:underline">
            Abrir cliente
          </Link>
        </div>
      </div>
    </details>
  );
}
