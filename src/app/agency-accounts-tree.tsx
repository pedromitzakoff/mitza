import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { buildAgencyAccountsTree } from "@/lib/agency-accounts-tree";
import { requireQuery } from "@/lib/require-query";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { AgencyAccountsTreeView } from "./agency-accounts-tree-client";

/**
 * "Contas da Agência" — Server Component autocontido: busca seus próprios
 * dados (mesmas 2 queries já usadas em `clients/page.tsx`/`sprints/page.tsx`,
 * sem tocar schema nem criar relacionamento novo) em vez de depender do
 * layout raiz pra isso. `layout.tsx` só precisa renderizar `<AgencyAccountsTree />`
 * — zero acoplamento de dado com o shell da aplicação; se esta seção mudar
 * de fonte de dado no futuro, só este arquivo muda.
 *
 * `getCurrentProfile()` já é `cache()` por request (ver `lib/auth.ts`) — o
 * layout raiz também a chama pra montar `profile`; chamar de novo aqui não
 * gera uma segunda ida ao Supabase, só reaproveita o resultado memoizado da
 * mesma requisição.
 */
export async function AgencyAccountsTree() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createSupabaseClient();
  const [clients, managers] = await Promise.all([
    // Princípio "Workspace = só cliente ativo", sem exceção: esta árvore
    // também é usada pra realocar cliente entre gestores (drag and drop,
    // ver agency-accounts-tree-actions.ts), mas continua fazendo parte da
    // Sidebar/Workspace — cliente pausado/encerrado não aparece aqui.
    // Realocar um cliente pausado/encerrado fica, por ora, só possível via
    // Configurações > Clientes.
    requireQuery(
      supabase
        .from("clients")
        .select(
          "id, name, wallet_position, avatar_url, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
        )
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("wallet_position", { ascending: true, nullsFirst: false })
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
  ]);

  const tree = buildAgencyAccountsTree(clients, managers);

  return <AgencyAccountsTreeView tree={tree} />;
}
