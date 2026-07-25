import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDateWithYear, formatPercent } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { computeExpectedPct, resolveMonthPeriodSummary } from "@/lib/financial-period";
import { computeMonthlyBudgetPlan, computeUtilizedPct, type MonthlyBudgetPlanSprintInput } from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";
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
 * pode ser investido este mês" (mesmos números, nenhuma fórmula nova).
 * `classifySpendStatus`/`SPEND_STATUS_*` continuam intactos e em uso em
 * Visão Geral, Sprints e Relatório — não fazem parte desta seção.
 *
 * Refinamento visual (Etapa 73): as informações de diagnóstico (percentual
 * realizado/esperado detalhado, esperado em reais, diferença para o ritmo,
 * legenda da barra, explicação do dia atual) saíram do card sempre visível
 * e passaram pra "Ver detalhes do investimento", recolhida por padrão —
 * mesmo padrão de disclosure (`<details>/<summary>` nativo) já usado em
 * "Histórico" dos comentários/análises. Nenhuma fórmula mudou: os mesmos
 * valores só passaram a ter uma única apresentação (nunca mais a mesma
 * diferença repetida em duas frases — a barra deixou de mostrar sua própria
 * legenda/desvio aqui via `showLegend={false}`, unificando tudo dentro dos
 * detalhes).
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
  performanceGoal,
  targetResultCount,
  targetCostPerResult,
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
  /** Metas vigentes do planejamento mensal (Etapa "Planejamento Mensal
   * 1.0") — já resolvidas por `resolveMonthlyPerformanceTargets` por quem
   * chama; este componente só repassa pro editor. */
  performanceGoal: PerformanceGoal | null;
  targetResultCount: number | null;
  targetCostPerResult: number | null;
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
  // Etapa 73, seção 17: uma única apresentação da diferença (linha "Diferença
  // para o ritmo" dentro dos detalhes) — nunca mais repetida como "abaixo do
  // investimento esperado até hoje" (era o texto da própria barra, agora
  // suprimido via `showLegend={false}`) e como "abaixo do ritmo esperado" ao
  // mesmo tempo.
  const ritmoDiffText =
    ritmoDiff < 0 ? `${formatCurrency(Math.abs(ritmoDiff))} abaixo` : ritmoDiff > 0 ? `${formatCurrency(ritmoDiff)} acima` : "Sem diferença";
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

  // Etapa 73: conteúdo de "Ver detalhes do investimento" — varia conforme o
  // estado temporal do mês (mesmos dados que já existiam em cada branch,
  // só reagrupados numa única área recolhível em vez de sempre visíveis).
  const hasDetails = planned > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
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
                  performanceGoal={performanceGoal}
                  currentTargetResultCount={targetResultCount}
                  currentTargetCostPerResult={targetCostPerResult}
                />
              )
            ))}
        </div>
      </div>

      {planned <= 0 ? (
        <EmptyState className="mt-1">Sem planejamento configurado para este mês.</EmptyState>
      ) : isFutureMonth ? (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(planned)} planejados para {monthLabel}
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} monthTemporalStatus="futuro" showLegend={false} />
          </div>
          {plan && (
            <p className="mt-1 text-sm font-semibold text-brand">
              Investimento diário planejado: {formatCurrency(plan.recommendedDaily)}/dia
            </p>
          )}
        </>
      ) : isClosedMonth ? (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} monthTemporalStatus="passado" showLegend={false} />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-foreground">
            {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar summary={summary} showLegend={false} />
          </div>

          {/* AÇÃO — quanto ainda precisa ser investido daqui pra frente
              (`computeMonthlyBudgetPlan`, nunca a mesma fórmula do ritmo
              acima). Único texto sempre visível além do resumo/barra. */}
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
        </>
      )}

      {hasDetails && (
        <details className="group/details mt-2 border-t border-border pt-1.5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[11px] font-medium text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-brand">
            <span className="mitza-chevron text-xs group-open/details:rotate-90">▸</span>
            <span className="group-open/details:hidden">Ver detalhes do investimento</span>
            <span className="hidden group-open/details:inline">Ocultar detalhes do investimento</span>
          </summary>

          <div className="mt-2 flex flex-col gap-3">
            {!isFutureMonth && !isClosedMonth && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Detalhes do acompanhamento
                </p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Realizado</p>
                    <p className="text-sm font-medium text-foreground">
                      {pctRealizado !== null ? formatPercent(pctRealizado) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Esperado hoje</p>
                    <p className="text-sm font-medium text-foreground">{formatPercent(expectedPct)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Esperado até hoje</p>
                    <p className="text-sm font-medium text-foreground">{formatCurrency(expectedToDate)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Diferença para o ritmo</p>
                    <p
                      className={`text-sm font-medium ${
                        ritmoDiff < 0
                          ? "text-amber-600 dark:text-amber-400"
                          : ritmoDiff > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-foreground"
                      }`}
                    >
                      {ritmoDiffText}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isClosedMonth && (utilizedPct != null || closedDiffText) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Detalhes do acompanhamento
                </p>
                {utilizedPct != null && (
                  <p className="mt-1 text-sm text-foreground">{Math.round(utilizedPct)}% do orçamento utilizado</p>
                )}
                {closedDiffText && <p className="mt-0.5 text-[11px] text-muted-foreground">{closedDiffText}</p>}
              </div>
            )}

            {isFutureMonth && plan && (
              <p className="text-[11px] text-muted-foreground">
                {plan.eligibleDaysCount} dias em {monthLabel}
              </p>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Leitura da barra
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-brand" aria-hidden="true" />
                  Azul: realizado
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-0.5 bg-navy dark:bg-white" aria-hidden="true" />
                  Marcador: esperado hoje
                </span>
              </p>
            </div>

            {!isFutureMonth && !isClosedMonth && plan && !plan.isBudgetReached && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Regra da projeção
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  O cálculo considera o dia de hoje como disponível para ajuste.
                </p>
              </div>
            )}
          </div>
        </details>
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
