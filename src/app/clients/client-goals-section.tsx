"use client";

import { useState, useTransition } from "react";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS, type PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { ClientGoal } from "@/lib/client-goals";
import type { CampaignForAssignment } from "@/lib/campaign-goal-assignments";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { saveCampaignAssignmentsAction } from "./campaign-assignment-actions";
import {
  createClientGoalAction,
  deleteClientGoalAction,
  recordManualGoalResultAction,
  setClientGoalPrimaryAction,
  updateClientGoalAction,
} from "./goal-actions";
import { SubmitButton } from "@/app/submit-button";

export interface RecentSprintOption {
  id: string;
  startDate: string;
  endDate: string;
}

export interface GoalDisplaySummary {
  resultType: PerformanceGoal;
  /** Meta de quantidade vigente somada entre os canais do objetivo (soma
   * simples pra exibição compacta — o cálculo real por canal/mês fica em
   * `resolveClientMonthlyGoals`, `lib/client-plan.ts`). `null` = nenhum canal
   * do objetivo tem meta definida ainda. */
  targetResultCount: number | null;
  campaignCount: number;
}

const RESULT_TYPE_OPTIONS = [...PERFORMANCE_GOAL_OPTIONS, { value: "unassigned" as const, label: "Sem objetivo" }];

/**
 * "Objetivos da conta" (Etapa "Múltiplos Objetivos") — card compacto no
 * Cadastro do Cliente + drawer único "Classificar campanhas" (auditoria
 * seção 18/19: uma tabela só pra todas as campanhas, nunca um drawer por
 * objetivo). Client component porque o drawer é estado local compartilhado
 * entre vários botões "Gerenciar campanhas" — mesmo padrão de
 * `CreativeComparisonDrawer`.
 */
export function ClientGoalsSection({
  clientId,
  returnTo,
  goals,
  summaries,
  campaigns,
  recentSprints,
}: {
  clientId: string;
  returnTo: string;
  goals: ClientGoal[];
  summaries: Map<PerformanceGoal, GoalDisplaySummary>;
  campaigns: CampaignForAssignment[];
  recentSprints: RecentSprintOption[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const existingResultTypes = new Set(goals.map((g) => g.resultType));
  const availableToAdd = PERFORMANCE_GOAL_OPTIONS.filter((opt) => !existingResultTypes.has(opt.value));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {goals.length === 0 && (
          <p className="text-xs text-zinc-500">Nenhum objetivo configurado ainda — adicione o primeiro abaixo.</p>
        )}

        {goals.map((goal) => {
          const summary = summaries.get(goal.resultType);
          const config = PERFORMANCE_GOALS[goal.resultType];
          return (
            <div key={goal.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-black dark:text-zinc-50">{config.label}</span>
                  {goal.isPrimary && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
                      Principal
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!goal.isPrimary && (
                    <form action={setClientGoalPrimaryAction.bind(null, goal.id, clientId, returnTo)}>
                      <SubmitButton pendingChildren="..." className="text-xs text-zinc-500 hover:text-brand">
                        Definir como principal
                      </SubmitButton>
                    </form>
                  )}
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="text-xs text-zinc-500 hover:text-brand"
                  >
                    Gerenciar campanhas
                  </button>
                  {!goal.isPrimary && (
                    <form action={deleteClientGoalAction.bind(null, goal.id, clientId, returnTo)}>
                      <SubmitButton pendingChildren="..." className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400">
                        Remover
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500 sm:grid-cols-4">
                <div>
                  <dt className="uppercase tracking-wide">Meta mensal</dt>
                  <dd className="text-black dark:text-zinc-50">
                    {summary?.targetResultCount !== null && summary?.targetResultCount !== undefined
                      ? `${summary.targetResultCount} ${config.pluralLabel.toLowerCase()}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Fonte</dt>
                  <dd className="text-black dark:text-zinc-50">{goal.resultSource === "manual" ? "Manual" : "Automática"}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Canais</dt>
                  <dd className="text-black dark:text-zinc-50">
                    {goal.channels.length > 0 ? goal.channels.map((c) => TRAFFIC_CHANNELS[c].shortLabel).join(", ") : "Todos"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Campanhas vinculadas</dt>
                  <dd className="text-black dark:text-zinc-50">{summary?.campaignCount ?? 0}</dd>
                </div>
              </dl>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-brand">Configuração avançada</summary>
                <form action={updateClientGoalAction.bind(null, goal.id, clientId, returnTo)} className="mt-2 flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">Fonte do resultado</label>
                    <select
                      name="result_source"
                      defaultValue={goal.resultSource}
                      className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
                    >
                      <option value="automatic">Automática (integração/lançamento por sprint)</option>
                      <option value="manual">Manual (lançamento por período)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">Canais (vazio = todos)</label>
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TRAFFIC_CHANNELS.map((channel) => (
                        <label key={channel} className="flex items-center gap-1 text-xs text-black dark:text-zinc-50">
                          <input
                            type="checkbox"
                            name="channels"
                            value={channel}
                            defaultChecked={goal.channels.includes(channel)}
                            className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                          />
                          {TRAFFIC_CHANNELS[channel].shortLabel}
                        </label>
                      ))}
                    </div>
                  </div>
                  <SubmitButton pendingChildren="Salvando..." className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-black dark:border-zinc-700 dark:text-zinc-50">
                    Salvar
                  </SubmitButton>
                </form>
              </details>

              {goal.resultSource === "manual" && (
                <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Lançar resultado manual</p>
                  {recentSprints.length === 0 ? (
                    <p className="mt-1 text-xs text-zinc-500">Nenhuma sprint disponível ainda pra este cliente.</p>
                  ) : (
                    <form
                      action={recordManualGoalResultAction.bind(null, clientId, returnTo)}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="result_type" value={goal.resultType} />
                      <input type="hidden" name="channel" value={goal.channels[0] ?? "meta"} />
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-zinc-500">Sprint</label>
                        <select
                          name="sprint_id"
                          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
                        >
                          {recentSprints.map((sprint) => (
                            <option key={sprint.id} value={sprint.id}>
                              {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-zinc-500">{config.pluralLabel} no período</label>
                        <input
                          type="number"
                          name="result_count"
                          min={0}
                          step={1}
                          required
                          className="w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
                        />
                      </div>
                      <SubmitButton pendingChildren="Salvando..." className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                        Registrar
                      </SubmitButton>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {availableToAdd.length > 0 && (
        <form action={createClientGoalAction.bind(null, clientId, returnTo)} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Novo objetivo</label>
            <select
              name="result_type"
              defaultValue={availableToAdd[0]?.value}
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            >
              {availableToAdd.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton pendingChildren="Adicionando..." className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
            + Adicionar objetivo
          </SubmitButton>
        </form>
      )}

      {drawerOpen && (
        <CampaignClassificationDrawer clientId={clientId} campaigns={campaigns} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}

function CampaignClassificationDrawer({
  clientId,
  campaigns,
  onClose,
}: {
  clientId: string;
  campaigns: CampaignForAssignment[];
  onClose: () => void;
}) {
  type PendingValue = PerformanceGoal | "unassigned";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned">("all");
  const [pending, setPending] = useState<Map<string, PendingValue>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  function keyFor(channel: TrafficChannel, campaignId: string) {
    return `${channel}:${campaignId}`;
  }

  function currentValue(campaign: CampaignForAssignment): PendingValue {
    if (!campaign.campaignId) return "unassigned";
    const key = keyFor(campaign.channel, campaign.campaignId);
    return pending.get(key) ?? campaign.currentResultType ?? "unassigned";
  }

  const filtered = campaigns.filter((c) => {
    if (search && !c.campaignName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "unassigned" && currentValue(c) !== "unassigned") return false;
    return true;
  });

  function handleSave() {
    setError(null);
    const changes = Array.from(pending.entries())
      .map(([key, value]) => {
        const [channel, campaignId] = key.split(":") as [TrafficChannel, string];
        return { channel, campaignId, resultType: value === "unassigned" ? null : value };
      });

    if (changes.length === 0) {
      onClose();
      return;
    }

    startSaving(async () => {
      const result = await saveCampaignAssignmentsAction(clientId, changes);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <>
      <button type="button" onClick={onClose} aria-label="Fechar classificação de campanhas" className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Classificar campanhas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A cada campanha, um objetivo — a classificação define de onde vem o investimento de cada objetivo (nunca
              rateado).
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
            ×
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campanha..."
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "all" ? "border-brand text-brand" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFilter("unassigned")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "unassigned" ? "border-brand text-brand" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
            >
              Sem objetivo
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1 overflow-x-auto">
          {filtered.length === 0 && <p className="text-xs text-zinc-500">Nenhuma campanha encontrada.</p>}
          {filtered.map((campaign) => {
            const key = campaign.campaignId ? keyFor(campaign.channel, campaign.campaignId) : null;
            const value = currentValue(campaign);
            return (
              <div
                key={key ?? `${campaign.channel}:${campaign.campaignName}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-zinc-100 py-2 text-sm dark:border-zinc-900"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-black dark:text-zinc-50">{campaign.campaignName}</p>
                  <p className="text-xs text-zinc-500">
                    {TRAFFIC_CHANNELS[campaign.channel].shortLabel} · {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(campaign.recentSpend)}
                  </p>
                </div>
                <select
                  value={value}
                  disabled={!campaign.campaignId}
                  onChange={(e) => {
                    if (!key) return;
                    const next = new Map(pending);
                    next.set(key, e.target.value as PendingValue);
                    setPending(next);
                  }}
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs text-black disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50"
                >
                  {RESULT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {!campaign.campaignId && (
                  <span className="text-[10px] text-zinc-400" title="Fonte sem ID de campanha configurado — não classificável ainda">
                    sem ID
                  </span>
                )}
                {campaign.campaignId && <span />}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-black dark:border-zinc-700 dark:text-zinc-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {isSaving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </>
  );
}
