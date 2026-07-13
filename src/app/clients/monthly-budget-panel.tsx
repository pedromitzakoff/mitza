import Link from "next/link";
import { formatCurrency, formatDateWithYear } from "@/lib/format";
import type { MonthlyBudgetSprintInput } from "@/lib/monthly-budget";
import { MonthlyBudgetEditor } from "./monthly-budget-editor";

export interface MonthlyBudgetChangeSummary {
  lastEffectiveDate: string;
  lastPreviousAmount: number;
  lastNewAmount: number;
  changeCountThisMonth: number;
}

/**
 * Área compacta "Orçamento de [mês]" da página do cliente — mostra o valor
 * atual (soma das alocações do mês, mesma regra de sempre: orçamento mensal
 * = soma dos planejados das sprints do mês), a ação de editar (só admin, só
 * em mês não encerrado) e um indicador discreto de alteração quando já
 * houve pelo menos uma. Sem nenhuma UI de histórico se o mês nunca foi
 * alterado — a alteração é o que justifica mostrar mais informação.
 */
export function MonthlyBudgetPanel({
  clientId,
  monthParam,
  monthLabel,
  totalPlanned,
  sprintCount,
  sprints,
  currentAllocations,
  monthRange,
  effectiveDate,
  isAdmin,
  isClosedMonth,
  lastChange,
  historyHref,
}: {
  clientId: string;
  monthParam: string;
  monthLabel: string;
  totalPlanned: number;
  sprintCount: number;
  sprints: MonthlyBudgetSprintInput[];
  currentAllocations: { date: string; amount: number }[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string | null;
  isAdmin: boolean;
  isClosedMonth: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Orçamento de {monthLabel}
          </h2>
          {lastChange && (
            <span
              tabIndex={0}
              role="img"
              aria-label={`Orçamento alterado em ${formatDateWithYear(lastChange.lastEffectiveDate)}`}
              title={`Alterado em ${formatDateWithYear(lastChange.lastEffectiveDate)}\n${formatCurrency(lastChange.lastPreviousAmount)} → ${formatCurrency(lastChange.lastNewAmount)}`}
              className="cursor-help text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
            >
              ●
            </span>
          )}
        </div>
        <p className="mt-0.5 text-base font-semibold text-foreground">{formatCurrency(totalPlanned)}</p>
        <p className="text-[11px] text-muted-foreground">
          Distribuído em {sprintCount} sprint{sprintCount !== 1 ? "s" : ""} deste mês
          {lastChange && (
            <>
              {" · "}Alterado em {formatDateWithYear(lastChange.lastEffectiveDate)}
              {lastChange.changeCountThisMonth > 1 && ` · ${lastChange.changeCountThisMonth} alterações neste mês`}
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {isAdmin && lastChange && lastChange.changeCountThisMonth > 1 && (
          <Link href={historyHref} className="text-xs font-medium text-foreground hover:underline">
            Ver histórico
          </Link>
        )}
        {isAdmin &&
          (isClosedMonth ? (
            <span className="text-[11px] text-muted-foreground">Mês encerrado</span>
          ) : (
            effectiveDate && (
              <MonthlyBudgetEditor
                clientId={clientId}
                monthParam={monthParam}
                monthLabel={monthLabel}
                sprints={sprints}
                currentAllocations={currentAllocations}
                monthRange={monthRange}
                effectiveDate={effectiveDate}
              />
            )
          ))}
      </div>
    </div>
  );
}
