import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadAgencyAccountsTree } from "@/lib/agency-accounts-tree-data";
import { flattenAgencyTree, resolveWalletSequence } from "@/lib/agency-accounts-tree";
import { ClientWorkspaceHeader } from "../client-workspace-header";

/**
 * Layout compartilhado do workspace do cliente (Etapa "MITZA —
 * Reformulação Estrutural") — envolve TODAS as sub-rotas de
 * `clients/[id]/**` (Visão geral, `/relatorio`, `/operation`, `/demandas`,
 * `/edit`, e as legadas `/tasks/new`/`/tasks/[taskId]/edit`) com o
 * cabeçalho persistente (nome do cliente + seletor rápido + anterior/
 * próximo + abas). Busca só o MÍNIMO pro cabeçalho (id/nome/avatar/status)
 * — os dados pesados de cada aba continuam 100% na própria página, nunca
 * centralizados aqui (Princípio "trocar contexto deve carregar só o
 * necessário", seção 22 do pedido).
 *
 * A árvore "Contas da Agência" (`loadAgencyAccountsTree`, `cache()` por
 * requisição) já é buscada pela Sidebar nesta MESMA navegação — aqui é
 * reaproveitada, não uma segunda consulta.
 */
export default async function ClientWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const [{ data: client, error }, tree] = await Promise.all([
    supabase.from("clients").select("id, name, avatar_url, status").eq("id", id).is("deleted_at", null).maybeSingle(),
    loadAgencyAccountsTree(),
  ]);

  if (error) console.error(`[ClientWorkspaceLayout] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  // `null` pra cliente pausado/encerrado (a árvore só lista workspace-ativo)
  // — anterior/próximo/posição somem nesse caso, mas o workspace continua
  // acessível pra consulta (mesmo princípio de sempre: pausado/encerrado é
  // modo leitura, nunca 404).
  const sequence = resolveWalletSequence(tree, id);
  const clientOptions = flattenAgencyTree(tree).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex min-h-full flex-col">
      <ClientWorkspaceHeader
        client={{ id: client.id, name: client.name, avatarUrl: client.avatar_url, status: client.status }}
        prevId={sequence?.prevId ?? null}
        nextId={sequence?.nextId ?? null}
        position={sequence?.position ?? null}
        total={sequence?.total ?? null}
        clientOptions={clientOptions}
      />
      {children}
    </div>
  );
}
