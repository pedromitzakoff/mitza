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
 */
export interface AgencyTreeClient {
  id: string;
  name: string;
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

export function buildAgencyAccountsTree(
  clients: { id: string; name: string; primary_manager: { id: string; name: string } | null }[],
  managers: { id: string; name: string }[],
): AgencyTree {
  const byManagerId = new Map<string, AgencyTreeClient[]>();
  const unassigned: AgencyTreeClient[] = [];

  for (const client of clients) {
    const entry = { id: client.id, name: client.name };
    if (!client.primary_manager) {
      unassigned.push(entry);
      continue;
    }
    const list = byManagerId.get(client.primary_manager.id) ?? [];
    list.push(entry);
    byManagerId.set(client.primary_manager.id, list);
  }

  const treeManagers: AgencyTreeManager[] = managers.map((manager) => ({
    id: manager.id,
    name: manager.name,
    clients: byManagerId.get(manager.id) ?? [],
  }));

  return { managers: treeManagers, unassigned };
}
