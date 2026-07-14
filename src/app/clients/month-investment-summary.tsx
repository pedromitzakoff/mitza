import Link from "next/link";
import { formatCurrency, formatDateWithYear } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import { computeMonthlyInvestmentRecommendation, computeUtilizedPct, type MonthlyBudgetSprintInput } from "@/lib/monthly-budget";
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
 * valor planejado duplicado entre eles).
 *
 * Etapa 64: parou de responder "onde o investimento deveria estar hoje"
 * (removidos o marcador/linha da barra, o selo Acima/Abaixo/Dentro e o texto
 * de desvio — só nesta seção; `classifySpendStatus`/`SPEND_STATUS_*`
 * continuam intactos e em uso em Visão Geral, Sprints e Relatório). A
 * pergunta que a seção responde agora é operacional: quanto investir por dia
 * daqui pra frente pra fechar o mês no orçamento planejado — sempre via
 * `computeMonthlyInvestmentRecommendation` (nunca uma conta própria deste
 * componente), a mesma função central que também sustenta a redistribuição
 * da sprint atual/futuras.
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
  isFutureMonth,
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
  /** Etapa 64: mês selecionado ainda não começou (`!isCurrentMonth &&
   * !isClosedMonth` — já calculado uma vez na página, nunca uma segunda
   * comparação de datas aqui) — muda o texto principal e a recomendação
   * diária vira "investimento diário planejado inicial" (seção 11). */
  isFutureMonth: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
}) {
  // A barra (sem marcador) ainda usa o formato central `FinancialPeriodSummary`
  // só pra decidir preenchimento/estouro — nenhum outro campo dele (status,
  // expectedToDate) é lido por esta seção.
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);
  const utilizedPct = computeUtilizedPct(planned, actual);
  // Só existe recomendação diária quando há uma data de efeito vigente —
  // `effectiveDate` é `null` exatamente quando o mês está encerrado (seção 10:
  // mês passado nunca mostra recomendação diária).
  const recommendation = effectiveDate
    ? computeMonthlyInvestmentRecommendation(planned, actual, monthRange, effectiveDate)
    : null;

  const closedDiffText = (() => {
    if (planned <= 0) return null;
    const diff = planned - actual;
    if (diff > 0) return `${formatCurrency(diff)} abaixo do orçamento planejado`;
    if (diff < 0) return `${formatCurrency(Math.abs(diff))} acima do orçamento planejado`;
    return "Orçamento utilizado integralmente";
  })();

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

      {planned <= 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Sem planejamento configurado para este mês.</p>
      ) : isFutureMonth ? (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(planned)} planejados para {monthLabel}
          </p>
          {recommendation && (
            <>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {recommendation.eligibleDaysCount} dias em {monthLabel}
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento diário planejado: {formatCurrency(recommendation.recommendedDaily)}/dia
              </p>
            </>
          )}
        </>
      ) : isClosedMonth ? (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} showExpectedMarker={false} />
          </div>
          {utilizedPct != null && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{Math.round(utilizedPct)}% do orçamento utilizado</p>
          )}
          {closedDiffText && <p className="mt-0.5 text-[11px] text-muted-foreground">{closedDiffText}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} showExpectedMarker={false} />
          </div>
          {utilizedPct != null && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{Math.round(utilizedPct)}% do orçamento mensal utilizado</p>
          )}
          {recommendation?.isBudgetReached ? (
            <>
              <p className="mt-1 text-sm font-medium text-foreground">Orçamento mensal atingido</p>
              {recommendation.overageAmount > 0 && (
                <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
                  {formatCurrency(recommendation.overageAmount)} acima do orçamento planejado
                </p>
              )}
              <p className="mt-1 text-sm font-semibold text-brand">Investimento diário recomendado: {formatCurrency(0)}/dia</p>
            </>
          ) : recommendation && recommendation.eligibleDaysCount === 1 ? (
            <>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Restam {formatCurrency(recommendation.remainingBudget)} para 1 dia até o fim do mês
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento recomendado hoje: {formatCurrency(recommendation.remainingBudget)}
              </p>
            </>
          ) : recommendation ? (
            <>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Restam {formatCurrency(recommendation.remainingBudget)} para {recommendation.eligibleDaysCount} dias até o fim do mês
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento diário recomendado: {formatCurrency(recommendation.recommendedDaily)}/dia
              </p>
            </>
          ) : null}
        </>
      )}

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
