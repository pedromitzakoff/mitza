"use client";

import { useRouter } from "next/navigation";
import { ClientCombobox, type ClientComboboxOption } from "@/app/client-combobox";

/**
 * Encaixa o combobox pesquisável de cliente (compartilhado com a Visão
 * Geral) ao lado do formulário GET de filtros da tela Sprints — monta a URL
 * com o mesmo conjunto de parâmetros que a página já preserva no buildUrl
 * do servidor, só que a partir do client (clique/tecla em vez de submit).
 */
export function SprintsClientFilter({
  clients,
  selectedClientId,
  view,
  manager,
  month,
  health,
  activity,
  sprint,
}: {
  clients: ClientComboboxOption[];
  selectedClientId: string | undefined;
  view: "current" | "monthly";
  manager: string;
  month: string | undefined;
  health: string;
  activity: string;
  sprint: string;
}) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    next.set("view", view);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (view === "monthly" && month) next.set("month", month);
    if (health !== "todos") next.set("health", health);
    if (activity !== "todos") next.set("activity", activity);
    if (sprint !== "todas") next.set("sprint", sprint);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/sprints?${next.toString()}`;
  }

  return (
    <ClientCombobox
      clients={clients}
      selectedClientId={selectedClientId}
      onSelect={(clientId) => router.push(buildUrl({ client: clientId }))}
    />
  );
}
