import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent, formatDayShortMonth } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { computeExpectedPct, resolveMonthPeriodSummary } from "@/lib/financial-period";
import { computeMonthlyBudgetPlan, computeUtilizedPct, type MonthlyBudgetPlanSprintInput } from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import { ChannelPlanEditor } from "./channel-plan-editor";

export interface MonthlyBudgetChangeSummary {
  lastEffectiveDate: string;
  lastPreviousAmount: number;
  lastNewAmount: number;
  changeCountThisMonth: number;
}

/** Campos comuns aos dois componentes deste arquivo — quem chama
 * (`[id]/page.tsx`) monta os dois com os MESMOS valores, nunca duas fontes
 * diferentes pro mesmo mês/investimento. */
interface SharedInvestmentInput {
  /** Orçamento mensal VIGENTE (Etapa 66) — sempre `resolveMonthlyBudget`,
   * nunca a soma dos planejamentos diários persistidos. */
  planned: number;
  actual: number;
  expectedToDate: number;
  status: SpendStatus;
  monthLabel: string;
  sprints: MonthlyBudgetPlanSprintInput[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string | null;
  isClosedMonth: boolean;
  /** Etapa 64: mês selecionado ainda não começou (`!isCurrentMonth &&
   * !isClosedMonth` — já calculado uma vez na página, nunca uma segunda
   * comparação de datas aqui). */
  isFutureMonth: boolean;
}

/** Recalcula `computeMonthlyBudgetPlan` — mesma função pura central de
 * sempre, consumida só por `MonthInvestmentActions` (o disclosure de
 * detalhes/ritmo recomendado) desde a Etapa "Revisão Performance — Visão
 * Geral do cliente" (`MonthInvestmentSummary` deixou de precisar de `plan`
 * quando a linha de diferença/restante/dias migrou pro diagnóstico único
 * de `AccountFollowUpPanel`). */
function resolvePlan(input: SharedInvestmentInput) {
  return input.effectiveDate
    ? computeMonthlyBudgetPlan({
        monthlyBudget: input.planned,
        monthActual: input.actual,
        monthRange: input.monthRange,
        effectiveDate: input.effectiveDate,
        sprints: input.sprints,
      })
    : null;
}

/**
 * "Investimento — X%" — a segunda leitura da seção "Ritmo do mês"
 * (`AccountFollowUpPanel`, Etapa "Revisão Performance — Visão Geral do
 * cliente"). Espelha `MonthlyGoalProgress` (mesma anatomia: título com o %
 * embutido + barra) — a fração ("R$417/R$1.000"), o "%" como número solto,
 * o texto de status ("Dentro do ritmo esperado") e a linha de
 * diferença/restante/dias saíram: a fração já está nos KPIs acima
 * ("Investimento" + "Planejado R$X"), e o status virou o DIAGNÓSTICO ÚNICO
 * da seção (compartilhado com Resultados, nunca mais dois textos de ritmo
 * independentes na mesma tela).
 *
 * "Ver detalhes do investimento"/"Editar planejamento"/"Ver histórico"
 * continuam fora deste componente — `MonthInvestmentActions` (mesmo
 * arquivo, mais abaixo), renderizado por `AccountFollowUpPanel` numa linha
 * própria, abaixo da seção "Ritmo do mês".
 *
 * Nenhum cálculo financeiro mudou — `classifySpendStatus`/
 * `resolveMonthPeriodSummary` continuam os mesmos.
 */
export function MonthInvestmentSummary({
  planned,
  actual,
  expectedToDate,
  status,
  monthLabel,
  monthRange,
  isClosedMonth,
  isFutureMonth,
  currentPlanningEndDate,
}: Pick<SharedInvestmentInput, "planned" | "actual" | "expectedToDate" | "status" | "monthLabel" | "monthRange" | "isClosedMonth" | "isFutureMonth"> & {
  /** Etapa "Horizonte de Planejamento": badge "Evento · até DD mmm" —
   * contexto, não ação, por isso continua aqui (não migrou pra
   * `MonthInvestmentActions`). */
  currentPlanningEndDate: string | null;
}) {
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);
  const pctRealizado = planned > 0 ? Math.round((actual / planned) * 100) : null;

  return (
    <div>
      {/* Badge de evento (Etapa "Horizonte de Planejamento" — impede o
          gestor de achar que ainda existem dias de operação até o fim do
          mês quando a campanha já terminou antes disso, ex.: Baile do
          Hawaii) — sempre no topo do conteúdo, independente do resto. Mesmo
          texto/condição de sempre, só a posição relativa mudou. */}
      {currentPlanningEndDate && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Evento · até {formatDayShortMonth(currentPlanningEndDate)}
        </p>
      )}

      {planned <= 0 ? (
        <EmptyState>Sem planejamento configurado para este mês.</EmptyState>
      ) : (
        <div>
          <p className="text-sm font-medium text-overview-text-primary">
            Investimento{pctRealizado !== null ? <> — <span className="tabular-nums">{pctRealizado}%</span></> : null}
          </p>
          <div className="mt-1.5">
            <AgencyInvestmentBar
              summary={summary}
              monthTemporalStatus={isFutureMonth ? "futuro" : isClosedMonth ? "passado" : undefined}
              showLegend={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Ações do investimento — "Ver detalhes do investimento" (disclosure com o
 * mesmo diagnóstico detalhado de sempre), "Editar planejamento"
 * (`ChannelPlanEditor`) e "Ver histórico". Extraído de `MonthInvestmentSummary`
 * nesta etapa (Etapa "Simetria Performance x Investimento") — são AÇÕES,
 * não fazem parte da anatomia espelhada com Performance, e antes deformavam
 * a altura da coluna de Investimento. `[id]/page.tsx` renderiza este
 * componente numa linha compartilhada, abaixo do grid de 2 colunas —
 * nunca dentro de uma coluna específica.
 *
 * Recalcula `plan`/`pctRealizado`/`expectedPct` a partir dos mesmos inputs
 * primitivos que `MonthInvestmentSummary` já recebe (nenhum estado
 * compartilhado entre os dois) — mesma fórmula central de sempre, só
 * chamada de novo; nenhum resultado diferente pro mesmo mês.
 */
export function MonthInvestmentActions({
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
  isClosedByHorizonOnly,
  isFutureMonth,
  lastChange,
  historyHref,
  performanceGoal,
  channels,
  byChannel,
  calendarMonthRange,
  currentPlanningEndDate,
}: SharedInvestmentInput & {
  clientId: string;
  monthParam: string;
  isAdmin: boolean;
  /** Etapa "Horizonte de Planejamento": `true` quando `isClosedMonth` veio
   * do horizonte de evento (mês civil ainda em andamento, só a campanha já
   * terminou) — só decide o TEXTO do rodapé ("Mês encerrado" x "Período de
   * planejamento encerrado"), nunca nenhum cálculo. */
  isClosedByHorizonOnly: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
  performanceGoal: PerformanceGoal | null;
  /** Etapa "Planejamento por Canal": canais selecionáveis (Meta/Google) e o
   * plano vigente de cada um — repassados direto pro `ChannelPlanEditor`,
   * nunca recalculados aqui. */
  channels: TrafficChannel[];
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  /** Etapa "Horizonte de Planejamento": mês CIVIL inteiro (nunca o horizonte
   * já encurtado, que é o que `monthRange` acima passou a ser) — só pro
   * `ChannelPlanEditor` montar o seletor de data e o rótulo "Período de
   * planejamento". */
  calendarMonthRange: { firstDay: string; lastDay: string };
  currentPlanningEndDate: string | null;
}) {
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);
  const pctRealizado = planned > 0 ? (actual / planned) * 100 : null;
  const expectedPct = computeExpectedPct(summary);
  const utilizedPct = computeUtilizedPct(planned, actual);
  const ritmoDiff = actual - expectedToDate;
  const ritmoDiffText =
    ritmoDiff < 0 ? `${formatCurrency(Math.abs(ritmoDiff))} abaixo` : ritmoDiff > 0 ? `${formatCurrency(ritmoDiff)} acima` : "Sem diferença";
  const plan = resolvePlan({ planned, actual, expectedToDate, status, monthLabel, sprints, monthRange, effectiveDate, isClosedMonth, isFutureMonth });

  const closedDiffText = (() => {
    if (planned <= 0) return null;
    const diff = planned - actual;
    if (diff > 0) return `${formatCurrency(diff)} abaixo do orçamento planejado`;
    if (diff < 0) return `${formatCurrency(Math.abs(diff))} acima do orçamento planejado`;
    return "Orçamento utilizado integralmente";
  })();

  const hasDetails = planned > 0;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
      {hasDetails ? (
        <details className="group/details min-w-0 flex-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[11px] font-medium text-overview-text-muted hover:text-overview-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-brand">
            <span className="mitza-chevron text-xs group-open/details:rotate-90">▸</span>
            <span className="group-open/details:hidden">Ver detalhes do investimento</span>
            <span className="hidden group-open/details:inline">Ocultar detalhes do investimento</span>
          </summary>

          <div className="mt-2 flex flex-col gap-3">
            {!isFutureMonth && !isClosedMonth && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Detalhes do acompanhamento</p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Realizado</p>
                    <p className="text-sm font-medium text-overview-text-primary">
                      {pctRealizado !== null ? formatPercent(pctRealizado) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Esperado hoje</p>
                    <p className="text-sm font-medium text-overview-text-primary">{formatPercent(expectedPct)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Esperado até hoje</p>
                    <p className="text-sm font-medium text-overview-text-primary">{formatCurrency(expectedToDate)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Diferença para o ritmo</p>
                    <p
                      className={`text-sm font-medium ${
                        ritmoDiff < 0
                          ? "text-amber-600 dark:text-amber-400"
                          : ritmoDiff > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-overview-text-primary"
                      }`}
                    >
                      {ritmoDiffText}
                    </p>
                  </div>
                  {plan && !plan.isBudgetReached && (
                    <div>
                      <p className="text-[11px] text-overview-text-muted">Ritmo recomendado</p>
                      <p className="text-sm font-medium text-overview-text-primary">{formatCurrency(plan.recommendedDaily)}/dia</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isClosedMonth && (utilizedPct != null || closedDiffText) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Detalhes do acompanhamento</p>
                {utilizedPct != null && (
                  <p className="mt-1 text-sm text-overview-text-primary">{Math.round(utilizedPct)}% do orçamento utilizado</p>
                )}
                {closedDiffText && <p className="mt-0.5 text-[11px] text-overview-text-muted">{closedDiffText}</p>}
              </div>
            )}

            {isFutureMonth && plan && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Ritmo planejado inicial</p>
                <p className="mt-1 text-sm font-medium text-overview-text-primary">{formatCurrency(plan.recommendedDaily)}/dia</p>
                <p className="mt-0.5 text-[11px] text-overview-text-muted">
                  {plan.eligibleDaysCount} dias em {monthLabel}
                </p>
              </div>
            )}

            {!isFutureMonth && !isClosedMonth && plan && !plan.isBudgetReached && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Regra da projeção</p>
                <p className="mt-1 text-[11px] text-overview-text-muted">O cálculo considera o dia de hoje como disponível para ajuste.</p>
              </div>
            )}
          </div>
        </details>
      ) : (
        <span />
      )}

      <div className="flex shrink-0 flex-col items-end gap-1">
        {isAdmin &&
          (isClosedMonth ? (
            <span className="text-[11px] text-overview-text-muted">
              {isClosedByHorizonOnly ? "Período de planejamento encerrado" : "Mês encerrado"}
            </span>
          ) : (
            effectiveDate && (
              <ChannelPlanEditor
                clientId={clientId}
                monthParam={monthParam}
                monthLabel={monthLabel}
                monthRange={calendarMonthRange}
                currentPlanningEndDate={currentPlanningEndDate}
                channels={channels}
                byChannel={byChannel}
                performanceGoal={performanceGoal}
              />
            )
          ))}
        {isAdmin && lastChange && lastChange.changeCountThisMonth > 1 && (
          <Link href={historyHref} className="text-xs font-medium text-overview-text-primary hover:underline">
            Ver histórico
          </Link>
        )}
      </div>
    </div>
  );
}
