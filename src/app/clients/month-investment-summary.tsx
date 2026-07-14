import Link from "next/link";
import { formatCurrency, formatDateWithYear } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL, type SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import type { MonthlyBudgetSprintInput } from "@/lib/monthly-budget";
import { MonthlyBudgetEditor } from "./monthly-budget-editor";

export interface MonthlyBudgetChangeSummary {
  lastEffectiveDate: string;
  lastPreviousAmount: number;
  lastNewAmount: number;
  changeCountThisMonth: number;
}

/**
 * Bloco 1 da hierarquia da página do cliente — "Investimento do mês"
 * (Etapa 58: unifica neste único card o que antes eram dois — o resumo
 * financeiro e o card separado "Orçamento de [mês]"/edição — removendo o
 * valor planejado duplicado entre eles). Reaproveita `AgencyInvestmentBar`
 * (traz junto o texto "X% realizado · Y% esperado até hoje") e
 * `MonthlyBudgetEditor` sem alterar nenhum cálculo; só reorganiza onde cada
 * informação aparece.
 */
export function MonthInvestmentSummary({
  planned,
  actual,
  expectedToDate,
  status,
  clientId,
  monthParam,
  monthLabel,
  sprints,
  currentAllocations,
  dailySpend,
  monthRange,
  effectiveDate,
  isAdmin,
  isClosedMonth,
  lastChange,
  historyHref,
}: {
  planned: number;
  actual: number;
  expectedToDate: number;
  status: SpendStatus;
  clientId: string;
  monthParam: string;
  monthLabel: string;
  sprints: MonthlyBudgetSprintInput[];
  currentAllocations: { date: string; amount: number }[];
  dailySpend: { date: string; spend: number }[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string | null;
  isAdmin: boolean;
  isClosedMonth: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
}) {
  // Etapa 63: nenhum cálculo de ritmo próprio aqui — o resumo do período
  // (planejado/realizado/esperado/status) monta o mesmo formato central
  // (`FinancialPeriodSummary`) que a barra e o texto de desvio já consomem
  // em qualquer outra tela (Sprints, Relatório), pra nunca haver uma segunda
  // conta de "quanto falta pro ritmo" só deste card.
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-medium text-foreground">Investimento do mês</h2>
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
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[status]}`}>
            {SPEND_STATUS_LABEL[status]}
          </span>
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
                  dailySpend={dailySpend}
                  monthRange={monthRange}
                  effectiveDate={effectiveDate}
                />
              )
            ))}
        </div>
      </div>

      {planned > 0 ? (
        <p className="mt-1 text-sm text-foreground">
          {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Sem planejamento configurado para este mês.</p>
      )}

      <div className="mt-1.5">
        <AgencyInvestmentBar summary={summary} />
      </div>

      {isAdmin && lastChange && lastChange.changeCountThisMonth > 1 && (
        <div className="mt-1 flex items-center justify-end text-xs text-muted-foreground">
          <Link href={historyHref} className="font-medium text-foreground hover:underline">
            Ver histórico
          </Link>
        </div>
      )}
    </div>
  );
}
