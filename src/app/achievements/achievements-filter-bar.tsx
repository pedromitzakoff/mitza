"use client";

import { useRouter } from "next/navigation";
import { ACHIEVEMENT_LEVEL_LABEL } from "@/lib/achievement-labels";
import type { AchievementLevel, AchievementScope } from "@/lib/achievement-types";

const LEVEL_OPTIONS: AchievementLevel[] = ["account", "campaign", "ad_set", "creative"];

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
  actorId,
  familyId,
  levelId,
  clients,
  teamMembers,
  familyOptions,
}: {
  scope: AchievementScope;
  clientId: string;
  actorId: string;
  familyId: string;
  levelId: string;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
  familyOptions: Record<string, string>;
}) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (scope !== "client") next.set("tab", scope);
    if (scope === "client" && clientId !== "todos") next.set("client", clientId);
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
    (scope === "client" && (clientId !== "todos" || levelId !== "todos")) || (scope === "person" && actorId !== "todos") || familyId !== "todos";

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
          onClick={() => navigate({ client: "todos", actor: "todos", family: "todos", level: "todos" })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
