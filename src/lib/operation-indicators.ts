import type { OperationClientCard } from "@/app/operation/operation-data";
import type { ClientContractStatus, TeamMemberStatus, TeamSystemRole } from "@/lib/supabase/database.types";

/**
 * Indicadores objetivos da operação (substituem "Saúde da operação" —
 * classificação qualitativa saudável/atenção/crítico removida da Visão
 * Geral, seção 1 do pedido). Nenhum indicador aqui usa accountHealth,
 * activityStatus ou qualquer severidade — só contagens/percentuais diretos.
 *
 * `cards` já deve vir filtrado por carteira/cliente (não pelos filtros de
 * recorte — saúde/ritmo/tarefas/sincronização/meta — que continuam existindo
 * só para a tabela de clientes e "Resumo por Gestor"). Os indicadores
 * respeitam exatamente os 3 filtros citados no pedido: mês, carteira,
 * cliente.
 */
export interface OperationIndicators {
  activeClientsCount: number;
  activeManagersCount: number;
  /** "Gestores ativos" na visão geral/carteira; "Gestores vinculados" quando
   * um cliente específico está selecionado (mesmo número, rótulo diferente). */
  managersLabel: string;
  completedTasksCount: number;
  /** Total de tarefas previstas no período (denominador de `completionRatePct`,
   * já calculado internamente antes desta etapa) — exposto à parte só pra a
   * Visão Geral poder exibir "2 de X concluídas" sem recalcular nada no
   * componente visual (Etapa 69: nenhuma lógica financeira/operacional deve
   * viver em componente de apresentação). */
  tasksTotalCount: number;
  /** null quando não há tarefas previstas no período — nunca 0%. */
  completionRatePct: number | null;
  /** Otimizações realizadas (Etapa 74; rótulo "Otimizações no mês" desde a
   * Etapa "Indicadores operacionais e refinamento visual") — total de
   * revisões estratégicas da conta (account_reviews) registradas no
   * período, independente do resultado (alteração realizada, sem alteração
   * necessária, ou problema identificado). Um único número — nunca
   * separado por resultado, pra não dar a impressão de dois eventos onde só
   * houve um; cada registro de account_reviews conta exatamente uma vez. */
  optimizationsCount: number;
}

export interface ComputeOperationIndicatorsInput {
  /** Cards já filtrados por carteira e cliente (não pelos filtros de recorte). */
  cards: OperationClientCard[];
  /** Status contratual atual de cada cliente — não há histórico desse campo
   * no banco, então o indicador usa sempre o valor atual, independente do
   * mês selecionado (não há como inventar um histórico que não existe). */
  clientStatusById: Map<string, ClientContractStatus>;
  teamMembers: { id: string; systemRole: TeamSystemRole; status: TeamMemberStatus }[];
  /** client_id de cada tarefa concluída (completed_at) dentro do mês
   * selecionado — já filtrado por data pelo chamador. */
  completedTaskClientIds: string[];
  /** client_id de cada Otimização (account_reviews.reviewed_at — a revisão
   * estratégica da conta em si, qualquer que tenha sido o resultado) dentro
   * do mês selecionado — já filtrado por data pelo chamador. */
  reviewClientIds: string[];
  /** Há um cliente específico selecionado no filtro? Só muda o rótulo do
   * indicador de gestores, nunca o número. */
  hasClientFilter: boolean;
}

export function computeOperationIndicators(input: ComputeOperationIndicatorsInput): OperationIndicators {
  const { cards, clientStatusById, teamMembers, completedTaskClientIds, reviewClientIds, hasClientFilter } = input;

  const clientIdsInScope = new Set(cards.map((c) => c.clientId));

  const activeClientsCount = cards.filter((c) => clientStatusById.get(c.clientId) === "ativo").length;

  // Nunca conta admin como gestor (seção 2) — só team_members com
  // system_role "gestor" e status "ativo" entram no conjunto elegível.
  const activeGestorIds = new Set(
    teamMembers.filter((m) => m.systemRole === "gestor" && m.status === "ativo").map((m) => m.id),
  );

  // Mesma definição em qualquer contexto (visão global, carteira ou
  // cliente): gestores ativos distintos vinculados a pelo menos um cliente
  // do recorte atual (client_managers, a mesma base já usada pelo filtro de
  // carteira) — nunca conta duas vezes o mesmo gestor em clientes diferentes.
  const managerIdsInScope = new Set<string>();
  for (const card of cards) {
    for (const managerId of card.managerIds) {
      if (activeGestorIds.has(managerId)) managerIdsInScope.add(managerId);
    }
  }

  const completedTasksCount = completedTaskClientIds.filter((id) => clientIdsInScope.has(id)).length;

  // Denominador ("tarefas previstas no período") reaproveita a mesma regra
  // temporal já existente (due_date dentro do mês, ver
  // buildOperationClientCard/taskCounts) — nenhum cálculo novo aqui, só a
  // soma dos cards já filtrados. Numerador: dessas mesmas tarefas previstas,
  // quantas têm status efetivo "feito" (taskCounts.done).
  const taskCountsTotal = cards.reduce((sum, c) => sum + c.taskCounts.total, 0);
  const taskCountsDone = cards.reduce((sum, c) => sum + c.taskCounts.done, 0);
  const completionRatePct = taskCountsTotal > 0 ? (taskCountsDone / taskCountsTotal) * 100 : null;

  const optimizationsCount = reviewClientIds.filter((id) => clientIdsInScope.has(id)).length;

  return {
    activeClientsCount,
    activeManagersCount: managerIdsInScope.size,
    managersLabel: hasClientFilter ? "Gestores vinculados" : "Gestores ativos",
    completedTasksCount,
    tasksTotalCount: taskCountsTotal,
    completionRatePct,
    optimizationsCount,
  };
}
