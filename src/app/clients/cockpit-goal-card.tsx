"use client";

import { useState } from "react";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary, type FinancialPeriodSummary } from "@/lib/financial-period";
import type { SpendStatus } from "@/lib/spend-status";
import type { MetricTone } from "@/lib/metric-diagnostics";
import { formatCurrency, formatCount } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import {
  PACE_VERDICT_LABEL,
  PACE_VERDICT_TONE,
  costVerdictLabel,
  COST_VERDICT_TONE,
  COCKPIT_TONE_CARD_CLASSES,
  COCKPIT_TONE_BADGE_CLASSES,
} from "@/lib/cockpit-pace";
import { InlineGoalPlanEditor } from "./cockpit-inline-goal-editor";
import { MetasSecondaryTargetForm } from "./metas-secondary-target-form";
import type { CockpitResultCardView, CockpitCostCardView, CockpitGoalEditAffordance } from "./cockpit-meta-ritmo-section";

/**
 * MITZA ONE — Refinamento do Cockpit (pedido do usuário: "nao quero mais
 * essa tela [drawer]. Quero q seja tudo feito ali no painel central mesmo"):
 * `CockpitResultCard`/`CockpitCostCard` viraram Client Component (precisam
 * de `useState` pra abrir/fechar o editor ali mesmo, como um bloco a mais
 * dentro do próprio card) — moveram de `cockpit-meta-ritmo-section.tsx`
 * (que continua Server Component, só com as views/cards sem estado próprio)
 * pra este arquivo. Nenhum dado novo, nenhuma Server Action nova: o editor
 * em si é sempre `InlineGoalPlanEditor` (objetivo PRINCIPAL — mesma
 * calculadora Investimento↔Resultado↔Custo de sempre) ou
 * `MetasSecondaryTargetForm` direto (objetivo SECUNDÁRIO — já era editado
 * inline, só ganhou aqui o Fechar que antes vivia em
 * `CockpitSecondaryGoalEditor`).
 */
function PaceVerdictBadge({ status }: { status: SpendStatus }) {
  const tone = PACE_VERDICT_TONE[status];
  return <p className={`text-[11px] font-semibold uppercase tracking-wide ${COCKPIT_TONE_BADGE_CLASSES[tone]}`}>{PACE_VERDICT_LABEL[status]}</p>;
}

function CostVerdictBadge({ tone }: { tone: MetricTone }) {
  const cockpitTone = COST_VERDICT_TONE[tone];
  return <p className={`text-[11px] font-semibold uppercase tracking-wide ${COCKPIT_TONE_BADGE_CLASSES[cockpitTone]}`}>{costVerdictLabel(tone)}</p>;
}

function GoalPencilButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="mitza-pressable rounded-md p-0.5 text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
    >
      ✎
    </button>
  );
}

/** Painel de edição que abre dentro do próprio card — mesmo par oficial por
 * objetivo (nenhuma segunda implementação): "primary" usa a calculadora de
 * regra de três (`InlineGoalPlanEditor`); "secondary" usa o formulário de
 * meta de quantidade já oficial (`MetasSecondaryTargetForm`), que nunca tem
 * Investimento/Custo planejados manualmente. */
function GoalInlineEditorPanel({ edit, onClose }: { edit: CockpitGoalEditAffordance; onClose: () => void }) {
  if (edit.kind === "primary") {
    return (
      <InlineGoalPlanEditor
        clientId={edit.clientId}
        monthParam={edit.monthParam}
        channels={edit.channels}
        byChannel={edit.byChannel}
        performanceGoal={edit.performanceGoal}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <MetasSecondaryTargetForm
        clientId={edit.clientId}
        returnTo={edit.returnTo}
        resultType={edit.performanceGoal}
        monthFirstDay={edit.monthRange.firstDay}
        channels={edit.channels}
        currentTargetByChannel={edit.byChannel}
      />
      <button type="button" onClick={onClose} className="mitza-pressable self-start text-xs text-overview-text-muted hover:underline">
        Fechar
      </button>
    </div>
  );
}

/** Card "RESULTADO" — status de ritmo + valor + meta + necessário/dia +
 * barra. Sem meta de quantidade configurada: mostra só o valor realizado,
 * sem veredito/barra fabricados. Lápis abre o editor como um bloco a mais
 * dentro do próprio card (nunca mais um drawer lateral). */
export function CockpitResultCard({ view, status }: { view: CockpitResultCardView; status: SpendStatus | null }) {
  const [isEditing, setIsEditing] = useState(false);
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
    <div className={`rounded-lg border p-3 ${COCKPIT_TONE_CARD_CLASSES[tone]}`}>
      {status ? <PaceVerdictBadge status={status} /> : <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">RESULTADO</p>}
      <p className="mt-0.5 text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{formatCount(view.resultCount)}</p>
      <p className="text-xs text-overview-text-secondary">
        {config.resultMetricLabel}
        {view.channelsLabel ? ` · ${view.channelsLabel}` : ""}
      </p>
      {view.targetResultCount !== null && view.targetResultCount > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1 text-xs text-overview-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              Meta
              {view.edit && !isEditing && (
                <GoalPencilButton onClick={() => setIsEditing(true)} label={`Editar meta de ${config.resultMetricLabel.toLowerCase()}`} />
              )}
            </span>
            <span className="tabular-nums font-medium text-overview-text-primary">{formatCount(view.targetResultCount)}</span>
          </div>
          {view.inheritedFromMonthLabel && <p className="text-[10px] text-overview-text-muted">Meta herdada de {view.inheritedFromMonthLabel}</p>}
          {view.neededDailyRate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span>Necessário</span>
              <span className="tabular-nums font-medium text-overview-text-primary">{formatCount(Math.ceil(view.neededDailyRate))} / dia</span>
            </div>
          )}
          {summary && <AgencyInvestmentBar summary={summary} showLegend={false} formatValue={formatCount} overflowIsPositive />}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-overview-text-secondary">
          <p>Sem meta de {config.resultMetricLabel.toLowerCase()} configurada para o mês.</p>
          {view.edit && !isEditing && (
            <GoalPencilButton onClick={() => setIsEditing(true)} label={`Configurar meta de ${config.resultMetricLabel.toLowerCase()}`} />
          )}
        </div>
      )}
      {isEditing && view.edit && (
        <div className="mt-2 border-t border-overview-border/60 pt-2">
          <GoalInlineEditorPanel edit={view.edit} onClose={() => setIsEditing(false)} />
        </div>
      )}
    </div>
  );
}

/** Card "CUSTO POR RESULTADO" — nome dinâmico (CPL/CPA/"Custo por novo
 * seguidor"). Sem meta de custo configurada: mostra o valor realizado sem
 * comparação. `view.edit` só existe pro objetivo PRINCIPAL (Custo por
 * resultado nunca é gravado por si, sempre derivado de
 * Investimento/Resultado). */
export function CockpitCostCard({ view }: { view: CockpitCostCardView }) {
  const [isEditing, setIsEditing] = useState(false);
  const config = PERFORMANCE_GOALS[view.resultType];
  const hasTarget = view.targetCostPerResult !== null && view.deviationPct !== null;

  return (
    <div className={`rounded-lg border p-3 ${COCKPIT_TONE_CARD_CLASSES[hasTarget ? COST_VERDICT_TONE[view.tone] : "neutral"]}`}>
      {hasTarget ? (
        <CostVerdictBadge tone={view.tone} />
      ) : (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">{config.costMetricShortLabel.toUpperCase()}</p>
      )}
      <p className="mt-0.5 text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">
        {view.costPerResult !== null ? formatCurrency(view.costPerResult) : "—"}
      </p>
      <p className="text-xs text-overview-text-secondary">{config.costMetricShortLabel}</p>
      {view.targetCostPerResult !== null ? (
        <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-overview-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              Meta
              {view.edit && !isEditing && (
                <GoalPencilButton onClick={() => setIsEditing(true)} label={`Editar meta de ${config.costMetricShortLabel.toLowerCase()}`} />
              )}
            </span>
            <span className="tabular-nums font-medium text-overview-text-primary">{formatCurrency(view.targetCostPerResult)}</span>
          </div>
          {view.inheritedFromMonthLabel && <p className="text-[10px] text-overview-text-muted">Meta herdada de {view.inheritedFromMonthLabel}</p>}
          {view.deviationPct !== null && view.deviationPct > 0 && (
            <p className="text-overview-text-secondary">{Math.round(view.deviationPct * 100)}% acima</p>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-overview-text-secondary">
          <p>Meta de custo não configurada.</p>
          {view.edit && !isEditing && (
            <GoalPencilButton onClick={() => setIsEditing(true)} label={`Configurar meta de ${config.costMetricShortLabel.toLowerCase()}`} />
          )}
        </div>
      )}
      {isEditing && view.edit && (
        <div className="mt-2 border-t border-overview-border/60 pt-2">
          <GoalInlineEditorPanel edit={view.edit} onClose={() => setIsEditing(false)} />
        </div>
      )}
    </div>
  );
}
