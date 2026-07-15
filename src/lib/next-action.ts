import { effectiveTaskStatus } from "./task-status";
import { formatCompactTaskDate } from "./format";
import type { SprintPerformanceView } from "./performance";
import type { PerformanceGoal } from "./performance-goals";

/**
 * Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 10) — "Próxima ação"
 * responde uma pergunta só: "o que eu preciso fazer agora nesta conta?".
 * Função pura, só combina dados JÁ existentes na Sprint (tarefas, view de
 * performance, objetivo, contagem de otimizações) — nenhum cálculo novo,
 * nenhuma tabela nova, nenhuma tarefa criada automaticamente. Auditoria de
 * confiabilidade por critério (ver comentário de cada `if`): um critério só
 * entra na ordem se o dado que ele depende já é sólido o bastante pra virar
 * uma frase objetiva, sem inventar regra nova.
 *
 * Ordem (cada nível só é avaliado se o anterior não bateu):
 *   1. tarefa atrasada mais antiga ainda pendente
 *   2. tarefa pendente com vencimento hoje
 *   3. próxima tarefa pendente por data (futura)
 *   4. atualizar performance, se a sprint atual não tem performance
 *      registrada ainda (`not_started`/`no_data`)
 *   5. configurar objetivo, se ainda não configurado e quem vê tem permissão
 *   6. registrar otimização, se a sprint não tem nenhuma
 *   7. nenhuma ação pendente agora
 */
export type NextActionKind =
  | "overdue_task"
  | "today_task"
  | "next_task"
  | "update_performance"
  | "configure_objective"
  | "register_optimization"
  | "none";

export interface NextAction {
  kind: NextActionKind;
  text: string;
  /** Só presente pros 3 tipos de tarefa — id da tarefa que a ação aponta. */
  taskId?: string;
}

interface NextActionTask {
  id: string;
  title: string;
  due_date: string;
  status: import("@/lib/supabase/database.types").TaskStatus;
}

export function computeNextAction({
  tasks,
  today,
  performanceViewKind,
  performanceGoal,
  optimizationCount,
  canConfigureObjective,
}: {
  tasks: NextActionTask[];
  today: string;
  /** `null` quando a tela nem busca `performance_records` (nenhum critério
   * de performance/objetivo é avaliado nesse caso — dado insuficiente). */
  performanceViewKind: SprintPerformanceView["kind"] | null;
  performanceGoal: PerformanceGoal | null;
  /** `null` quando a tela nem busca otimizações (critério 6 é ignorado). */
  optimizationCount: number | null;
  /** Só entra o critério 5 se quem está vendo pode de fato configurar
   * (mesma permissão de sempre — nunca ampliada aqui). */
  canConfigureObjective: boolean;
}): NextAction {
  const overdue = tasks
    .filter((t) => effectiveTaskStatus(t) === "atrasado")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  if (overdue) {
    return { kind: "overdue_task", text: `Concluir "${overdue.title}" (atrasada)`, taskId: overdue.id };
  }

  const dueToday = tasks.find((t) => effectiveTaskStatus(t) === "pendente" && t.due_date === today);
  if (dueToday) {
    return { kind: "today_task", text: `Concluir "${dueToday.title}" (hoje)`, taskId: dueToday.id };
  }

  const nextFuture = tasks
    .filter((t) => effectiveTaskStatus(t) === "pendente" && t.due_date > today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  if (nextFuture) {
    return {
      kind: "next_task",
      text: `Concluir "${nextFuture.title}" (${formatCompactTaskDate(nextFuture.due_date)})`,
      taskId: nextFuture.id,
    };
  }

  // Critérios 4/5 dependem de `performance_records` ter sido buscado pra
  // esta sprint — quando a tela não busca (`performanceViewKind === null`),
  // não há dado suficiente pra afirmar "sem performance"/"sem objetivo" com
  // segurança, então os dois ficam de fora (nunca inventar a partir de um
  // "null" que só significa "não sei").
  if (performanceViewKind !== null) {
    if (performanceViewKind === "not_started" || performanceViewKind === "no_data") {
      return { kind: "update_performance", text: "Atualizar performance" };
    }

    if (canConfigureObjective && performanceGoal === null) {
      return { kind: "configure_objective", text: "Configurar objetivo" };
    }
  }

  if (optimizationCount === 0) {
    return { kind: "register_optimization", text: "Registrar otimização" };
  }

  return { kind: "none", text: "Nenhuma ação pendente agora." };
}
