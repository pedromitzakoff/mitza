"use client";

import { useRouter } from "next/navigation";

/**
 * Filtros da Timeline Geral da Agência — só os dois que a auditoria
 * confirmou como realmente úteis (Gestor + Cliente, ambos já indexados em
 * `operational_events`): nunca uma barra grande, nunca um filtro por Tipo
 * de evento (a curadoria já feita em `lib/agency-timeline.ts` cobre isso).
 * Mesmo padrão de navegação por `<select onChange>` já usado em
 * `clients/clients-filters.tsx` — sem estado de filtro local, a página
 * inteira já é server-driven pela URL.
 */
export function TimelineFilterBar({
  actorId,
  clientId,
  actors,
  clients,
}: {
  actorId: string;
  clientId: string;
  actors: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (actorId !== "todos") next.set("actor", actorId);
    if (clientId !== "todos") next.set("client", clientId);

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

  const hasAnyFilter = actorId !== "todos" || clientId !== "todos";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
          onClick={() => navigate({ actor: "todos", client: "todos" })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
