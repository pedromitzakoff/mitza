import { getCurrentProfile } from "@/lib/auth";
import { loadAgencyAccountsTree } from "@/lib/agency-accounts-tree-data";
import { AgencyAccountsTreeView } from "./agency-accounts-tree-client";

/**
 * "Contas da Agência" — Server Component: busca da árvore extraída pra
 * `lib/agency-accounts-tree-data.ts` (`loadAgencyAccountsTree`, envolvida em
 * `cache()`) na Etapa "MITZA — Reformulação Estrutural" — o layout do
 * workspace do cliente (seletor rápido/anterior-próximo) passou a precisar
 * da MESMA árvore na MESMA requisição; sem o `cache()` compartilhado seriam
 * 2 idas ao Supabase pelas mesmas 2 queries. `layout.tsx` só precisa
 * renderizar `<AgencyAccountsTree />` — zero acoplamento de dado com o
 * shell da aplicação.
 *
 * `getCurrentProfile()` já é `cache()` por request (ver `lib/auth.ts`) — o
 * layout raiz também a chama pra montar `profile`; chamar de novo aqui não
 * gera uma segunda ida ao Supabase, só reaproveita o resultado memoizado da
 * mesma requisição.
 */
export async function AgencyAccountsTree() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Princípio "Workspace = só cliente ativo", sem exceção: esta árvore
  // também é usada pra realocar cliente entre gestores (drag and drop, ver
  // agency-accounts-tree-actions.ts), mas continua fazendo parte da
  // Sidebar/Workspace — cliente pausado/encerrado não aparece aqui. Realocar
  // um cliente pausado/encerrado fica, por ora, só possível via
  // Configurações > Clientes.
  const tree = await loadAgencyAccountsTree();

  return <AgencyAccountsTreeView tree={tree} isAdmin={profile.role === "admin"} />;
}
