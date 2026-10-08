"use client";

import { useState, useTransition } from "react";
import { parseMoneyInput } from "@/lib/money-format";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { ChannelPlanCard, initialCardState, type ChannelCardState } from "./channel-plan-editor";
import { applyMonthlyChannelPlanChangeAction } from "./monthly-budget-actions";
import { useToast } from "@/app/toast-provider";

/**
 * MITZA ONE — Refinamento do Cockpit (feedback do usuário: "quero que seja
 * tudo feito ali no painel central mesmo", "quero uma calculadora
 * integrada"): edição do objetivo PRINCIPAL direto no card do Cockpit, sem
 * drawer lateral — MESMA `ChannelPlanCard`/calculadora de regra de três
 * (Investimento↔Resultado↔Custo) e MESMA Server Action
 * (`applyMonthlyChannelPlanChangeAction`) que `ChannelPlanEditor` (`/metas`)
 * já usa, nenhuma segunda implementação.
 *
 * Deliberadamente mais simples que o drawer completo: sem a etapa extra de
 * "Confirmar alteração" (o aviso que ela mostrava vira uma nota fixa aqui,
 * sempre visível) e sem o campo de "Data final da campanha/evento" (recurso
 * avançado, continua disponível no fluxo completo via "Ver Metas →") — o
 * mesmo tipo de simplificação que `DashboardBudget` (modo `compact`) já usa
 * pra edição de orçamento, nenhum padrão novo inventado.
 */
export function InlineGoalPlanEditor({
  clientId,
  monthParam,
  channels,
  byChannel,
  performanceGoal,
  onClose,
}: {
  clientId: string;
  monthParam: string;
  channels: TrafficChannel[];
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  performanceGoal: PerformanceGoal | null;
  onClose: () => void;
}) {
  const [cardStates, setCardStates] = useState<Partial<Record<TrafficChannel, ChannelCardState>>>(() =>
    Object.fromEntries(channels.map((c) => [c, initialCardState(byChannel[c])])),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const { showToast } = useToast();

  // Canal "tocado" = Investimento preenchido — mesma convenção de
  // `ChannelPlanEditor`/`DashboardBudget`, nunca envia uma chamada pra um
  // canal deixado em branco.
  const touchedChannels = channels.filter((c) => (cardStates[c]?.investmentDisplay ?? "").trim() !== "");

  function handleSave() {
    setError(null);
    startSaveTransition(async () => {
      if (touchedChannels.length === 0) {
        showToast("Nenhuma alteração para salvar.");
        onClose();
        return;
      }

      // Nunca para no primeiro erro — tenta TODOS os canais alterados,
      // mesma regra de atomicidade (documentada em `DashboardBudget`) já
      // que não existe uma RPC que grave vários canais numa transação só.
      const failures: string[] = [];
      for (const channel of touchedChannels) {
        const state = cardStates[channel]!;
        const investment = parseMoneyInput(state.investmentDisplay) ?? 0;
        const resultCount = state.resultCountDisplay.trim() ? Number(state.resultCountDisplay) : null;
        const result = await applyMonthlyChannelPlanChangeAction(clientId, monthParam, channel, investment, null, resultCount);
        if (result.error) failures.push(`${TRAFFIC_CHANNELS[channel].label}: ${result.error}`);
      }

      if (failures.length > 0) {
        setError(failures.join("; "));
        return;
      }

      showToast("Meta atualizada.");
      onClose();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-overview-text-muted">
        Cada canal tem seu próprio plano — mexer em Investimento, Resultado ou Custo recalcula os outros dois automaticamente. Deixe um
        canal em branco pra não mexer nele.
      </p>

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

      <p className="text-[11px] text-overview-text-muted">O que já foi investido não muda — só o saldo restante do mês é recalculado e redistribuído, por canal.</p>

      {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="mitza-pressable text-xs text-overview-text-muted hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
