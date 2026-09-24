"use client";

import { useMemo, useState, useTransition } from "react";
import { FUNNEL_INDICATOR_VALUES, FUNNEL_INDICATOR_LABELS, funnelShowsResults, sortFunnelsForDisplay, type ClientFunnel } from "@/lib/client-funnels";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS } from "@/lib/performance-goals";
import type { CampaignForFunnelClassification } from "@/lib/client-funnels-data";
import { createClientFunnelAction, saveFunnelClassificationsAction, setClientFunnelActiveAction, updateClientFunnelAction } from "./funnel-actions";
import { SubmitButton } from "@/app/submit-button";

/**
 * "Funis" (Etapa "Gestão de Funis Estratégicos por Cliente") — seção da
 * página do cliente pra criar/editar/desativar funis estratégicos e
 * classificar campanhas reais em cada um, sem depender do desenvolvedor pra
 * cadastrar uma nova frente. Mesmo padrão visual/UX de `ClientGoalsSection`
 * (card por item + drawer único de classificação com busca/filtro) — a
 * diferença central é que aqui a classificação SUGERE por chave de
 * nomenclatura (nunca decide sozinha, sempre precisa de confirmação
 * explícita, individual ou em lote).
 */
export function FunnelsSection({
  clientId,
  returnTo,
  funnels,
  campaigns,
  isAdmin,
}: {
  clientId: string;
  returnTo: string;
  funnels: ClientFunnel[];
  campaigns: CampaignForFunnelClassification[];
  isAdmin: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const sorted = useMemo(() => sortFunnelsForDisplay(funnels), [funnels]);
  const pendingCount = campaigns.filter((c) => c.campaignId && !c.currentFunnelId).length;

  return (
    <div className="flex flex-col gap-4">
      {sorted.length === 0 && !creating && (
        <p className="text-xs text-zinc-500">Nenhum funil configurado ainda — crie o primeiro abaixo.</p>
      )}

      <div className="flex flex-col gap-3">
        {sorted.map((funnel) => (
          <FunnelCard key={funnel.id} clientId={clientId} returnTo={returnTo} funnel={funnel} isAdmin={isAdmin} onClassify={() => setDrawerOpen(true)} />
        ))}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          {sorted.length > 0 && (
            <button type="button" onClick={() => setDrawerOpen(true)} className="text-xs font-semibold text-zinc-500 underline underline-offset-2 hover:text-brand">
              Classificar campanhas{pendingCount > 0 ? ` (${pendingCount} pendente${pendingCount > 1 ? "s" : ""})` : ""}
            </button>
          )}
          {!creating ? (
            <button type="button" onClick={() => setCreating(true)} className="text-xs font-semibold text-brand hover:underline">
              + Novo funil
            </button>
          ) : (
            <FunnelForm clientId={clientId} returnTo={returnTo} onDone={() => setCreating(false)} />
          )}
        </div>
      )}

      {drawerOpen && (
        <FunnelClassificationDrawer clientId={clientId} funnels={sorted} campaigns={campaigns} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}

function IndicatorBadges({ funnel }: { funnel: ClientFunnel }) {
  const badges: string[] = [];
  if (funnel.linkedResultType) badges.push(PERFORMANCE_GOALS[funnel.linkedResultType].label);
  for (const indicator of funnel.relevantIndicators) {
    if (indicator === "results" && !funnelShowsResults(funnel)) continue; // marcado mas sem meta vinculada — nunca produz número real, não vale badge.
    badges.push(FUNNEL_INDICATOR_LABELS[indicator]);
  }
  if (badges.length === 0) return <span className="text-xs text-zinc-400">Sem indicadores além de investimento</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((label) => (
        <span key={label} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {label}
        </span>
      ))}
    </div>
  );
}

function FunnelCard({
  clientId,
  returnTo,
  funnel,
  isAdmin,
  onClassify,
}: {
  clientId: string;
  returnTo: string;
  funnel: ClientFunnel;
  isAdmin: boolean;
  onClassify: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className={`rounded-md border border-zinc-200 p-3 dark:border-zinc-800 ${!funnel.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-black dark:text-zinc-50">{funnel.name}</span>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">[{funnel.namingKey}]</span>
          {!funnel.isActive && (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Desativado
            </span>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClassify} className="text-xs text-zinc-500 hover:text-brand">
              Classificar campanhas
            </button>
            <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs text-zinc-500 hover:text-brand">
              {editing ? "Fechar" : "Editar"}
            </button>
            <form action={setClientFunnelActiveAction.bind(null, funnel.id, clientId, !funnel.isActive, returnTo)}>
              <SubmitButton pendingChildren="..." className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400">
                {funnel.isActive ? "Desativar" : "Reativar"}
              </SubmitButton>
            </form>
          </div>
        )}
      </div>

      <div className="mt-2">
        <IndicatorBadges funnel={funnel} />
      </div>

      {editing && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
          <FunnelForm
            clientId={clientId}
            returnTo={returnTo}
            funnel={funnel}
            action={updateClientFunnelAction.bind(null, funnel.id, clientId, returnTo)}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

function FunnelForm({
  clientId,
  returnTo,
  funnel,
  action,
  onDone,
}: {
  clientId: string;
  returnTo: string;
  funnel?: ClientFunnel;
  action?: (formData: FormData) => void;
  onDone: () => void;
}) {
  const formAction = action ?? createClientFunnelAction.bind(null, clientId, returnTo);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Nome do funil</label>
          <input
            type="text"
            name="name"
            required
            defaultValue={funnel?.name}
            placeholder="ex.: Captação"
            className="w-44 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Chave de nomenclatura</label>
          <input
            type="text"
            name="naming_key"
            required
            defaultValue={funnel?.namingKey}
            placeholder="ex.: CAPTACAO"
            className="w-36 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm uppercase text-black dark:border-zinc-700 dark:text-zinc-50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Meta vinculada</label>
          <select
            name="linked_result_type"
            defaultValue={funnel?.linkedResultType ?? ""}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
          >
            <option value="">Nenhuma (só investimento)</option>
            {PERFORMANCE_GOAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">Indicadores relevantes na Visão por funil</label>
        <div className="flex flex-wrap gap-3">
          {FUNNEL_INDICATOR_VALUES.map((indicator) => (
            <label key={indicator} className="flex items-center gap-1 text-xs text-black dark:text-zinc-50">
              <input
                type="checkbox"
                name="relevant_indicators"
                value={indicator}
                defaultChecked={funnel?.relevantIndicators.includes(indicator)}
                className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
              />
              {FUNNEL_INDICATOR_LABELS[indicator]}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-zinc-400">&quot;Resultados&quot; só mostra número real quando há meta vinculada acima.</p>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton pendingChildren="Salvando..." className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
          {funnel ? "Salvar" : "Criar funil"}
        </SubmitButton>
        <button type="button" onClick={onDone} className="text-xs text-zinc-500 hover:text-black dark:hover:text-zinc-50">
          Cancelar
        </button>
      </div>
    </form>
  );
}

type PendingValue = string | "pending";

/**
 * Drawer "Classificar campanhas" — sugestão por chave SEMPRE visível e
 * distinta da classificação confirmada (nunca a mesma cor/peso), confirmação
 * individual (select) ou em lote ("Confirmar todas as sugestões", só afeta
 * campanhas com id confiável e sugestão sem ambiguidade — nunca aplica uma
 * sugestão ambígua ou sem chave reconhecida).
 */
function FunnelClassificationDrawer({
  clientId,
  funnels,
  campaigns,
  onClose,
}: {
  clientId: string;
  funnels: ClientFunnel[];
  campaigns: CampaignForFunnelClassification[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [pending, setPending] = useState<Map<string, PendingValue>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const funnelById = useMemo(() => new Map(funnels.map((f) => [f.id, f])), [funnels]);

  function currentValue(campaign: CampaignForFunnelClassification): PendingValue {
    if (!campaign.campaignId) return "pending";
    return pending.get(campaign.campaignId) ?? campaign.currentFunnelId ?? "pending";
  }

  const filtered = campaigns.filter((c) => {
    if (search && !c.campaignName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "pending" && currentValue(c) !== "pending") return false;
    return true;
  });

  const confirmableSuggestions = campaigns.filter(
    (c) => c.campaignId && !c.currentFunnelId && c.keySuggestion.kind === "matched" && !pending.has(c.campaignId),
  );

  function applySuggestion(campaignId: string, funnelId: string) {
    const next = new Map(pending);
    next.set(campaignId, funnelId);
    setPending(next);
  }

  function confirmAllSuggestions() {
    const next = new Map(pending);
    for (const c of confirmableSuggestions) {
      if (c.campaignId && c.keySuggestion.kind === "matched") next.set(c.campaignId, c.keySuggestion.funnelId);
    }
    setPending(next);
  }

  function handleSave() {
    setError(null);
    const changes = Array.from(pending.entries()).map(([campaignId, value]) => ({
      campaignId,
      funnelId: value === "pending" ? null : value,
    }));

    if (changes.length === 0) {
      onClose();
      return;
    }

    startSaving(async () => {
      const result = await saveFunnelClassificationsAction(clientId, changes);
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
            <h2 className="text-lg font-semibold text-foreground">Classificar campanhas em funis</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A sugestão pela chave de nomenclatura nunca é definitiva — confirme ou corrija cada campanha, individualmente
              ou em lote.
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
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "all" ? "border-brand text-brand" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setFilter("pending")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "pending" ? "border-brand text-brand" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
            >
              Pendentes
            </button>
          </div>
          {confirmableSuggestions.length > 0 && (
            <button type="button" onClick={confirmAllSuggestions} className="text-xs font-semibold text-brand hover:underline">
              Confirmar todas as sugestões ({confirmableSuggestions.length})
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-1 overflow-x-auto">
          {filtered.length === 0 && <p className="text-xs text-zinc-500">Nenhuma campanha encontrada.</p>}
          {filtered.map((campaign) => {
            const value = currentValue(campaign);
            const suggestion = campaign.keySuggestion;
            const suggestedFunnel = suggestion.kind === "matched" ? funnelById.get(suggestion.funnelId) : undefined;
            return (
              <div
                key={campaign.campaignId ?? `name:${campaign.campaignName}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-zinc-100 py-2 text-sm dark:border-zinc-900"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-black dark:text-zinc-50">{campaign.campaignName}</p>
                  <p className="text-xs text-zinc-500">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(campaign.recentSpend)} nos últimos 30 dias
                    {!campaign.campaignId && <span className="ml-2 text-[10px] text-zinc-400">sem ID — não classificável</span>}
                    {campaign.campaignId && value === "pending" && suggestedFunnel && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Sugestão: {suggestedFunnel.name}
                      </span>
                    )}
                    {campaign.campaignId && value === "pending" && suggestion.kind === "ambiguous" && (
                      <span className="ml-2 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                        Chave ambígua — mais de um funil bate
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {campaign.campaignId && value === "pending" && suggestedFunnel && (
                    <button
                      type="button"
                      onClick={() => applySuggestion(campaign.campaignId as string, suggestedFunnel.id)}
                      className="text-xs font-semibold text-brand hover:underline"
                    >
                      Confirmar
                    </button>
                  )}
                  <select
                    value={value}
                    disabled={!campaign.campaignId}
                    onChange={(e) => {
                      if (!campaign.campaignId) return;
                      const next = new Map(pending);
                      next.set(campaign.campaignId, e.target.value);
                      setPending(next);
                    }}
                    className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs text-black disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50"
                  >
                    <option value="pending">Pendente</option>
                    {funnels.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
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
