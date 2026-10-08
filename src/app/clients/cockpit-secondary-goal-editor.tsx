"use client";

import { useState, type ReactNode } from "react";
import { MetasSecondaryTargetForm } from "./metas-secondary-target-form";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * MITZA ONE — Refinamento do Cockpit (seção 2 do pedido): lápis discreto que
 * abre o formulário OFICIAL de meta de objetivo SECUNDÁRIO
 * (`MetasSecondaryTargetForm`/`setGoalMonthlyTargetAction`, já usado em
 * `/metas`) direto no Cockpit — reaproveitado sem nenhuma alteração de
 * validação/Server Action. `MetasSecondaryTargetForm` nunca teve
 * abrir/fechar próprio porque em `/metas` ele já nasce sempre visível; este
 * wrapper só adiciona essa disclosure, nada do fluxo em si.
 */
export function CockpitSecondaryGoalEditor({
  trigger,
  clientId,
  returnTo,
  resultType,
  monthFirstDay,
  channels,
  currentTargetByChannel,
}: {
  trigger: (open: () => void) => ReactNode;
  clientId: string;
  returnTo: string;
  resultType: PerformanceGoal;
  monthFirstDay: string;
  channels: TrafficChannel[];
  currentTargetByChannel: Partial<Record<TrafficChannel, ChannelMetrics | undefined>>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) return <>{trigger(() => setIsOpen(true))}</>;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <MetasSecondaryTargetForm
        clientId={clientId}
        returnTo={returnTo}
        resultType={resultType}
        monthFirstDay={monthFirstDay}
        channels={channels}
        currentTargetByChannel={currentTargetByChannel}
      />
      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className="mitza-pressable self-start text-xs text-overview-text-muted hover:underline"
      >
        Fechar
      </button>
    </div>
  );
}
