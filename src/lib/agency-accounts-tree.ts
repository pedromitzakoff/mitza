/**
 * Árvore de navegação "Contas da Agência" (Sidebar) — agrupa clientes pelo
 * gestor responsável (`clients.primary_manager_id`, fonte única do gestor
 * atribuído — mesma fonte já usada em `clients/page.tsx`/`sprints/page.tsx`,
 * nunca `client_managers`, que é só lista de autorização de escrita).
 *
 * Função pura, sem Supabase e sem React — quem busca os dados
 * (`agency-accounts-tree.tsx`, Server Component) só chama isto depois de já
 * ter os dois selects em mãos. Gestores sem nenhum cliente ainda aparecem
 * na árvore (pasta vazia) — "visualizar a estrutura completa da operação"
 * inclui saber que aquele gestor existe, mesmo sem conta hoje. Clientes com
 * `primary_manager_id` nulo caem no bucket `unassigned`, renderizado como
 * "Sem responsável" pelo componente cliente.
 *
 * `AgencyTreeClient` é deliberadamente mínimo (`id`/`name`) — a árvore hoje
 * é só navegação. O tipo já está isolado aqui, num módulo só seu, pra que
 * adicionar campos futuros (status, pendências, revisão) no dia em que
 * fizerem sentido seja só estender esta interface, não redesenhar nada.
 *
 * Etapa "Árvore Viva 1.0": a ordem dentro de cada pasta passa a respeitar
 * `wallet_position` (organização manual da carteira do gestor, arrastada e
 * solta na árvore) em vez de ordem alfabética. Nome só entra como
 * desempate para clientes ainda sem posição definida (nunca deveria
 * acontecer depois do backfill, mas uma ordem determinística é mais barata
 * que deixar o resultado do `Promise.all` decidir). O estado otimista do
 * drag and drop entre pastas/dentro da pasta agora vive inteiramente no
 * componente cliente (via `@dnd-kit`), não mais nesta função pura.
 */
export interface AgencyTreeClient {
  id: string;
  name: string;
  /** MITZA 2.0 — Refinamento da Identidade do Cliente: reforça
   * reconhecimento visual também na árvore, mesmo componente
   * `ClientAvatar` já usado na Operação. */
  avatarUrl: string | null;
}

export interface AgencyTreeManager {
  id: string;
  name: string;
  clients: AgencyTreeClient[];
}

export interface AgencyTree {
  managers: AgencyTreeManager[];
  unassigned: AgencyTreeClient[];
}

interface RawAgencyTreeClient {
  id: string;
  name: string;
  wallet_position: number | null;
  avatar_url: string | null;
  primary_manager: { id: string; name: string } | null;
}

function sortByWalletPosition(clients: RawAgencyTreeClient[]): AgencyTreeClient[] {
  return [...clients]
    .sort((a, b) => {
      if (a.wallet_position !== null && b.wallet_position !== null) return a.wallet_position - b.wallet_position;
      if (a.wallet_position !== null) return -1;
      if (b.wallet_position !== null) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((client) => ({ id: client.id, name: client.name, avatarUrl: client.avatar_url }));
}

export function buildAgencyAccountsTree(
  clients: RawAgencyTreeClient[],
  managers: { id: string; name: string }[],
): AgencyTree {
  const byManagerId = new Map<string, RawAgencyTreeClient[]>();
  const unassignedRaw: RawAgencyTreeClient[] = [];

  for (const client of clients) {
    if (!client.primary_manager) {
      unassignedRaw.push(client);
      continue;
    }
    const list = byManagerId.get(client.primary_manager.id) ?? [];
    list.push(client);
    byManagerId.set(client.primary_manager.id, list);
  }

  const treeManagers: AgencyTreeManager[] = managers.map((manager) => ({
    id: manager.id,
    name: manager.name,
    clients: sortByWalletPosition(byManagerId.get(manager.id) ?? []),
  }));

  return { managers: treeManagers, unassigned: sortByWalletPosition(unassignedRaw) };
}
