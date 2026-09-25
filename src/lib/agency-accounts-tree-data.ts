import { cache } from "react";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { buildAgencyAccountsTree, type AgencyTree } from "./agency-accounts-tree";

/**
 * Busca + construção da árvore "Contas da Agência", extraída de
 * `agency-accounts-tree.tsx` (Sidebar) pra ser reaproveitada também pelo
 * layout do workspace do cliente (Etapa "MITZA — Reformulação Estrutural" —
 * seletor rápido/anterior-próximo). Envolvida em `cache()` do React (mesmo
 * padrão de `getCurrentProfile`, `lib/auth.ts`) — Sidebar e layout do
 * cliente pedem a MESMA árvore na MESMA requisição (toda navegação renderiza
 * os dois), então sem `cache()` seriam 2 idas ao Supabase pelas mesmas 2
 * queries; com `cache()`, uma só, reaproveitada pela segunda chamada.
 */
export const loadAgencyAccountsTree = cache(async (): Promise<AgencyTree> => {
  const supabase = await createSupabaseClient();
  const [clients, managers] = await Promise.all([
    // Princípio "Workspace = só cliente ativo", sem exceção — mesmo
    // critério de sempre (ver `agency-accounts-tree.tsx`).
    requireQuery(
      supabase
        .from("clients")
        .select("id, name, wallet_position, avatar_url, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)")
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("wallet_position", { ascending: true, nullsFirst: false })
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
  ]);

  return buildAgencyAccountsTree(clients, managers);
});
