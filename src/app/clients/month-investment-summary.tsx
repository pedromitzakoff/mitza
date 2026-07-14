import Link from "next/link";
import { formatCurrency, formatDateWithYear, formatPercent } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { computeExpectedPct, resolveMonthPeriodSummary } from "@/lib/financial-period";
import { computeMonthlyBudgetPlan, computeUtilizedPct, type MonthlyBudgetPlanSprintInput } from "@/lib/monthly-budget";
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
 * Etapa 66: a "orçamento mensal vigente" (`planned`) e o "planejamento
 * restante" nunca mais vêm de `sprint_planned_allocations` — sempre de
 * `computeMonthlyBudgetPlan`, a única função central que decide "quanto ainda
 * pode ser investido este mês" e como isso se divide entre a sprint atual e
 * as sprints futuras (mesmos números exibidos em cada `SprintCard` abaixo).
 * `classifySpendStatus`/`SPEND_STATUS_*` continuam intactos e em uso em
 * Visão Geral, Sprints e Relatório — não fazem parte desta seção.
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
  monthRange,
  effectiveDate,
  isAdmin,
  isClosedMonth,
  isFutureMonth,
  lastChange,
  historyHref,
}: {
  /** Orçamento mensal VIGENTE (Etapa 66) — sempre `resolveMonthlyBudget`,
   * nunca a soma dos planejamentos diários persistidos. */
  planned: number;
  actual: number;
  expectedToDate: number;
  status: SpendStatus;
  clientId: string;
  monthParam: string;
  monthLabel: string;
  sprints: MonthlyBudgetPlanSprintInput[];
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
  // RITMO (Etapa 68, seções 9/10) — "onde deveríamos estar hoje", sempre a
  // mesma fórmula central de calendário (`monthExpectedToDate`, já recebida
  // pronta via prop `expectedToDate`), nunca planejamento de sprint/histórico.
  const pctRealizado = planned > 0 ? (actual / planned) * 100 : null;
  const expectedPct = computeExpectedPct(summary);
  const ritmoDiff = actual - expectedToDate;
  const ritmoDiffText =
    ritmoDiff < 0
      ? `${formatCurrency(Math.abs(ritmoDiff))} abaixo do ritmo esperado`
      : ritmoDiff > 0
        ? `${formatCurrency(ritmoDiff)} acima do ritmo esperado`
        : "Dentro do ritmo esperado";
  // Só existe recomendação diária quando há uma data de efeito vigente —
  // `effectiveDate` é `null` exatamente quando o mês está encerrado (seção 10:
  // mês passado nunca mostra recomendação diária).
  const plan = effectiveDate
    ? computeMonthlyBudgetPlan({ monthlyBudget: planned, monthActual: actual, monthRange, effectiveDate, sprints })
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
                  monthRange={monthRange}
                  effectiveDate={effectiveDate}
                  currentMonthlyBudget={planned}
                  monthActual={actual}
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
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} monthTemporalStatus="futuro" />
          </div>
          {plan && (
            <>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {plan.eligibleDaysCount} dias em {monthLabel}
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento diário planejado: {formatCurrency(plan.recommendedDaily)}/dia
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
            <AgencyInvestmentBar summary={summary} monthTemporalStatus="passado" />
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
            <AgencyInvestmentBar summary={summary} />
          </div>

          {/* RITMO — Etapa 68, seção 9/10: onde deveríamos estar hoje, nunca
              misturado com a AÇÃO (saldo/recomendação diária) abaixo. */}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {pctRealizado !== null ? formatPercent(pctRealizado) : "—"} realizado · {formatPercent(expectedPct)} esperado hoje
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Esperado até hoje: {formatCurrency(expectedToDate)}</p>
          <p
            className={`mt-0.5 text-[11px] font-medium ${
              ritmoDiff < 0
                ? "text-amber-600 dark:text-amber-400"
                : ritmoDiff > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
            }`}
          >
            {ritmoDiffText}
          </p>

          {/* AÇÃO — quanto ainda precisa ser investido daqui pra frente
              (`computeMonthlyBudgetPlan`, nunca a mesma fórmula do ritmo
              acima). */}
          {plan?.isBudgetReached ? (
            <>
              <p className="mt-2 text-sm font-medium text-foreground">Orçamento mensal atingido</p>
              {plan.overageAmount > 0 && (
                <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
                  {formatCurrency(plan.overageAmount)} acima do orçamento planejado
                </p>
              )}
              <p className="mt-1 text-sm font-semibold text-brand">Investimento diário recomendado: {formatCurrency(0)}/dia</p>
            </>
          ) : plan && plan.eligibleDaysCount === 1 ? (
            <>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Restam {formatCurrency(plan.remainingBudget)} para 1 dia, incluindo hoje
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento recomendado hoje: {formatCurrency(plan.remainingBudget)}
              </p>
            </>
          ) : plan ? (
            <>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Restam {formatCurrency(plan.remainingBudget)} para {plan.eligibleDaysCount} dias, incluindo hoje
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                Investimento diário recomendado: {formatCurrency(plan.recommendedDaily)}/dia
              </p>
            </>
          ) : null}
          {plan && !plan.isBudgetReached && (
            <p
              className="mt-0.5 text-[11px] text-muted-foreground"
              title="O dia de hoje entra no cálculo porque o gestor ainda pode ajustar o investimento das campanhas durante o dia. Amanhã, o sistema recalcula automaticamente com os dias restantes."
            >
              O cálculo considera o dia de hoje como disponível para ajuste.
            </p>
          )}
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
