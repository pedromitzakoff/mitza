import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { ClientWorkspaceHeader } from "../client-workspace-header";
import { ActiveClientSidebarName } from "../client-workspace-context";

// `maxDuration` de um route segment vale pras Server Actions disparadas de
// dentro dele (ver Next.js docs) — o header persistente deste layout é quem
// renderiza `AccountInfoDrawerLauncher`, cujo botão "Sincronizar agora" pode
// chamar `syncClientMetaApiSourcesAction` (busca direta na Meta). Sem isso,
// essa Server Action roda no limite padrão (bem mais curto) da Vercel, que
// corta a chamada à Graph API no meio pra uma conta grande — o botão fica
// preso em "Sincronizando..." pra sempre em vez de terminar ou errar.
export const maxDuration = 300;

/**
 * Layout compartilhado do workspace do cliente — envolve TODAS as
 * sub-rotas de `clients/[id]/**` (cockpit, `/metas`, `/relatorio`,
 * `/dados`, `/operation`, `/demandas`, `/timeline`, `/edit`, e as legadas
 * `/tasks/new`/`/tasks/[taskId]/edit`) com o cabeçalho persistente.
 *
 * MITZA ONE — Fase 2 (Sidebar = Carteira, Header Simplificado): este
 * layout deixou de buscar a árvore "Contas da Agência"
 * (`loadAgencyAccountsTree`/`resolveWalletSequence`/`flattenAgencyTree`)
 * — essa busca só existia aqui pra alimentar o seletor rápido/anterior-
 * próximo/posição do header antigo, todos removidos nesta fase (a Sidebar,
 * no layout RAIZ, agora é quem busca e exibe a carteira). Busca só o
 * MÍNIMO pro cabeçalho atual (id/nome/avatar/status) — os dados pesados
 * de cada rota continuam 100% na própria página.
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

  const { data: client, error } = await supabase.from("clients").select("id, name, avatar_url, status").eq("id", id).is("deleted_at", null).maybeSingle();

  if (error) console.error(`[ClientWorkspaceLayout] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  return (
    <div className="flex min-h-full flex-col">
      <ActiveClientSidebarName name={client.name} />
      <ClientWorkspaceHeader client={{ id: client.id, name: client.name, avatarUrl: client.avatar_url, status: client.status }} />
      {children}
    </div>
  );
}
