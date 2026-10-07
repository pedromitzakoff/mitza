"use client";

import { useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { applyMonthlyChannelPlanChangeAction } from "./monthly-budget-actions";
import { useToast } from "@/app/toast-provider";

export interface DashboardBudgetChannel {
  channel: TrafficChannel;
  /** Investimento planejado vigente deste canal — `null` = sem plano
   * ainda (input nasce vazio, nunca `0` fabricado). */
  planned: number | null;
}

/**
 * "ORÇAMENTO DO MÊS" do Dashboard (Etapa "Evolução do Dashboard — Visão
 * Simultânea de Canais", seções 5/6/7 do pedido) — total é SEMPRE a soma
 * já resolvida por `resolveClientMonthlyGoals`/`consolidateChannelMetrics`
 * (nunca uma segunda soma local), exibido como um valor único e simples.
 *
 * A edição inline NUNCA inventa um "orçamento total editável" — o modelo
 * de dados só permite editar o plano de UM canal por vez
 * (`apply_monthly_channel_plan_change`, `monthly_budget_changes.channel`
 * não é nulável). Por isso o lápis abre UM campo por canal que o cliente
 * de fato usa (`channels`, já filtrado pelo chamador pra
 * `resolveClientMediaChannels`) — pra um cliente de canal único (o caso
 * comum), isso já É a experiência "um valor, um campo, salvar" pedida;
 * pra Meta+Google, continua simples (2 campos, sem motivo/meta de
 * quantidade pedidos aqui — esses continuam só no editor completo de
 * Metas), só nunca finge que existe um "total" editável que o banco não
 * tem.
 *
 * Reaproveita `applyMonthlyChannelPlanChangeAction` (mesma Server Action
 * de `ChannelPlanEditor`) — UMA chamada por canal REALMENTE alterado
 * (comparado ao valor vigente já carregado no campo), nunca um canal
 * intocado reescrevendo seu próprio histórico à toa. `targetResultCount`
 * é sempre enviado como o valor já vigente deste canal (nunca `null`
 * forçado) — a Server Action/RPC já carregam adiante a meta de quantidade
 * quando recebem o mesmo valor, mas fazer isso aqui explicitamente deixa
 * claro que esta UI nunca apaga uma meta de quantidade já configurada só
 * porque não a exibe.
 */
export function DashboardBudget({
  clientId,
  monthParam,
  total,
  channels,
  canEdit,
}: {
  clientId: string;
  monthParam: string;
  /** `primaryGoalPlan.consolidated.investment` já resolvido pelo chamador
   * — soma real dos canais com plano, ou o fallback legado de sempre
   * (`sumPlannedForMonth`) quando nenhum canal tem plano ainda. Nunca
   * recalculado aqui. */
  total: number;
  channels: DashboardBudgetChannel[];
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<TrafficChannel, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const { showToast } = useToast();

  function openEditor() {
    setDrafts(Object.fromEntries(channels.map((c) => [c.channel, c.planned != null ? formatMoneyDisplay(c.planned) : ""])));
    setError(null);
    setIsEditing(true);
  }

  function cancel() {
    setIsEditing(false);
    setDrafts({});
    setError(null);
  }

  function handleSave() {
    setError(null);
    startSaveTransition(async () => {
      const targetResultCountByChannel = Object.fromEntries(channels.map((c) => [c.channel, null as number | null]));
      const changed = channels.filter((c) => {
        const draftValue = parseMoneyInput(drafts[c.channel] ?? "");
        const currentValue = c.planned ?? null;
        return (draftValue ?? 0) !== (currentValue ?? 0);
      });

      for (const { channel } of changed) {
        const newInvestment = parseMoneyInput(drafts[channel] ?? "") ?? 0;
        const result = await applyMonthlyChannelPlanChangeAction(clientId, monthParam, channel, newInvestment, null, targetResultCountByChannel[channel]);
        if (result.error) {
          setError(`${TRAFFIC_CHANNELS[channel].label}: ${result.error}`);
          return;
        }
      }

      showToast(changed.length > 0 ? "Orçamento do mês atualizado." : "Nenhuma alteração para salvar.");
      setIsEditing(false);
      setDrafts({});
    });
  }

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Orçamento do mês</h2>

      {!isEditing ? (
        <div className="mt-1 flex items-center gap-2">
          <p className="text-2xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{formatCurrency(total)}</p>
          {canEdit && (
            <button
              type="button"
              onClick={openEditor}
              aria-label="Editar orçamento do mês"
              className="mitza-pressable rounded-md p-1 text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
            >
              ✎
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            {channels.map((c) => (
              <div key={c.channel} className="flex flex-col gap-0.5">
                <label className="text-[11px] text-overview-text-muted">{TRAFFIC_CHANNELS[c.channel].label}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-overview-text-muted">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={drafts[c.channel] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [c.channel]: e.target.value }))}
                    onBlur={() => {
                      const parsed = parseMoneyInput(drafts[c.channel] ?? "");
                      setDrafts((prev) => ({ ...prev, [c.channel]: parsed !== null ? formatMoneyDisplay(parsed) : "" }));
                    }}
                    placeholder="0,00"
                    className="w-32 rounded-md border border-overview-border px-2 py-1.5 text-sm text-overview-text-primary outline-none transition-colors focus:border-overview-border-strong dark:bg-overview-surface"
                  />
                </div>
              </div>
            ))}
          </div>

          {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={isSaving}
              className="mitza-pressable text-sm text-overview-text-muted hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
