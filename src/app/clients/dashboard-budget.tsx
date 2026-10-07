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
   * ainda (input nasce vazio, nunca `0` fabricado). Distinto de `0`
   * (orçamento explicitamente zerado) — ver `renderPlannedValue` abaixo. */
  planned: number | null;
}

/** `null` (sem plano configurado) é visualmente distinto de `0`
 * (orçamento explicitamente zerado) — nunca a mesma mensagem pros dois
 * estados (Etapa "Correção de Semântica — Orçamento do Mês Multicanal"). */
function renderPlannedValue(planned: number | null): string {
  return planned != null ? formatCurrency(planned) : "Sem planejamento";
}

/**
 * "ORÇAMENTO DO MÊS" do Dashboard — Etapa "Correção de Semântica —
 * Orçamento do Mês Multicanal". O TOTAL exibido é SEMPRE a soma dos
 * planejamentos REAIS de cada canal (resolvida pelo chamador via
 * `consolidateAdditive`, nunca recalculada aqui) — nunca um terceiro
 * orçamento persistido. Abaixo do total, uma composição por canal
 * (`channels`) deixa claro de onde ele vem — só aparece com mais de um
 * canal (um canal só repetiria o mesmo número do total, mesma convenção
 * de "Consolidado só aparece com >1 canal" já usada em
 * `resolveClientChannelScopeOptions`, lib/traffic-channels.ts).
 *
 * A edição inline NUNCA inventa um "orçamento total editável" — o modelo
 * de dados só permite editar o plano de UM canal por vez
 * (`apply_monthly_channel_plan_change`, `monthly_budget_changes.channel`
 * não é nulável). Por isso o lápis abre UM campo por canal que o cliente
 * de fato usa, com um TOTAL somado em tempo real (`liveTotal` abaixo,
 * nunca enviado ao servidor) — pra deixar explícito que Meta + Google =
 * Total, sem fingir que o total em si é editável.
 *
 * Reaproveita `applyMonthlyChannelPlanChangeAction` (mesma Server Action
 * de `ChannelPlanEditor`) — UMA chamada por canal REALMENTE alterado
 * (comparado ao valor vigente/já aplicado nesta sessão de edição), nunca
 * um canal intocado reescrevendo seu próprio histórico à toa.
 * `targetResultCount` é sempre `null` ao chamar — a Server Action/RPC já
 * carregam adiante a meta de quantidade vigente quando recebem `null`,
 * nunca apagando uma meta já configurada.
 *
 * ATOMICIDADE (auditoria desta correção): não existe hoje uma RPC que
 * grave o plano de dois canais numa única transação —
 * `apply_monthly_channel_plan_change` é por canal, cada chamada já é sua
 * própria transação no banco. Editar Meta+Google aqui sempre fica DUAS
 * chamadas sequenciais independentes; se a segunda falhar depois da
 * primeira ter sido confirmada, o canal que já salvou NÃO é desfeito
 * (nenhuma transação de frontend inventada pra simular atomicidade que a
 * infraestrutura não tem). O comportamento mais seguro possível
 * implementado aqui: tentar TODOS os canais alterados (nunca parar no
 * primeiro erro, pra nunca deixar um canal "não tentado" por acaso),
 * nunca reportar sucesso total quando houve falha parcial (o editor
 * continua aberto, mostrando exatamente qual canal falhou e qual já foi
 * salvo) e nunca reenviar um canal já salvo nesta sessão se o usuário
 * corrigir o erro e salvar de novo (`appliedChannels`).
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
  /** Soma dos planejamentos reais dos canais (`consolidateAdditive`) ou o
   * fallback legado (`sumPlannedForMonth`) quando nenhum canal tem plano
   * ainda — sempre resolvido pelo chamador, nunca recalculado aqui. */
  total: number;
  channels: DashboardBudgetChannel[];
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<TrafficChannel, string>>>({});
  const [appliedChannels, setAppliedChannels] = useState<Partial<Record<TrafficChannel, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const { showToast } = useToast();

  function openEditor() {
    setDrafts(Object.fromEntries(channels.map((c) => [c.channel, c.planned != null ? formatMoneyDisplay(c.planned) : ""])));
    setAppliedChannels({});
    setError(null);
    setIsEditing(true);
  }

  function cancel() {
    setIsEditing(false);
    setDrafts({});
    setAppliedChannels({});
    setError(null);
  }

  // Soma em tempo real dos campos EM EDIÇÃO — Meta + Google = Total,
  // nunca enviada ao servidor (só os valores por canal são salvos, o
  // total continua sempre derivado, nunca um campo próprio).
  const liveTotal = channels.reduce((sum, c) => sum + (parseMoneyInput(drafts[c.channel] ?? "") ?? 0), 0);

  function handleSave() {
    setError(null);
    startSaveTransition(async () => {
      const changed = channels.filter((c) => {
        const draftValue = parseMoneyInput(drafts[c.channel] ?? "");
        const baseline = appliedChannels[c.channel] ?? c.planned;
        return (draftValue ?? 0) !== (baseline ?? 0);
      });

      if (changed.length === 0) {
        showToast("Nenhuma alteração para salvar.");
        cancel();
        return;
      }

      // Nunca para no primeiro erro — tenta TODOS os canais alterados,
      // pra sempre saber exatamente o que foi salvo e o que não foi
      // (ver nota de atomicidade no doc-comment do componente).
      const failures: string[] = [];
      const newlyApplied: Partial<Record<TrafficChannel, number>> = {};
      for (const { channel } of changed) {
        const newInvestment = parseMoneyInput(drafts[channel] ?? "") ?? 0;
        const result = await applyMonthlyChannelPlanChangeAction(clientId, monthParam, channel, newInvestment, null, null);
        if (result.error) {
          failures.push(`${TRAFFIC_CHANNELS[channel].label}: ${result.error}`);
        } else {
          newlyApplied[channel] = newInvestment;
        }
      }

      if (Object.keys(newlyApplied).length > 0) {
        setAppliedChannels((prev) => ({ ...prev, ...newlyApplied }));
      }

      if (failures.length > 0) {
        const savedLabel =
          Object.keys(newlyApplied).length > 0
            ? `${Object.keys(newlyApplied)
                .map((c) => TRAFFIC_CHANNELS[c as TrafficChannel].label)
                .join(", ")} salvo(s) com sucesso. `
            : "";
        setError(`${savedLabel}Falha ao salvar: ${failures.join("; ")}`);
        return;
      }

      showToast("Orçamento do mês atualizado.");
      setIsEditing(false);
      setDrafts({});
      setAppliedChannels({});
    });
  }

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Orçamento do mês</h2>

      {!isEditing ? (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
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
          {channels.length > 1 && (
            <ul className="flex flex-col gap-0.5">
              {channels.map((c) => (
                <li key={c.channel} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-overview-text-secondary">{TRAFFIC_CHANNELS[c.channel].label}</span>
                  <span className="tabular-nums text-overview-text-primary">{renderPlannedValue(c.planned)}</span>
                </li>
              ))}
            </ul>
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

          {channels.length > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-overview-border pt-2 text-sm">
              <span className="font-medium text-overview-text-secondary">Total</span>
              <span className="tabular-nums font-semibold text-overview-text-primary">{formatCurrency(liveTotal)}</span>
            </div>
          )}

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
