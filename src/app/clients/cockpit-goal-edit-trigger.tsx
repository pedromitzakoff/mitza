"use client";

import { ChannelPlanEditor } from "./channel-plan-editor";
import { CockpitSecondaryGoalEditor } from "./cockpit-secondary-goal-editor";
import type { CockpitGoalEditAffordance } from "./cockpit-meta-ritmo-section";

/**
 * MITZA ONE — Refinamento do Cockpit, correção de produção: esta peça
 * precisa ser Client Component porque monta `trigger={(open) => ...}` —
 * uma FUNÇÃO passada como prop pra `ChannelPlanEditor`/
 * `CockpitSecondaryGoalEditor` (ambos "use client"). Funções nunca podem
 * atravessar a fronteira Server->Client como prop (só Server Actions
 * passam) — React Server Components lança em runtime quando isso acontece,
 * o que derrubava TODA página de cliente pra admins em mês aberto (qualquer
 * card com `edit` não-nulo). `cockpit-meta-ritmo-section.tsx` (Server
 * Component) só recebe/passa `edit`/`label` daqui pra baixo, sempre
 * serializáveis — nunca mais uma função cruzando a fronteira.
 */
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

/** Um lápis, um editor — sempre o mesmo par oficial por objetivo (seção 2
 * do pedido: "reaproveitar ações/validações/estruturas de dados
 * existentes"). Usado tanto pelo card RESULTADO quanto pelo card CUSTO POR
 * RESULTADO do objetivo PRINCIPAL (o mesmo `ChannelPlanEditor` cobre
 * Investimento + Resultado + Custo numa só calculadora — dois lápis, dois
 * pontos de entrada, nunca dois editores/dados diferentes). */
export function GoalEditTrigger({ edit, label }: { edit: CockpitGoalEditAffordance; label: string }) {
  if (edit.kind === "primary") {
    return (
      <ChannelPlanEditor
        clientId={edit.clientId}
        monthParam={edit.monthParam}
        monthLabel={edit.monthLabel}
        monthRange={edit.monthRange}
        currentPlanningEndDate={edit.currentPlanningEndDate}
        channels={edit.channels}
        byChannel={edit.byChannel}
        performanceGoal={edit.performanceGoal}
        trigger={(open) => <GoalPencilButton onClick={open} label={label} />}
      />
    );
  }

  return (
    <CockpitSecondaryGoalEditor
      trigger={(open) => <GoalPencilButton onClick={open} label={label} />}
      clientId={edit.clientId}
      returnTo={edit.returnTo}
      resultType={edit.performanceGoal}
      monthFirstDay={edit.monthRange.firstDay}
      channels={edit.channels}
      currentTargetByChannel={edit.byChannel}
    />
  );
}
