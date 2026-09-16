import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDayShortMonth } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import { computeMonthlyBudgetPlan, type MonthlyBudgetPlanSprintInput } from "@/lib/monthly-budget";

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
 * sempre, consumida só por `MonthInvestmentPaceNote` ("Ritmo recomendado")
 * desde a Etapa "Revisão Performance — Visão Geral do cliente"
 * (`MonthInvestmentSummary` deixou de precisar de `plan` quando a linha de
 * diferença/restante/dias migrou pro diagnóstico único de
 * `AccountFollowUpPanel`). */
function resolvePlan(input: Pick<SharedInvestmentInput, "planned" | "actual" | "monthRange" | "effectiveDate" | "sprints">) {
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
 * Nota de ritmo do investimento — "Diferença para o ritmo" + "Ritmo
 * recomendado" (Etapa "Simplificação Pós-Facelift"), movidas de dentro do
 * antigo accordion "Ver detalhes do investimento"/"Detalhes do
 * acompanhamento" (removido por inteiro) pra uma linha direta abaixo do
 * diagnóstico único de "Ritmo do mês" (`RitmoDiagnostic`, em
 * `account-follow-up-panel.tsx`).
 *
 * O que NÃO sobrevive à remoção do accordion, por decisão explícita do
 * pedido (só "Diferença para o ritmo"/"Ritmo recomendado" foram apontadas
 * pra preservar):
 * - "Realizado"/"Esperado hoje" — já representados pela barra + "Investimento
 *   — X%" (`MonthInvestmentSummary`, acima) e pelo marker "Esperado hoje"
 *   (`AgencyInvestmentBar`, que recalcula `computeExpectedPct` internamente
 *   — nunca duplicado aqui); eram literalmente o mesmo número repetido.
 * - "Esperado até hoje" e "Regra da projeção" — texto explicativo do
 *   accordion, sem cálculo próprio que precise de outro lugar.
 * - "Ritmo planejado inicial" (mês futuro) / "X% do orçamento utilizado"
 *   (mês encerrado) — variantes do MESMO accordion pros outros dois estados
 *   de mês; o pedido não pediu equivalente pra elas, então esta nota só
 *   aparece no caso ativo (`hasPace` abaixo) — ver limitação no relatório
 *   desta etapa.
 * "Editar planejamento" (`ChannelPlanEditor`) saiu de vez daqui — subiu pra
 * toolbar de contexto (`[id]/page.tsx`, junto de Mês/Canal), chamado direto
 * por quem monta a página; este arquivo não sabe mais de canais/plano por
 * canal.
 *
 * Recalcula `ritmoDiff`/`plan` a partir dos mesmos inputs primitivos que
 * `MonthInvestmentSummary` já recebe (nenhum estado compartilhado entre os
 * dois) — mesma fórmula central de sempre (`computeMonthlyBudgetPlan`), só
 * chamada de novo; nenhum resultado diferente pro mesmo mês. Cor
 * deliberadamente NEUTRA (nunca vermelho/âmbar aqui) — o diagnóstico logo
 * acima já é a leitura semântica principal; esta linha é metadata, não um
 * segundo alerta.
 */
export function MonthInvestmentPaceNote({
  planned,
  actual,
  expectedToDate,
  sprints,
  monthRange,
  effectiveDate,
  isClosedMonth,
  isFutureMonth,
  isAdmin,
  lastChange,
  historyHref,
}: Pick<SharedInvestmentInput, "planned" | "actual" | "expectedToDate" | "sprints" | "monthRange" | "effectiveDate" | "isClosedMonth" | "isFutureMonth"> & {
  isAdmin: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
}) {
  // Mesmo guard que `hasInvestmentRitmo` já usa em `account-follow-up-panel.tsx`
  // pra decidir se mostra a leitura de investimento no diagnóstico — nunca
  // uma segunda condição divergente pra uma informação que só faz sentido
  // junto dela.
  const hasPace = planned > 0 && !isFutureMonth && !isClosedMonth;
  const showHistoryLink = isAdmin && Boolean(lastChange) && (lastChange?.changeCountThisMonth ?? 0) > 1;

  if (!hasPace && !showHistoryLink) return null;

  const ritmoDiff = actual - expectedToDate;
  const ritmoDiffText = hasPace
    ? ritmoDiff < 0
      ? `${formatCurrency(Math.abs(ritmoDiff))} abaixo do ritmo`
      : ritmoDiff > 0
        ? `${formatCurrency(ritmoDiff)} acima do ritmo`
        : "Sem diferença de ritmo"
    : null;
  const plan = hasPace ? resolvePlan({ planned, actual, monthRange, effectiveDate, sprints }) : null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="min-w-0 text-xs text-overview-text-secondary">
        {ritmoDiffText}
        {plan && !plan.isBudgetReached && <> · Ritmo recomendado: {formatCurrency(plan.recommendedDaily)}/dia</>}
      </p>
      {showHistoryLink && (
        <Link href={historyHref} className="shrink-0 text-xs font-medium text-overview-text-primary hover:underline">
          Ver histórico
        </Link>
      )}
    </div>
  );
}
