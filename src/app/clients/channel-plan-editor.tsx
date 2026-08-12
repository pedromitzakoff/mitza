"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatCurrency, formatDayShortMonth } from "@/lib/format";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import { applyMonthlyChannelPlanChangeAction, setClientMonthHorizonAction } from "./monthly-budget-actions";
import { useToast } from "@/app/toast-provider";

type CalculatorField = "investment" | "resultCount" | "cpa";

interface ChannelCardState {
  investmentDisplay: string;
  resultCountDisplay: string;
  cpaDisplay: string;
}

function initialCardState(current: ChannelMetrics | undefined): ChannelCardState {
  return {
    investmentDisplay: current?.investment != null ? formatMoneyDisplay(current.investment) : "",
    resultCountDisplay: current?.resultCount != null ? String(current.resultCount) : "",
    cpaDisplay: current?.cpa != null ? formatMoneyDisplay(current.cpa) : "",
  };
}

/**
 * Regra de três — o cálculo central deste editor (pedido explícito do
 * usuário: mudar Resultado atualiza CPA na hora e vice-versa, sem precisar
 * de um segundo toque em outro campo pra disparar). Investimento é a âncora
 * fixa: editar Resultado ou CPA sempre recalcula o outro mantendo o
 * Investimento atual; editar o próprio Investimento recalcula Resultado
 * mantendo o CPA atual (mesma eficiência, proporcionalmente mais/menos
 * resultado). Determinístico só pelo campo sendo editado agora — nunca
 * depende de histórico de toques anteriores. Só Investimento e Resultado são
 * enviados ao salvar; CPA nunca é armazenado (sempre recalculado na leitura,
 * em qualquer lugar da plataforma).
 */
function deriveOnFieldChange(
  changedField: CalculatorField,
  values: { investment: number | null; resultCount: number | null; cpa: number | null },
): Partial<Record<CalculatorField, number | null>> {
  if (changedField === "resultCount") {
    const cpa = values.investment !== null && values.resultCount ? values.investment / values.resultCount : null;
    return { cpa };
  }
  if (changedField === "cpa") {
    const resultCount = values.investment !== null && values.cpa ? Math.round(values.investment / values.cpa) : null;
    return { resultCount };
  }
  // changedField === "investment": mantém o CPA atual, recalcula Resultado.
  const resultCount = values.cpa !== null && values.investment !== null ? Math.round(values.investment / values.cpa) : null;
  return { resultCount };
}

function ChannelPlanCard({
  channel,
  current,
  performanceGoal,
  state,
  onChange,
}: {
  channel: TrafficChannel;
  current: ChannelMetrics | undefined;
  performanceGoal: PerformanceGoal | null;
  state: ChannelCardState;
  onChange: (next: ChannelCardState) => void;
}) {
  const goalConfig = performanceGoal ? PERFORMANCE_GOALS[performanceGoal] : null;

  function handleFieldChange(field: CalculatorField, display: string) {
    const next = { ...state };
    if (field === "investment") next.investmentDisplay = display;
    if (field === "resultCount") next.resultCountDisplay = display;
    if (field === "cpa") next.cpaDisplay = display;

    const values = {
      investment: parseMoneyInput(next.investmentDisplay),
      resultCount: next.resultCountDisplay.trim() ? Number(next.resultCountDisplay) : null,
      cpa: parseMoneyInput(next.cpaDisplay),
    };
    const derived = deriveOnFieldChange(field, values);
    if ("cpa" in derived) next.cpaDisplay = derived.cpa != null ? formatMoneyDisplay(derived.cpa) : "";
    if ("resultCount" in derived) next.resultCountDisplay = derived.resultCount != null ? String(derived.resultCount) : "";
    onChange(next);
  }

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TRAFFIC_CHANNELS[channel].label}</p>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Investimento</label>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-xs text-muted-foreground">R$</span>
            <input
              type="text"
              inputMode="decimal"
              value={state.investmentDisplay}
              onChange={(e) => handleFieldChange("investment", e.target.value)}
              onBlur={() => {
                const parsed = parseMoneyInput(state.investmentDisplay);
                onChange({ ...state, investmentDisplay: parsed !== null ? formatMoneyDisplay(parsed) : "" });
              }}
              placeholder="0,00"
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
            />
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Atual: {current?.investment != null ? formatCurrency(current.investment) : "sem plano"}
          </p>
        </div>

        {goalConfig && (
          <>
            <div>
              <label className="text-[11px] text-muted-foreground">{goalConfig.resultMetricLabel}</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={state.resultCountDisplay}
                onChange={(e) => handleFieldChange("resultCount", e.target.value)}
                placeholder="Opcional"
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Atual: {current?.resultCount != null ? current.resultCount : "sem meta"}
              </p>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{goalConfig.costMetricShortLabel}</label>
              <div className="mt-0.5 flex items-center gap-1">
                <span className="text-xs text-muted-foreground">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={state.cpaDisplay}
                  onChange={(e) => handleFieldChange("cpa", e.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
                />
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Atual: {current?.cpa != null ? formatCurrency(current.cpa) : "—"}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Editor de planejamento por canal (Etapa "Planejamento por Canal") —
 * substitui o antigo editor de valor único. Investimento/Resultado/CPA são
 * uma calculadora inteligente (qualquer 2 campos determinam o 3º, `regra de
 * três`, sem botão "calcular") — nunca envia CPA ao salvar, sempre derivado.
 * O consolidado do cliente nunca é editável aqui — é sempre a soma da
 * versão vigente de cada canal (ver `resolveClientMonthlyPlan`), calculada em
 * outro lugar. Canal com Investimento em branco ao confirmar = não tocado
 * (nunca envia uma chamada pra esse canal).
 */
export function ChannelPlanEditor({
  clientId,
  monthParam,
  monthLabel,
  monthRange,
  currentPlanningEndDate,
  channels,
  byChannel,
  performanceGoal,
}: {
  clientId: string;
  monthParam: string;
  monthLabel: string;
  /** Etapa "Horizonte de Planejamento": mês civil inteiro (não o horizonte
   * já encurtado) — usado só pra limitar o seletor de data e montar o
   * rótulo "Período de planejamento". */
  monthRange: { firstDay: string; lastDay: string };
  /** `null` = cliente sem horizonte configurado (comportamento padrão). */
  currentPlanningEndDate: string | null;
  channels: TrafficChannel[];
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  performanceGoal: PerformanceGoal | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [cardStates, setCardStates] = useState<Partial<Record<TrafficChannel, ChannelCardState>>>(() =>
    Object.fromEntries(channels.map((c) => [c, initialCardState(byChannel[c])])),
  );
  const [planningEndDateDisplay, setPlanningEndDateDisplay] = useState(currentPlanningEndDate ?? "");
  const [reason, setReason] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, startApplyTransition] = useTransition();
  const { showToast } = useToast();

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        className="mitza-pressable text-xs font-medium text-brand hover:underline"
      >
        Editar planejamento
      </button>
    );
  }

  const close = () => {
    setIsOpen(false);
    setConfirmStep(false);
    setCardStates(Object.fromEntries(channels.map((c) => [c, initialCardState(byChannel[c])])));
    setPlanningEndDateDisplay(currentPlanningEndDate ?? "");
    setReason("");
    setApplyError(null);
  };

  // Canal "tocado" = Investimento preenchido ao confirmar — nunca envia
  // chamada pra um canal deixado em branco (mesma convenção "branco = não
  // mexi" já usada no lançamento manual de investimento por plataforma).
  const touchedChannels = channels.filter((c) => (cardStates[c]?.investmentDisplay ?? "").trim() !== "");
  const planningEndDateChanged = planningEndDateDisplay !== (currentPlanningEndDate ?? "");
  // "01 ago → 31 ago" (sem data) ou "01 ago → 21 ago" (com evento) — mesmo
  // cálculo mostrado no rodapé do formulário e na revisão final, nunca duas
  // fórmulas diferentes pro mesmo texto.
  const planningEndLabel = formatDayShortMonth(planningEndDateDisplay || monthRange.lastDay);

  function handleApply() {
    setApplyError(null);
    startApplyTransition(async () => {
      if (planningEndDateChanged) {
        const horizonResult = await setClientMonthHorizonAction(clientId, monthParam, planningEndDateDisplay || null);
        if (horizonResult.error) {
          setApplyError(horizonResult.error);
          return;
        }
      }
      for (const channel of touchedChannels) {
        const state = cardStates[channel]!;
        const investment = parseMoneyInput(state.investmentDisplay) ?? 0;
        const resultCount = state.resultCountDisplay.trim() ? Number(state.resultCountDisplay) : null;
        const result = await applyMonthlyChannelPlanChangeAction(clientId, monthParam, channel, investment, reason.trim() || null, resultCount);
        if (result.error) {
          setApplyError(`${TRAFFIC_CHANNELS[channel].label}: ${result.error}`);
          return;
        }
      }
      showToast("Planejamento do mês atualizado.");
      close();
    });
  }

  return (
    <>
      <div className="mitza-backdrop-in fixed inset-0 z-40 cursor-pointer bg-black/30" onClick={close} aria-hidden />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Planejamento de {monthLabel}</h2>
          <button
            type="button"
            onClick={close}
            className="mitza-pressable shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </button>
        </div>

        {!confirmStep ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Cada canal tem seu próprio plano — o consolidado do cliente é sempre a soma dos canais, nunca editado direto. Deixe um canal
              em branco pra não mexer nele.
            </p>

            <div className="rounded-md border border-border p-3">
              <label htmlFor="planning-end-date" className="text-[11px] text-muted-foreground">
                Data final da campanha/evento — opcional
              </label>
              <input
                id="planning-end-date"
                type="date"
                min={monthRange.firstDay}
                max={monthRange.lastDay}
                value={planningEndDateDisplay}
                onChange={(e) => setPlanningEndDateDisplay(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Período de planejamento: {formatDayShortMonth(monthRange.firstDay)} → {planningEndLabel}
              </p>
              {planningEndDateDisplay && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Sem orçamento distribuído nem ritmo calculado depois de {planningEndLabel} — os dias seguintes do mês continuam existindo,
                  só sem verba nova.
                </p>
              )}
            </div>

            {channels.map((channel) => (
              <ChannelPlanCard
                key={channel}
                channel={channel}
                current={byChannel[channel]}
                performanceGoal={performanceGoal}
                state={cardStates[channel]!}
                onChange={(next) => setCardStates((prev) => ({ ...prev, [channel]: next }))}
              />
            ))}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(true)}
                disabled={touchedChannels.length === 0 && !planningEndDateChanged}
                className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continuar
              </button>
              <button type="button" onClick={close} className="mitza-pressable text-sm text-muted-foreground hover:underline">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-md border border-border bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
              <p className="font-semibold text-foreground">Confirmar alteração</p>
              <p className="mt-1 text-foreground">
                O que já foi investido não muda — só o saldo restante do mês é recalculado e redistribuído, por canal.
              </p>
              {planningEndDateChanged && (
                <p className="mt-2 tabular-nums text-foreground">
                  Período de planejamento: {formatDayShortMonth(monthRange.firstDay)} → {planningEndLabel}
                  {!planningEndDateDisplay && " (removendo a data final)"}
                </p>
              )}
              <ul className="mt-2 flex flex-col gap-1">
                {touchedChannels.map((channel) => {
                  const state = cardStates[channel]!;
                  const newInvestment = parseMoneyInput(state.investmentDisplay) ?? 0;
                  const currentInvestment = byChannel[channel]?.investment ?? 0;
                  return (
                    <li key={channel} className="flex justify-between tabular-nums">
                      <span className="text-muted-foreground">{TRAFFIC_CHANNELS[channel].label}</span>
                      <span className="text-foreground">
                        {formatCurrency(currentInvestment)} → {formatCurrency(newInvestment)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="plan-reason" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Motivo da alteração (opcional)
                </label>
                <textarea
                  id="plan-reason"
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Ex.: Cliente aprovou aumento de investimento para campanha promocional."
                  className="mt-1 w-full resize-none rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
                />
              </div>

              {applyError && (
                <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{applyError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={isApplying}
                  className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isApplying ? "Confirmando..." : "Confirmar alteração"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmStep(false)}
                  disabled={isApplying}
                  className="mitza-pressable text-sm text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
