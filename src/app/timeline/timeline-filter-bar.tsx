"use client";

import { useRouter } from "next/navigation";
import { AGENCY_TIMELINE_TYPE_OPTIONS, AGENCY_TIMELINE_FAMILY_OPTIONS, type AgencyTimelineType, type AgencyTimelineFamilyFilter } from "@/lib/agency-timeline";

/**
 * Filtros da Timeline Geral da Agência — Gestor + Cliente (mesmos de sempre)
 * combinados com o filtro por Tipo (Etapa "Histórico de Decisões
 * Operacionais") e, agora, o filtro por Família (Etapa "Timeline 2.0", seção
 * 7 do pedido: "Todos | Ações | Performance", ortogonal ao Tipo — só faz
 * sentido pra ações, então some da tela quando Performance está selecionado,
 * em vez de ficar visível e sem efeito). Mesmo padrão de navegação por
 * `<select onChange>`/botão já usado no resto da plataforma — sem estado de
 * filtro local, a página inteira já é server-driven pela URL; trocar um
 * filtro nunca reseta os outros (cada `navigate` só sobrescreve a chave que
 * mudou).
 */
export function TimelineFilterBar({
  actorId,
  clientId,
  type,
  family,
  actors,
  clients,
}: {
  actorId: string;
  clientId: string;
  type: AgencyTimelineType;
  family: AgencyTimelineFamilyFilter;
  actors: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (actorId !== "todos") next.set("actor", actorId);
    if (clientId !== "todos") next.set("client", clientId);
    if (type !== "todos") next.set("type", type);
    if (family !== "todos") next.set("family", family);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "" || value === "todos") next.delete(key);
      else next.set(key, value);
    }

    const query = next.toString();
    return query ? `/timeline?${query}` : "/timeline";
  }

  function navigate(overrides: Record<string, string>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const hasAnyFilter = actorId !== "todos" || clientId !== "todos" || type !== "todos" || family !== "todos";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por família de evento">
        {AGENCY_TIMELINE_FAMILY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => navigate({ family: option.value })}
            aria-pressed={family === option.value}
            className={
              family === option.value
                ? "rounded-md bg-brand px-3 py-1 text-sm font-medium text-white"
                : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {family !== "performance" && (
          <select
            value={type}
            onChange={(event) => navigate({ type: event.target.value })}
            aria-label="Filtrar por tipo"
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {AGENCY_TIMELINE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === "todos" ? "Tipo: todos" : option.label}
              </option>
            ))}
          </select>
        )}

        <select
          value={actorId}
          onChange={(event) => navigate({ actor: event.target.value })}
          aria-label="Filtrar por gestor"
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <option value="todos">Gestor: todos</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>

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

        {hasAnyFilter && (
          <button
            type="button"
            onClick={() => navigate({ actor: "todos", client: "todos", type: "todos", family: "todos" })}
            className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
