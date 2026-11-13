"use client";

import { useState, useTransition } from "react";
import { PERFORMANCE_GOALS, AVAILABLE_PERFORMANCE_GOAL_OPTIONS, type PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { ClientGoal } from "@/lib/client-goals";
import type { CampaignForAssignment } from "@/lib/campaign-goal-assignments";
import type { ActiveMetricMapping, ClientMetaMappingSource } from "@/lib/client-metric-mapping-source";
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
import { ActionTypePicker } from "@/app/settings/meta-connections/action-type-picker";
import { saveMetricMappingAction } from "@/app/settings/meta-connections/actions";
import { CLIENT_SETTINGS_SAVE_BUTTON_CLASSES } from "./client-settings-ui";

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

const RESULT_TYPE_OPTIONS = [...AVAILABLE_PERFORMANCE_GOAL_OPTIONS, { value: "unassigned" as const, label: "Sem objetivo" }];

/** "actions.lead" → "lead" — mesmo valor técnico que `/clients/[id]/dados`
 * mostra por extenso (admin-only, aquela tela é "detalhe técnico"), mas
 * aqui a seção é a de configuração do dia a dia: só o nome do evento, sem
 * o prefixo de coluna interna (`META_API_ACTIONS_PREFIX`, `meta-api-ingest.ts`). */
function friendlyActionType(resultColumn: string): string {
  return resultColumn.replace(/^actions\./, "");
}

/**
 * "Métricas de performance" (Etapa "Configuração inteligente de métricas
 * por cliente", evolução de "Objetivos da conta" / Etapa "Múltiplos
 * Objetivos") — card compacto no Cadastro do Cliente + drawer único
 * "Classificar campanhas" (auditoria seção 18/19: uma tabela só pra todas
 * as campanhas, nunca um drawer por objetivo). Client component porque o
 * drawer é estado local compartilhado entre vários botões "Gerenciar
 * campanhas".
 *
 * `metaMappingSource`/`metaMappingsByGoal` (novos): a mesma
 * `ActionTypePicker`/`discoverActionTypesAction`/`saveMetricMappingAction`
 * já usadas em `/settings/meta-connections` — reaproveitadas aqui, nunca
 * duplicadas, via `fixedGoal` (o objetivo já está implícito no card, não
 * precisa de um segundo seletor). Objetivo "followers" nunca mostra isto:
 * não vem do Meta Ads, não tem `action_type` nenhum pra mapear.
 */
export function ClientGoalsSection({
  clientId,
  returnTo,
  goals,
  summaries,
  campaigns,
  recentSprints,
  metaMappingSource,
  metaMappingsByGoal,
}: {
  clientId: string;
  returnTo: string;
  goals: ClientGoal[];
  summaries: Map<PerformanceGoal, GoalDisplaySummary>;
  campaigns: CampaignForAssignment[];
  recentSprints: RecentSprintOption[];
  /** `null` = cliente sem conta Meta conectada ainda — a seção "Evento da
   * Meta" simplesmente não aparece (nada pra mapear), com uma nota única
   * explicando o motivo (nunca escondido sem explicação). */
  metaMappingSource: ClientMetaMappingSource | null;
  metaMappingsByGoal: Map<PerformanceGoal, ActiveMetricMapping>;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const existingResultTypes = new Set(goals.map((g) => g.resultType));
  const availableToAdd = AVAILABLE_PERFORMANCE_GOAL_OPTIONS.filter((opt) => !existingResultTypes.has(opt.value));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {goals.length === 0 && (
          <p className="text-xs text-overview-text-secondary">Nenhum objetivo configurado ainda — adicione o primeiro abaixo.</p>
        )}

        {goals.length > 0 && !metaMappingSource && (
          <p className="text-xs text-overview-text-muted">
            Conecte a conta Meta deste cliente (Configurações → Integrações → Conexões Meta) para mapear eventos automaticamente aqui.
          </p>
        )}

        {goals.map((goal) => {
          const summary = summaries.get(goal.resultType);
          const config = PERFORMANCE_GOALS[goal.resultType];
          const currentMapping = metaMappingsByGoal.get(goal.resultType) ?? null;
          const showMetaEventPicker = goal.resultType !== "followers" && metaMappingSource !== null;

          return (
            <div key={goal.id} className="rounded-md border border-overview-border bg-overview-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-overview-text-primary">{config.label}</span>
                  {goal.isPrimary && (
                    <span className="rounded-full bg-steel-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-steel">
                      Principal
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!goal.isPrimary && (
                    <form action={setClientGoalPrimaryAction.bind(null, goal.resultType, clientId, returnTo)}>
                      <SubmitButton pendingChildren="..." className="text-xs text-overview-text-secondary hover:text-brand">
                        Definir como principal
                      </SubmitButton>
                    </form>
                  )}
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="text-xs text-overview-text-secondary hover:text-brand"
                  >
                    Gerenciar campanhas
                  </button>
                  {!goal.isPrimary && (
                    <form action={deleteClientGoalAction.bind(null, goal.id, clientId, returnTo)}>
                      <SubmitButton pendingChildren="..." className="text-xs text-overview-text-secondary hover:text-overview-danger">
                        Remover
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-overview-text-secondary sm:grid-cols-4">
                <div>
                  <dt className="uppercase tracking-wide">Meta mensal</dt>
                  <dd className="text-overview-text-primary">
                    {summary?.targetResultCount !== null && summary?.targetResultCount !== undefined
                      ? `${summary.targetResultCount} ${config.pluralLabel.toLowerCase()}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Fonte</dt>
                  <dd className="text-overview-text-primary">{goal.resultSource === "manual" ? "Manual" : "Automática"}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Canais</dt>
                  <dd className="text-overview-text-primary">
                    {goal.channels.length > 0 ? goal.channels.map((c) => TRAFFIC_CHANNELS[c].shortLabel).join(", ") : "Todos"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Campanhas vinculadas</dt>
                  <dd className="text-overview-text-primary">{summary?.campaignCount ?? 0}</dd>
                </div>
              </dl>

              {showMetaEventPicker && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-overview-text-secondary hover:text-brand">
                    Evento da Meta:{" "}
                    <span className="font-medium text-overview-text-primary">
                      {currentMapping ? friendlyActionType(currentMapping.resultColumn) : "Não configurado"}
                    </span>
                  </summary>
                  <div className="mt-2">
                    <ActionTypePicker
                      accountId={metaMappingSource.externalAccountId}
                      saveMappingAction={saveMetricMappingAction.bind(null, metaMappingSource.importSourceId, clientId)}
                      fixedGoal={goal.resultType}
                      heading="Alterar evento"
                    />
                  </div>
                </details>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-overview-text-secondary hover:text-brand">Configuração avançada</summary>
                <form action={updateClientGoalAction.bind(null, goal.id, clientId, returnTo)} className="mt-2 flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-overview-text-secondary">Fonte do resultado</label>
                    <select
                      name="result_source"
                      defaultValue={goal.resultSource}
                      className="rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary"
                    >
                      <option value="automatic">Automática (integração/lançamento por sprint)</option>
                      <option value="manual">Manual (lançamento por período)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-overview-text-secondary">Canais (vazio = todos)</label>
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TRAFFIC_CHANNELS.map((channel) => (
                        <label key={channel} className="flex items-center gap-1 text-xs text-overview-text-primary">
                          <input
                            type="checkbox"
                            name="channels"
                            value={channel}
                            defaultChecked={goal.channels.includes(channel)}
                            className="h-3.5 w-3.5 rounded border-overview-border accent-brand"
                          />
                          {TRAFFIC_CHANNELS[channel].shortLabel}
                        </label>
                      ))}
                    </div>
                  </div>
                  <SubmitButton pendingChildren="Salvando..." className={CLIENT_SETTINGS_SAVE_BUTTON_CLASSES}>
                    Salvar
                  </SubmitButton>
                </form>
              </details>

              {goal.resultSource === "manual" && (
                <div className="mt-3 border-t border-overview-border pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-overview-text-muted">Lançar resultado manual</p>
                  {recentSprints.length === 0 ? (
                    <p className="mt-1 text-xs text-overview-text-secondary">Nenhuma sprint disponível ainda pra este cliente.</p>
                  ) : (
                    <form
                      action={recordManualGoalResultAction.bind(null, clientId, returnTo)}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="result_type" value={goal.resultType} />
                      <input type="hidden" name="channel" value={goal.channels[0] ?? "meta"} />
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-overview-text-secondary">Sprint</label>
                        <select
                          name="sprint_id"
                          className="rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary"
                        >
                          {recentSprints.map((sprint) => (
                            <option key={sprint.id} value={sprint.id}>
                              {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-overview-text-secondary">{config.pluralLabel} no período</label>
                        <input
                          type="number"
                          name="result_count"
                          min={0}
                          step={1}
                          required
                          className="w-28 rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary"
                        />
                      </div>
                      <SubmitButton pendingChildren="Salvando..." className={CLIENT_SETTINGS_SAVE_BUTTON_CLASSES}>
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
            <label className="text-xs text-overview-text-secondary">Novo objetivo</label>
            <select
              name="result_type"
              defaultValue={availableToAdd[0]?.value}
              className="rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary"
            >
              {availableToAdd.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton pendingChildren="Adicionando..." className={CLIENT_SETTINGS_SAVE_BUTTON_CLASSES}>
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
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-overview-surface-hover">
            ×
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campanha..."
            className="flex-1 rounded-md border border-overview-border bg-transparent px-2 py-1.5 text-sm text-overview-text-primary"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "all" ? "border-brand text-brand" : "border-overview-border text-overview-text-secondary"}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFilter("unassigned")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "unassigned" ? "border-brand text-brand" : "border-overview-border text-overview-text-secondary"}`}
            >
              Sem objetivo
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1 overflow-x-auto">
          {filtered.length === 0 && <p className="text-xs text-overview-text-secondary">Nenhuma campanha encontrada.</p>}
          {filtered.map((campaign) => {
            const key = campaign.campaignId ? keyFor(campaign.channel, campaign.campaignId) : null;
            const value = currentValue(campaign);
            return (
              <div
                key={key ?? `${campaign.channel}:${campaign.campaignName}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-overview-border py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-overview-text-primary">{campaign.campaignName}</p>
                  <p className="text-xs text-overview-text-secondary">
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
                  className="rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary disabled:opacity-40"
                >
                  {RESULT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {!campaign.campaignId && (
                  <span className="text-[10px] text-overview-text-muted" title="Fonte sem ID de campanha configurado — não classificável ainda">
                    sem ID
                  </span>
                )}
                {campaign.campaignId && <span />}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-overview-danger">{error}</p>}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-overview-border px-3 py-1.5 text-sm text-overview-text-primary">
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
