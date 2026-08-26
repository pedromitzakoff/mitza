import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent, formatDayShortMonth } from "@/lib/format";
import { RITMO_STATUS_TEXT, type SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { computeDeviationCurrency, computeExpectedPct, resolveMonthPeriodSummary } from "@/lib/financial-period";
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

/** Recalcula `computeMonthlyBudgetPlan` — mesma função pura central, mesmos
 * inputs que `MonthInvestmentSummary` já recebe como props; chamada duas
 * vezes (aqui e no core) porque os dois viraram componentes irmãos (Etapa
 * "Simetria Performance x Investimento" — "Ver detalhes"/"Editar
 * planejamento" saíram do core pra uma linha de ações compartilhada,
 * fora do grid de colunas), nunca dois RESULTADOS diferentes pro mesmo mês
 * (mesma fórmula, sem estado compartilhado entre os dois — recomputar uma
 * conta pura e barata é seguro, o que não pode existir é uma SEGUNDA regra). */
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
 * Bloco 1 da hierarquia da página do cliente — "Investimento do mês".
 *
 * Etapa "Simetria Performance x Investimento": este componente (o CORE —
 * label, realizado/planejado, %, barra, status) e `MonthlyGoalProgress`
 * (Performance) precisam ser um PAR ESPELHADO — mesma anatomia, mesma
 * barra, mesmo texto de status, mesma altura aproximada. Por isso:
 * - a barra continua `AgencyInvestmentBar` (nunca mudou), mas a legenda de
 *   cores solta abaixo dela ("Realizado | Esperado hoje") saiu — o
 *   marcador da própria barra já tem um label (`formatExpectedMarkerLabel`,
 *   "Esperado hoje · X%"), repetir isso embaixo era a redundância que o
 *   usuário pediu pra cortar;
 * - o status principal deixou de ser uma frase longa e específica
 *   (`formatDeviationCurrencyText`, "R$330 abaixo do investimento esperado
 *   até hoje") e virou a MESMA estrutura curta de Performance
 *   (`RITMO_STATUS_TEXT`, compartilhado — "Abaixo do ritmo esperado"); o
 *   valor específico (R$/Restam/dias) migrou pra uma linha secundária
 *   separada, igual Performance tem "Esperado hoje: X";
 * - "Ver detalhes do investimento"/"Editar planejamento"/"Ver histórico"
 *   saíram DESTE componente — Performance não tem ação equivalente, e
 *   deformavam a altura da coluna. Viraram `MonthInvestmentActions` (mesmo
 *   arquivo, mais abaixo), renderizado por `[id]/page.tsx` numa linha
 *   COMPARTILHADA abaixo das duas colunas (nunca uma ação inventada pra
 *   Performance só pra preencher espaço).
 *
 * Nenhum cálculo financeiro mudou — `classifySpendStatus`/
 * `computeMonthlyBudgetPlan`/`computeExpectedPct` continuam os mesmos.
 */
export function MonthInvestmentSummary({
  planned,
  actual,
  expectedToDate,
  status,
  monthLabel,
  sprints,
  monthRange,
  effectiveDate,
  isClosedMonth,
  isFutureMonth,
  currentPlanningEndDate,
}: SharedInvestmentInput & {
  /** Etapa "Horizonte de Planejamento": badge "Evento · até DD mmm" —
   * contexto, não ação, por isso continua aqui (não migrou pra
   * `MonthInvestmentActions`). */
  currentPlanningEndDate: string | null;
}) {
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);
  const pctRealizado = planned > 0 ? (actual / planned) * 100 : null;
  const plan = resolvePlan({ planned, actual, expectedToDate, status, monthLabel, sprints, monthRange, effectiveDate, isClosedMonth, isFutureMonth });

  const ritmoText = RITMO_STATUS_TEXT[status] ?? null;

  // Linha secundária — mesmo papel do "Esperado hoje: X" de Performance,
  // só com o conteúdo específico de investimento (valor em R$ + Restam/
  // dias, ou o aviso de orçamento atingido). `computeDeviationCurrency` é a
  // MESMA conta central de sempre (nunca uma fórmula nova) — só a frase ao
  // redor do número é nova, pensada pra caber numa única linha compacta.
  const deviationDiff = computeDeviationCurrency(summary);
  const deviationFragment =
    deviationDiff < 0
      ? `${formatCurrency(Math.abs(deviationDiff))} abaixo do esperado`
      : deviationDiff > 0
        ? `${formatCurrency(deviationDiff)} acima do esperado`
        : null;
  const secondaryLine =
    plan && plan.isBudgetReached
      ? plan.overageAmount > 0
        ? `Orçamento mensal atingido · ${formatCurrency(plan.overageAmount)} acima do planejado`
        : "Orçamento mensal atingido"
      : plan
        ? [deviationFragment, `Restam ${formatCurrency(plan.remainingBudget)} · ${plan.eligibleDaysCount} dias`].filter(Boolean).join(" · ")
        : null;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Investimento</p>

      {/* Badge de evento (Etapa "Horizonte de Planejamento" — impede o
          gestor de achar que ainda existem dias de operação até o fim do
          mês quando a campanha já terminou antes disso, ex.: Baile do
          Hawaii) — sempre no topo do conteúdo, independente do resto. Mesmo
          texto/condição de sempre, só a posição relativa mudou. */}
      {currentPlanningEndDate && (
        <p className="mb-2 mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Evento · até {formatDayShortMonth(currentPlanningEndDate)}
        </p>
      )}

      {planned <= 0 ? (
        <div className="mt-1.5">
          <EmptyState>Sem planejamento configurado para este mês.</EmptyState>
        </div>
      ) : (
        <div className="mt-1.5">
          {/* Cabeçalho — realizado/planejado + % (mesma linguagem visual do
              card "Performance", `MonthlyGoalProgress`). */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm text-overview-text-secondary">
              <span className="font-semibold text-overview-text-primary">
                {formatCurrency(actual)} / {formatCurrency(planned)}
              </span>
            </p>
            {pctRealizado !== null && <p className="text-xl font-bold text-overview-text-primary">{Math.round(pctRealizado)}%</p>}
          </div>

          {/* Barra + marcador de esperado — mesmo componente, mesmas props
              de sempre, pros 3 estados temporais. */}
          <div className="mt-1.5">
            <AgencyInvestmentBar
              summary={summary}
              monthTemporalStatus={isFutureMonth ? "futuro" : isClosedMonth ? "passado" : undefined}
              showLegend={false}
            />
          </div>

          {/* Status do ritmo — mesma estrutura exata de Performance (dot +
              frase curta compartilhada, `RITMO_STATUS_TEXT`), com a linha
              secundária logo abaixo. Só mês em andamento (mês futuro ainda
              não tem ritmo pra avaliar; mês encerrado já não tem
              "restam"). */}
          {!isFutureMonth && !isClosedMonth && plan && (
            <div className="mt-2">
              {ritmoText && (
                <p
                  className={`flex items-center gap-1.5 text-xs font-medium ${
                    status === "acima"
                      ? "text-red-600 dark:text-red-400"
                      : status === "abaixo"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-green-600 dark:text-green-400"
                  }`}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  {ritmoText}
                </p>
              )}
              {secondaryLine && <p className="mt-0.5 text-xs text-overview-text-secondary">{secondaryLine}</p>}
            </div>
          )}
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
