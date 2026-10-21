import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { loadAgencyAccountsTree } from "@/lib/agency-accounts-tree-data";
import { flattenAgencyTree, resolveHomeRedirectHref } from "@/lib/agency-accounts-tree";

/**
 * "/" é só um RESOLVER server-side: entra na carteira pela MESMA sequência
 * oficial já usada por anterior/próximo e pelo seletor do header
 * (`loadAgencyAccountsTree` + `flattenAgencyTree`, `lib/agency-accounts-tree*`
 * — nunca uma segunda ordenação) e redireciona pro Dashboard do primeiro
 * cliente dessa sequência (`resolveHomeRedirectHref`, núcleo puro testável
 * sem Supabase/redirect). Carteira vazia (nenhum cliente ativo) cai no único
 * fallback seguro, `/clients` (Gestão) — que nunca redireciona de volta pra
 * "/", então não há risco de loop.
 *
 * KOFF Analytics — Etapa 1.8: o antigo dashboard consolidado da agência
 * (`LegacyGlobalDashboard`, aposentado desde a Etapa "Correção do fluxo
 * final do Dashboard" e nunca mais alcançado por nenhuma rota) foi removido
 * por completo deste arquivo — código 100% morto, e a maior parte do que
 * restava dele era exatamente a camada operacional (Operação, Sprints,
 * tarefas, account_reviews) que esta etapa elimina do produto.
 */
export default async function Home() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const tree = await loadAgencyAccountsTree();
  redirect(resolveHomeRedirectHref(flattenAgencyTree(tree)));
}
