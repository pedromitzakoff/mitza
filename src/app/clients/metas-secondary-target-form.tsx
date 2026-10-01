import type { ChannelMetrics } from "@/lib/channel-metrics";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { setGoalMonthlyTargetAction } from "./goal-actions";
import { SubmitButton } from "@/app/submit-button";

/**
 * Edição segura de meta de quantidade pra objetivo SECUNDÁRIO (Etapa "MEGA
 * FACELIFT — Fase 2: Metas", seção 9 do pedido) — `setGoalMonthlyTargetAction`
 * já existia (Etapa "Múltiplos Objetivos"), validada no servidor E no
 * banco contra gravar no objetivo principal por engano
 * (`set_goal_monthly_target` rejeita explicitamente), mas nunca tinha um
 * formulário que a chamasse — Metas é a primeira tela a expor essa ação.
 *
 * Deliberadamente SEM campo de investimento: a auditoria confirmou que
 * investimento de um objetivo secundário nunca é planejado manualmente
 * (é sempre derivado das campanhas classificadas a ele) — oferecer um
 * campo aqui seria inventar uma meta que o resto da plataforma não
 * consegue honrar.
 */
export function MetasSecondaryTargetForm({
  clientId,
  returnTo,
  resultType,
  monthFirstDay,
  channels,
  currentTargetByChannel,
}: {
  clientId: string;
  returnTo: string;
  resultType: PerformanceGoal;
  /** Sempre `YYYY-MM-01` — mesma convenção de `monthly_budget_changes.month`. */
  monthFirstDay: string;
  channels: TrafficChannel[];
  currentTargetByChannel: Partial<Record<TrafficChannel, ChannelMetrics | undefined>>;
}) {
  const config = PERFORMANCE_GOALS[resultType];

  return (
    <div className="rounded-md border border-overview-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-overview-text-muted">Meta de {config.pluralLabel.toLowerCase()} por canal</p>
      <p className="mt-1 text-[11px] text-overview-text-secondary">
        Objetivo secundário — só a meta de quantidade é editável aqui. O investimento deste objetivo é sempre derivado das campanhas classificadas
        a ele (nunca planejado manualmente, ver &ldquo;Investimento&rdquo; no resumo acima).
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {channels.map((channel) => (
          <form key={channel} action={setGoalMonthlyTargetAction.bind(null, clientId, returnTo)} className="flex items-end gap-2">
            <input type="hidden" name="result_type" value={resultType} />
            <input type="hidden" name="channel" value={channel} />
            <input type="hidden" name="month" value={monthFirstDay} />
            <span className="w-24 shrink-0 text-xs text-overview-text-secondary">{TRAFFIC_CHANNELS[channel].shortLabel}</span>
            <input
              type="number"
              name="target_result_count"
              min={0}
              step={1}
              defaultValue={currentTargetByChannel[channel]?.resultCount ?? ""}
              placeholder="Meta"
              className="w-24 rounded-md border border-overview-border px-2 py-1 text-sm text-overview-text-primary outline-none transition-colors focus:border-overview-border-strong dark:bg-overview-surface"
            />
            <SubmitButton
              pendingChildren="..."
              className="rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
            >
              Salvar
            </SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}
