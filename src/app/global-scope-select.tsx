"use client";

import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildModuleContextHref, type ModuleKey } from "@/lib/client-workspace-nav";

/**
 * Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como Contexto
 * Global" (seção 6/10 do pedido) — contraparte do novo `allLabel="Todos
 * os clientes"` de `ClientWorkspaceHeader`: enquanto aquele cobre a saída
 * "cliente -> Todos", este cobre a entrada "Todos -> cliente" nas 4 rotas
 * globais que têm módulo (`/`, `/operation`, `/demandas`, `/timeline`).
 * Deliberadamente SEM `allLabel` — estar numa rota global já É "Todos"
 * (nada pra "limpar"), então a seleção nunca tem estado selecionado
 * (`selectedId={null}` sempre) e só serve de atalho de navegação pra
 * dentro do MESMO módulo de um cliente específico, via o núcleo único
 * `buildModuleContextHref` (nenhuma lógica de URL própria).
 *
 * Nunca confundir com um filtro local (ex.: "Cliente" dentro de
 * `AgencyFilters`/`TimelineFilterBar`/`PendenciasPageClient`, que recorta
 * os DADOS da própria tela sem sair dela) — este componente SEMPRE
 * navega pra outra rota; por isso o rótulo explícito "Ir para um
 * cliente...", nunca "Cliente" sozinho, pra não parecer mais um filtro.
 */
export function GlobalScopeSelect({
  module,
  clientOptions,
}: {
  module: ModuleKey;
  clientOptions: { id: string; name: string }[];
}) {
  const router = useRouter();

  function handleSelect(id: string | null) {
    if (!id) return;
    router.push(buildModuleContextHref(module, { type: "client", id }, null));
  }

  return (
    <div className="w-56 shrink-0">
      <SearchableSelect
        options={clientOptions.map((c) => ({ id: c.id, label: c.name }))}
        selectedId={null}
        onSelect={handleSelect}
        placeholder="Todos os clientes"
        searchPlaceholder="Ir para um cliente..."
        ariaLabel="Trocar para um cliente específico"
      />
    </div>
  );
}
