import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { PendenciasPageClient } from "@/app/demandas/pendencias-page-client";

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
  const { data: client } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!client) notFound();

  const { items, assigneeOptions } = await loadPendenciasRawData(supabase, id);

  return (
    <PendenciasPageClient
      items={items}
      clientOptions={[]}
      assigneeOptions={assigneeOptions}
      currentTeamMemberId={profile.id}
      isAdmin={profile.role === "admin"}
      scopedClientId={id}
      hideHeading
    />
  );
}
