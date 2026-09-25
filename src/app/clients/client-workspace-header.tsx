"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import { WORKSPACE_TABS, buildWorkspaceHref, resolveActiveTab, resolveCurrentSuffix, resolveReplicableSuffix } from "@/lib/client-workspace-nav";
import { AccountInfoDrawerLauncher } from "./account-info-drawer-launcher";

export interface WorkspaceClientOption {
  id: string;
  name: string;
}

const TRIGGER_CLASSES =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Cabeçalho persistente do workspace do cliente (Etapa "MITZA —
 * Reformulação Estrutural", seções 4-7 do pedido) — vive no
 * `layout.tsx` de `clients/[id]/**`, então continua montado ao trocar
 * entre Visão geral/Performance/Operação/Demandas/Configurações (rotas
 * IRMÃS de verdade agora, nunca mais `?area=` numa página só).
 *
 * Preserva `month` (único parâmetro verdadeiramente compartilhado entre
 * abas — cada aba mantém seus PRÓPRIOS filtros/período além disso, nunca
 * forçados a persistir entre abas conceitualmente diferentes) em toda
 * navegação: troca de aba, anterior/próximo, seletor de cliente.
 *
 * Ao trocar de cliente (seletor OU anterior/próximo), preserva a ABA
 * atual — decisão 1 do usuário: "Aibou → Performance, ao avançar cai em
 * JudClass → Performance, nunca Visão geral". Pra rotas que não são uma
 * das 5 abas (ex.: `/clients/[id]/tasks/new`, legado), cai pra Visão
 * geral do próximo cliente — replicar uma URL de formulário legado pro
 * cliente seguinte não faz sentido.
 */
export function ClientWorkspaceHeader({
  client,
  prevId,
  nextId,
  position,
  total,
  clientOptions,
}: {
  client: { id: string; name: string; avatarUrl: string | null; status: ClientContractStatus };
  prevId: string | null;
  nextId: string | null;
  position: number | null;
  total: number | null;
  clientOptions: WorkspaceClientOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const month = searchParams.get("month");

  const currentSuffix = resolveCurrentSuffix(pathname, client.id);
  const activeTab = resolveActiveTab(pathname, client.id);
  const replicableSuffix = resolveReplicableSuffix(currentSuffix);

  function hrefFor(targetClientId: string, suffix: string): string {
    return buildWorkspaceHref(targetClientId, suffix, month);
  }

  function handleSwitch(targetClientId: string | null) {
    if (!targetClientId) return;
    router.push(hrefFor(targetClientId, replicableSuffix));
  }

  return (
    <div className="border-b border-overview-border bg-overview-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-6 py-3">
        <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="sm" />

        <Link
          href={prevId ? hrefFor(prevId, replicableSuffix) : "#"}
          aria-label="Cliente anterior"
          aria-disabled={!prevId}
          className={`${TRIGGER_CLASSES} ${!prevId ? "pointer-events-none opacity-30" : ""}`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>

        <div className="w-48">
          <SearchableSelect
            options={clientOptions.map((c) => ({ id: c.id, label: c.name }))}
            selectedId={client.id}
            onSelect={handleSwitch}
            placeholder={client.name}
            searchPlaceholder="Buscar cliente..."
            ariaLabel="Trocar de cliente"
          />
        </div>

        <Link
          href={nextId ? hrefFor(nextId, replicableSuffix) : "#"}
          aria-label="Próximo cliente"
          aria-disabled={!nextId}
          className={`${TRIGGER_CLASSES} ${!nextId ? "pointer-events-none opacity-30" : ""}`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>

        {position !== null && total !== null && (
          <span className="shrink-0 text-xs tabular-nums text-overview-text-muted">
            {position} / {total}
          </span>
        )}

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}>
          {CLIENT_STATUS_LABEL[client.status]}
        </span>

        <div className="ml-auto shrink-0">
          <AccountInfoDrawerLauncher
            clientId={client.id}
            triggerClassName="text-xs font-medium text-overview-text-secondary hover:text-overview-text-primary hover:underline"
          />
        </div>
      </div>

      <nav className="mx-auto flex max-w-5xl gap-4 overflow-x-auto px-6" role="tablist" aria-label="Áreas do cliente">
        {WORKSPACE_TABS.map((tab) => {
          const isActive = activeTab?.key === tab.key;
          return (
            <Link
              key={tab.key}
              href={hrefFor(client.id, tab.suffix)}
              role="tab"
              aria-selected={isActive}
              className={`-mb-px shrink-0 border-b-2 pb-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                isActive ? "border-brand text-brand" : "border-transparent text-overview-text-secondary hover:text-overview-text-primary"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
