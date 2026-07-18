import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { buildAgencyAccountsTree } from "@/lib/agency-accounts-tree";
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
  const [{ data: clients }, { data: managers }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)")
      .is("deleted_at", null)
      .order("name"),
    supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
  ]);

  const tree = buildAgencyAccountsTree(clients ?? [], managers ?? []);

  return <AgencyAccountsTreeView tree={tree} currentManagerId={profile.id} />;
}
