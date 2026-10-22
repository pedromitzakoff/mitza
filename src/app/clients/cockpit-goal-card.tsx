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
  COCKPIT_CARD_CLASSES,
  COCKPIT_TONE_BADGE_CLASSES,
  COCKPIT_TONE_DOT_CLASSES,
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
 *
 * KOFF Analytics — "Refinamento de UX e filtros globais do Cockpit": o card
 * inteiro nunca mais herda a cor do veredito (fundo sempre neutro,
 * `COCKPIT_CARD_CLASSES`) — a cor migrou pro ponto pequeno ao lado do
 * rótulo (`PaceVerdictBadge`/`CostVerdictBadge`). Valor principal com mais
 * peso tipográfico (`text-2xl`); meta/progresso ficam visualmente em
 * segundo plano (`text-overview-text-muted`, nunca mais a cor primária).
 */
function PaceVerdictBadge({ status }: { status: SpendStatus }) {
  const tone = PACE_VERDICT_TONE[status];
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${COCKPIT_TONE_DOT_CLASSES[tone]}`} />
      <span className={COCKPIT_TONE_BADGE_CLASSES[tone]}>{PACE_VERDICT_LABEL[status]}</span>
    </p>
  );
}

function CostVerdictBadge({ tone }: { tone: MetricTone }) {
  const cockpitTone = COST_VERDICT_TONE[tone];
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${COCKPIT_TONE_DOT_CLASSES[cockpitTone]}`} />
      <span className={COCKPIT_TONE_BADGE_CLASSES[cockpitTone]}>{costVerdictLabel(tone)}</span>
    </p>
  );
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

  return (
    <div className={`rounded-lg border p-2.5 ${COCKPIT_CARD_CLASSES}`}>
      {status ? <PaceVerdictBadge status={status} /> : <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">RESULTADO</p>}
      <p className="mt-1 text-2xl font-bold tracking-tight text-overview-text-primary tabular-nums">
        {view.unavailableReason ? "—" : formatCount(view.resultCount)}
      </p>
      <p className="text-xs text-overview-text-secondary">
        {config.resultMetricLabel}
        {view.channelsLabel ? ` · ${view.channelsLabel}` : ""}
      </p>
      {view.unavailableReason ? (
        <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.unavailableReason}</p>
      ) : view.filteredNotice ? (
        <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.filteredNotice}</p>
      ) : view.targetResultCount !== null && view.targetResultCount > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-overview-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              Meta
              {view.edit && !isEditing && (
                <GoalPencilButton onClick={() => setIsEditing(true)} label={`Editar meta de ${config.resultMetricLabel.toLowerCase()}`} />
              )}
            </span>
            <span className="tabular-nums font-medium text-overview-text-secondary">{formatCount(view.targetResultCount)}</span>
          </div>
          {view.neededDailyRate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span>Necessário</span>
              <span className="tabular-nums font-medium text-overview-text-secondary">{formatCount(Math.ceil(view.neededDailyRate))} / dia</span>
            </div>
          )}
          {summary && <AgencyInvestmentBar summary={summary} showLegend={false} formatValue={formatCount} overflowIsPositive />}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-overview-text-muted">
          <p>Sem meta de {config.resultMetricLabel.toLowerCase()} configurada.</p>
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
    <div className={`rounded-lg border p-2.5 ${COCKPIT_CARD_CLASSES}`}>
      {hasTarget ? (
        <CostVerdictBadge tone={view.tone} />
      ) : (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">{config.costMetricShortLabel.toUpperCase()}</p>
      )}
      <p className="mt-1 text-2xl font-bold tracking-tight text-overview-text-primary tabular-nums">
        {view.unavailableReason ? "—" : view.costPerResult !== null ? formatCurrency(view.costPerResult) : "—"}
      </p>
      <p className="text-xs text-overview-text-secondary">{config.costMetricShortLabel}</p>
      {view.unavailableReason ? (
        <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.unavailableReason}</p>
      ) : view.filteredNotice ? (
        <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.filteredNotice}</p>
      ) : view.targetCostPerResult !== null ? (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-overview-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              Meta
              {view.edit && !isEditing && (
                <GoalPencilButton onClick={() => setIsEditing(true)} label={`Editar meta de ${config.costMetricShortLabel.toLowerCase()}`} />
              )}
            </span>
            <span className="tabular-nums font-medium text-overview-text-secondary">{formatCurrency(view.targetCostPerResult)}</span>
          </div>
          {view.deviationPct !== null && view.deviationPct > 0 && <p>{Math.round(view.deviationPct * 100)}% acima</p>}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-overview-text-muted">
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
