"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import { buildWorkspaceHref, resolveCurrentSuffix, resolveReplicableSuffix } from "@/lib/client-workspace-nav";
import { WORKSPACE_CONTENT_MAX_WIDTH_CLASS } from "./workspace-container";
import { AccountInfoDrawerLauncher } from "./account-info-drawer-launcher";

export interface WorkspaceClientOption {
  id: string;
  name: string;
}

const TRIGGER_CLASSES =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Cabeçalho persistente do workspace do cliente — vive no `layout.tsx` de
 * `clients/[id]/**`, então continua montado em toda navegação entre o
 * Painel principal e as rotas de aprofundamento (Relatório/Operação/
 * Demandas/Configurações).
 *
 * Etapa "Correção de UX do Workspace" (corrige a Fase 1, não a desfaz —
 * ver doc-comment de `workspace-container.tsx`): a barra de abas (antes
 * um `nav` com role de lista de abas) foi REMOVIDA daqui — o header
 * voltou a ser só CONTEXTO
 * (identidade do cliente, troca rápida, anterior/próximo, posição,
 * status, Informações da conta), nunca uma segunda navegação principal
 * competindo com a Sidebar. O avatar agora é o link de volta pro Painel
 * (`/clients/[id]`) — a única affordance de "voltar" que precisa viver
 * aqui, já que ela precisa funcionar de QUALQUER rota de aprofundamento.
 *
 * Preserva `month` (único parâmetro verdadeiramente compartilhado entre
 * seções — cada rota mantém seus PRÓPRIOS filtros/período além disso) em
 * toda navegação: anterior/próximo, seletor de cliente.
 *
 * Ao trocar de cliente (seletor OU anterior/próximo), preserva a SEÇÃO
 * atual — decisão 1 do usuário: "Aibou → Performance, ao avançar cai em
 * JudClass → Performance, nunca o Painel". Pra rotas que não são uma das
 * 5 seções reconhecidas (ex.: `/clients/[id]/tasks/new`, legado), cai pro
 * Painel do próximo cliente — replicar uma URL de formulário legado pro
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
  const replicableSuffix = resolveReplicableSuffix(currentSuffix);
  const isOnPanel = currentSuffix === "";

  function hrefFor(targetClientId: string, suffix: string): string {
    return buildWorkspaceHref(targetClientId, suffix, month);
  }

  function handleSwitch(targetClientId: string | null) {
    if (!targetClientId) return;
    router.push(hrefFor(targetClientId, replicableSuffix));
  }

  return (
    <div className="border-b border-overview-border bg-overview-surface">
      <div className={`mx-auto flex w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} flex-wrap items-center gap-2 px-6 py-3 sm:px-8 lg:px-10`}>
        {isOnPanel ? (
          <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="sm" />
        ) : (
          <Link href={`/clients/${client.id}`} aria-label={`Voltar para o painel de ${client.name}`} className="shrink-0 rounded-full">
            <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="sm" />
          </Link>
        )}

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
    </div>
  );
}
