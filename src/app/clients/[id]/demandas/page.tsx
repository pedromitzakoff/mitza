import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { PendenciasPageClient } from "@/app/demandas/pendencias-page-client";
import { WORKSPACE_CONTENT_MAX_WIDTH_CLASS } from "@/app/clients/workspace-container";

/**
 * `/clients/[id]/demandas` — "Demandas" dentro do workspace do cliente
 * (Etapa "MITZA — Reformulação Estrutural", seção 11 do pedido): MESMA
 * fonte de verdade da área global (`loadPendenciasRawData`, `tasks.origin
 * = 'manual'`), só filtrada também por `client_id` — nunca uma segunda
 * tabela nem uma segunda implementação da regra. Reaproveita 100% da List
 * View global (`PendenciasPageClient`, modo `scopedClientId`): filtros,
 * agrupamento, seleção múltipla, edição inline, drawer, duplicar/excluir
 * em lote — tudo, só escondendo o que vira redundante quando já se está
 * dentro de UM cliente (filtro/coluna de Cliente). Master-detail fica pra
 * Fase 2 (decisão explícita do usuário) — continua usando o drawer.
 */
export default async function ClientDemandasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createSupabaseClient();
  const { data: client } = await supabase.from("clients").select("id, name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!client) notFound();

  const { items, assigneeOptions } = await loadPendenciasRawData(supabase, id);

  return (
    <>
      {/* Etapa "Correção de UX do Workspace": esta rota deixou de ter uma aba
          destacada no header — link explícito de volta pro Painel principal,
          mesmo padrão do Relatório/Operação. Largura própria (`mx-auto`
          dentro de `PendenciasPageClient`) — este link fica FORA dela, no
          mesmo respiro horizontal, com a mesma constante de largura. */}
      <div className={`mx-auto w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} px-6 pt-5 sm:px-8 lg:px-10`}>
        <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
          &larr; {client.name}
        </Link>
      </div>
      <PendenciasPageClient
        items={items}
        clientOptions={[]}
        assigneeOptions={assigneeOptions}
        currentTeamMemberId={profile.id}
        isAdmin={profile.role === "admin"}
        scopedClientId={id}
        hideHeading
      />
    </>
  );
}
