"use client";

import { useRouter } from "next/navigation";
import { ACHIEVEMENT_LEVEL_LABEL } from "@/lib/achievement-labels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { AchievementLevel, AchievementScope } from "@/lib/achievement-types";

const LEVEL_OPTIONS: AchievementLevel[] = ["account", "campaign", "ad_set", "creative"];

/** Opções do filtro de Objetivo — mesma fonte canônica de sempre
 * (`clients.performance_goal`/`PerformanceGoal`, `lib/performance-goals.ts`)
 * e MESMOS rótulos curtos já usados em `OPERATION_GOAL_OPTIONS`
 * (`operation/page.tsx`/`operation-triage-view.tsx`) — "Seguidores" pro
 * terceiro valor, nunca "Awareness"/"Growth"/"Branding" (decisão já
 * documentada em `lib/performance-goals.ts`: introduzir um nome novo aqui
 * criaria uma segunda nomenclatura pro mesmo conceito). Só array local
 * diferente é o rótulo "Todos" no topo — `PerformanceGoal` descreve o
 * objetivo de UM cliente, nunca um recorte de tela. */
const GOAL_OPTIONS: { value: PerformanceGoal; label: string }[] = [
  { value: "leads", label: PERFORMANCE_GOALS.leads.label },
  { value: "sales", label: PERFORMANCE_GOALS.sales.label },
  { value: "followers", label: PERFORMANCE_GOALS.followers.label },
];

/**
 * Filtros de Conquistas — variam por aba (seção 22 da Auditoria original,
 * seção 13 do pedido "Conquistas por Granularidade"): Cliente ganha filtro
 * de cliente + Nível (novo — Conta/Campanha/Público/Criativo, só existe
 * nesta aba porque só ela tem sub-entidade), Pessoa ganha filtro de pessoa,
 * as três ganham filtro de Tipo (família). "Nível" é ORTOGONAL a "Tipo" —
 * nunca substitui, os dois combinam livremente. Nunca uma barra gigante —
 * só os filtros que fazem sentido pra aba atual, mesmo padrão de navegação
 * por `<select onChange>` já usado em `timeline-filter-bar.tsx`.
 */
export function AchievementsFilterBar({
  scope,
  clientId,
  managerId,
  goalId,
  actorId,
  familyId,
  levelId,
  clients,
  teamMembers,
  familyOptions,
}: {
  scope: AchievementScope;
  clientId: string;
  /** Etapa "Filtros de Gestor/Objetivo" — só existe (e só é lido) na aba
   * Cliente, mesmo tratamento de `levelId` abaixo. */
  managerId: string;
  goalId: string;
  actorId: string;
  familyId: string;
  levelId: string;
  clients: { id: string; name: string }[];
  /** Reaproveitado da mesma query já feita pra aba Pessoa (`page.tsx`,
   * `team_members` com `status = 'ativo'`) — nunca uma segunda consulta só
   * pra popular o filtro de Gestor (mesmo padrão de opções já usado em
   * `clients/page.tsx`/`operation-filter-bar.tsx`). */
  teamMembers: { id: string; name: string }[];
  familyOptions: Record<string, string>;
}) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (scope !== "client") next.set("tab", scope);
    if (scope === "client" && clientId !== "todos") next.set("client", clientId);
    if (scope === "client" && managerId !== "todos") next.set("manager", managerId);
    if (scope === "client" && goalId !== "todos") next.set("goal", goalId);
    if (scope === "person" && actorId !== "todos") next.set("actor", actorId);
    if (familyId !== "todos") next.set("family", familyId);
    if (scope === "client" && levelId !== "todos") next.set("level", levelId);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "" || value === "todos") next.delete(key);
      else next.set(key, value);
    }

    const query = next.toString();
    return query ? `/achievements?${query}` : "/achievements";
  }

  function navigate(overrides: Record<string, string>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const hasAnyFilter =
    (scope === "client" && (clientId !== "todos" || managerId !== "todos" || goalId !== "todos" || levelId !== "todos")) ||
    (scope === "person" && actorId !== "todos") ||
    familyId !== "todos";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {scope === "client" && (
        <select
          value={clientId}
          onChange={(event) => navigate({ client: event.target.value })}
          aria-label="Filtrar por cliente"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Cliente: todos</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      )}

      {scope === "client" && teamMembers.length > 0 && (
        <select
          value={managerId}
          onChange={(event) => navigate({ manager: event.target.value })}
          aria-label="Filtrar por gestor"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Gestor: todos</option>
          {teamMembers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      )}

      {scope === "client" && (
        <select
          value={goalId}
          onChange={(event) => navigate({ goal: event.target.value })}
          aria-label="Filtrar por objetivo"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Objetivo: todos</option>
          {GOAL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {scope === "person" && (
        <select
          value={actorId}
          onChange={(event) => navigate({ actor: event.target.value })}
          aria-label="Filtrar por pessoa"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Pessoa: todos</option>
          {teamMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={familyId}
        onChange={(event) => navigate({ family: event.target.value })}
        aria-label="Filtrar por tipo"
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="todos">Tipo: todos</option>
        {Object.entries(familyOptions).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {scope === "client" && (
        <select
          value={levelId}
          onChange={(event) => navigate({ level: event.target.value })}
          aria-label="Filtrar por nível"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Nível: todos</option>
          {LEVEL_OPTIONS.map((level) => (
            <option key={level} value={level}>
              {ACHIEVEMENT_LEVEL_LABEL[level]}
            </option>
          ))}
        </select>
      )}

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => navigate({ client: "todos", manager: "todos", goal: "todos", actor: "todos", family: "todos", level: "todos" })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
