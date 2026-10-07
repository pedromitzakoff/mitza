import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary, type FinancialPeriodSummary } from "@/lib/financial-period";
import type { SpendStatus } from "@/lib/spend-status";
import type { MetricTone } from "@/lib/metric-diagnostics";
import { formatCurrency, formatCount } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import {
  PACE_VERDICT_LABEL,
  PACE_VERDICT_TONE,
  costVerdictLabel,
  COST_VERDICT_TONE,
  COCKPIT_TONE_CARD_CLASSES,
  COCKPIT_TONE_BADGE_CLASSES,
} from "@/lib/cockpit-pace";
import { DashboardBudget, type DashboardBudgetChannel } from "./dashboard-budget";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Meta & Ritmo"
 * (pedido, seções 5-10): primeira grande seção do cockpit — "Estamos no
 * caminho certo?". Três famílias de card: RESULTADO, CUSTO POR RESULTADO,
 * ORÇAMENTO/INVESTIMENTO — nenhum cálculo novo, só uma composição nova em
 * torno de fontes já oficiais:
 *
 * - Resultado/Custo: um PAR de cards por objetivo realmente em jogo
 *   (`groupChannelsByResultType`, `lib/cockpit-result-groups.ts` — seção 9
 *   do pedido: "não somar resultados incompatíveis"). Cliente com um só
 *   objetivo (o caso comum) mostra 1 par; mais de um objetivo mostra um
 *   par por objetivo, nunca um consolidado fabricado entre eles.
 * - Orçamento: sempre 1 card só (dinheiro soma entre canais, independente
 *   de objetivo) — cabeçalho novo (status/necessário por dia/barra) seguido
 *   do `DashboardBudget` já oficial (composição por canal + edição inline,
 *   MESMA Server Action/RPC de sempre, nenhuma segunda implementação).
 *
 * Barra de progresso: `AgencyInvestmentBar` já existente (identidade MITZA,
 * nunca uma barra nova) — `showLegend={false}` porque o card já tem seu
 * próprio texto de "necessário/dia" (evita repetir a mesma informação duas
 * vezes, seção 17 do pedido).
 *
 * Custo por resultado NUNCA tem barra de progresso (seção 10 do pedido:
 * "Custo por resultado é ratio, não tratar como métrica cumulativa").
 */

function PaceVerdictBadge({ status }: { status: SpendStatus }) {
  const tone = PACE_VERDICT_TONE[status];
  return <p className={`text-[11px] font-semibold uppercase tracking-wide ${COCKPIT_TONE_BADGE_CLASSES[tone]}`}>{PACE_VERDICT_LABEL[status]}</p>;
}

function CostVerdictBadge({ tone }: { tone: MetricTone }) {
  const cockpitTone = COST_VERDICT_TONE[tone];
  return <p className={`text-[11px] font-semibold uppercase tracking-wide ${COCKPIT_TONE_BADGE_CLASSES[cockpitTone]}`}>{costVerdictLabel(tone)}</p>;
}

export interface CockpitResultCardView {
  resultType: PerformanceGoal;
  /** "Meta + Google", "Google" — rótulo dos canais deste objetivo, só
   * exibido quando há mais de um objetivo em jogo (nunca necessário no
   * caso comum de 1 objetivo só). */
  channelsLabel: string | null;
  resultCount: number;
  targetResultCount: number | null;
  expectedResultsToDate: number | null;
  /** `computeNeededDailyRate` — `null` sem meta configurada ou sem dias
   * elegíveis restantes (nunca 0 fabricado). */
  neededDailyRate: number | null;
}

/** Card "RESULTADO" — status de ritmo (`classifySpendStatus`, mesma régua
 * de sempre) + valor + meta + necessário/dia + barra. Sem meta de
 * quantidade configurada: mostra só o valor realizado, sem veredito/barra
 * fabricados (seção 6 do pedido: "não inventar thresholds arbitrários"). */
export function CockpitResultCard({ view, status }: { view: CockpitResultCardView; status: SpendStatus | null }) {
  const config = PERFORMANCE_GOALS[view.resultType];
  const hasTarget = view.targetResultCount !== null && view.targetResultCount > 0 && view.expectedResultsToDate !== null && status !== null;

  const summary: FinancialPeriodSummary | null = hasTarget
    ? resolveMonthPeriodSummary(
        {
          monthPlanned: view.targetResultCount as number,
          monthActual: view.resultCount,
          monthExpectedToDate: view.expectedResultsToDate as number,
          monthStatus: status as SpendStatus,
        },
        "",
        { firstDay: "", lastDay: "" },
      )
    : null;

  const tone = status ? PACE_VERDICT_TONE[status] : "neutral";

  return (
    <div className={`rounded-lg border p-4 ${COCKPIT_TONE_CARD_CLASSES[tone]}`}>
      {status ? <PaceVerdictBadge status={status} /> : <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">RESULTADO</p>}
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{formatCount(view.resultCount)}</p>
      <p className="text-xs text-overview-text-secondary">
        {config.resultMetricLabel}
        {view.channelsLabel ? ` · ${view.channelsLabel}` : ""}
      </p>
      {view.targetResultCount !== null && view.targetResultCount > 0 ? (
        <div className="mt-3 flex flex-col gap-2 text-xs text-overview-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>Meta</span>
            <span className="tabular-nums font-medium text-overview-text-primary">{formatCount(view.targetResultCount)}</span>
          </div>
          {view.neededDailyRate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span>Necessário</span>
              <span className="tabular-nums font-medium text-overview-text-primary">{formatCount(Math.ceil(view.neededDailyRate))} / dia</span>
            </div>
          )}
          {summary && <AgencyInvestmentBar summary={summary} showLegend={false} formatValue={formatCount} overflowIsPositive />}
        </div>
      ) : (
        <p className="mt-3 text-xs text-overview-text-secondary">Sem meta de {config.resultMetricLabel.toLowerCase()} configurada para o mês.</p>
      )}
    </div>
  );
}

export interface CockpitCostCardView {
  resultType: PerformanceGoal;
  costPerResult: number | null;
  targetCostPerResult: number | null;
  deviationPct: number | null;
  tone: MetricTone;
}

/** Card "CUSTO POR RESULTADO" — nome dinâmico (CPL/CPA/"Custo por novo
 * seguidor", `PERFORMANCE_GOALS`, nunca hardcoded). Sem meta de custo
 * configurada: mostra o valor realizado sem comparação (`costPerResult`
 * pode ser `null` também, quando não há nenhum resultado no mês ainda). */
export function CockpitCostCard({ view }: { view: CockpitCostCardView }) {
  const config = PERFORMANCE_GOALS[view.resultType];
  const hasTarget = view.targetCostPerResult !== null && view.deviationPct !== null;

  return (
    <div className={`rounded-lg border p-4 ${COCKPIT_TONE_CARD_CLASSES[hasTarget ? COST_VERDICT_TONE[view.tone] : "neutral"]}`}>
      {hasTarget ? (
        <CostVerdictBadge tone={view.tone} />
      ) : (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">{config.costMetricShortLabel.toUpperCase()}</p>
      )}
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-overview-text-primary tabular-nums">
        {view.costPerResult !== null ? formatCurrency(view.costPerResult) : "—"}
      </p>
      <p className="text-xs text-overview-text-secondary">{config.costMetricShortLabel}</p>
      {view.targetCostPerResult !== null ? (
        <div className="mt-3 flex flex-col gap-1 text-xs text-overview-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>Meta</span>
            <span className="tabular-nums font-medium text-overview-text-primary">{formatCurrency(view.targetCostPerResult)}</span>
          </div>
          {view.deviationPct !== null && view.deviationPct > 0 && (
            <p className="text-overview-text-secondary">{Math.round(view.deviationPct * 100)}% acima</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-overview-text-secondary">Meta de custo não configurada.</p>
      )}
    </div>
  );
}

export interface CockpitBudgetHeadlineView {
  monthActual: number;
  monthPlanned: number;
  monthExpectedToDate: number;
  monthStatus: SpendStatus;
  /** `computeMonthlyBudgetPlan(...).recommendedDaily` — `null` quando o mês
   * está encerrado/futuro ou sem orçamento (mesmo guard de
   * `MonthInvestmentPaceNote.hasPace`, nunca um valor fabricado). */
  neededDailyRate: number | null;
}

/** Card "ORÇAMENTO" — cabeçalho (status/investido/necessário-dia/barra)
 * seguido do `DashboardBudget` oficial (composição por canal + edição
 * inline). Um card visual só, duas partes: a de cima é NOVA composição
 * (nenhum cálculo novo — `monthActual`/`monthPlanned`/`monthStatus` já
 * vêm prontos de `[id]/page.tsx`, exatamente como antes desta fase); a de
 * baixo é o componente já oficial, intocado. */
export function CockpitBudgetCard({
  headline,
  clientId,
  monthParam,
  channels,
  canEdit,
}: {
  headline: CockpitBudgetHeadlineView;
  clientId: string;
  monthParam: string;
  channels: DashboardBudgetChannel[];
  canEdit: boolean;
}) {
  const summary = resolveMonthPeriodSummary(
    {
      monthPlanned: headline.monthPlanned,
      monthActual: headline.monthActual,
      monthExpectedToDate: headline.monthExpectedToDate,
      monthStatus: headline.monthStatus,
    },
    "",
    { firstDay: "", lastDay: "" },
  );
  const tone = PACE_VERDICT_TONE[headline.monthStatus];

  return (
    <div className={`rounded-lg border p-4 ${COCKPIT_TONE_CARD_CLASSES[tone]}`}>
      <PaceVerdictBadge status={headline.monthStatus} />
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{formatCurrency(headline.monthActual)}</p>
      <p className="text-xs text-overview-text-secondary">investido no mês</p>
      {headline.monthPlanned > 0 ? (
        <div className="mt-3 flex flex-col gap-2 text-xs text-overview-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>Planejado</span>
            <span className="tabular-nums font-medium text-overview-text-primary">{formatCurrency(headline.monthPlanned)}</span>
          </div>
          {headline.neededDailyRate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span>Necessário</span>
              <span className="tabular-nums font-medium text-overview-text-primary">{formatCurrency(headline.neededDailyRate)} / dia</span>
            </div>
          )}
          <AgencyInvestmentBar summary={summary} showLegend={false} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-overview-text-secondary">Sem planejamento configurado para o mês.</p>
      )}

      <div className="mt-4 border-t border-overview-border/60 pt-3">
        <DashboardBudget clientId={clientId} monthParam={monthParam} total={headline.monthPlanned} channels={channels} canEdit={canEdit} />
      </div>
    </div>
  );
}
