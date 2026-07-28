import type { TaskListItem } from "./task-row";
import type { AccountReviewSummaryItem } from "./account-reviews-section";
import type { RecurringTaskListItem } from "@/lib/recurring-task-data";
import { orderTasks } from "./task-order";

/**
 * MITZA Unified Activities 1.0 — uma única fila de trabalho da Sprint.
 *
 * Só uma camada de apresentação/agregação: tarefa e revisão de conta
 * continuam entidades de domínio totalmente separadas (schemas, regras de
 * negócio, permissões e ações nunca mudaram nesta etapa). Esta união
 * discriminada existe apenas pra decidir, linha a linha, qual componente
 * oficial renderizar (`TaskRow`, `RecurringTaskRow` ou `AccountReviewRow`)
 * — nunca pra fundir dado ou lógica dos domínios.
 *
 * Reformulação do sistema de tarefas (28/07): `recurring_task` é o terceiro
 * kind — domínio próprio (`recurring_tasks`/`recurring_task_executions`),
 * mas convivendo na MESMA fila, nunca numa seção separada (princípio do
 * usuário: "a recorrência é uma característica da tarefa, não um novo
 * conceito da plataforma").
 */
export type ActivityItem =
  | { kind: "task"; task: TaskListItem }
  | { kind: "recurring_task"; recurringTask: RecurringTaskListItem }
  | { kind: "account_review"; review: AccountReviewSummaryItem };

/**
 * Ordena a fila única: tarefas primeiro, na MESMA ordem cronológica de
 * sempre (`orderTasks` — due_date crescente, nunca reordenada por status;
 * ver doc de `orderTasks`: concluir uma tarefa não pode fazer ela pular de
 * posição, regra que já existia antes desta etapa e continua intacta).
 * Revisões de conta entram depois, na ordem em que já chegam (mais
 * recente primeiro — a mesma ordem que a antiga `AccountReviewsSection`
 * sempre usou).
 *
 * Por que tarefas e revisões não são intercaladas numa única ordenação
 * por data (auditoria da Parte 5): revisão de conta é sempre um REGISTRO
 * do que já aconteceu (nunca "a fazer" — mesmo uma revisão sem nenhuma
 * alteração necessária ainda é um registro, ver `lib/account-reviews.ts`),
 * enquanto `due_date` de tarefa é uma data-alvo que pode estar no passado,
 * hoje ou no futuro. Tratar os dois campos como a mesma dimensão temporal
 * misturaria "quando isto precisa acontecer" com "quando isto já
 * aconteceu" — e faria uma revisão recente concorrer por posição com
 * tarefas pendentes, exatamente o que esta etapa pede pra evitar
 * explicitamente. Por isso: tarefas (pendentes ou já concluídas, na sua
 * ordem estável de sempre) primeiro, revisões (registro histórico) depois.
 */
export function buildActivityFeed(
  tasks: TaskListItem[],
  reviews: AccountReviewSummaryItem[],
  recurringTasks: RecurringTaskListItem[] = [],
): ActivityItem[] {
  return [
    // Recorrências primeiro, sempre na mesma ordem estável (por título) —
    // ao contrário de `orderTasks`, elas não têm due_date pra ordenar por
    // cronologia (são "esta sprint inteira", não um alvo pontual), e
    // representam um compromisso permanente do cliente, não um item que
    // "chegou" nesta sprint — por isso ficam fixas no topo da fila.
    ...recurringTasks.map((recurringTask): ActivityItem => ({ kind: "recurring_task", recurringTask })),
    ...orderTasks(tasks).map((task): ActivityItem => ({ kind: "task", task })),
    ...reviews.map((review): ActivityItem => ({ kind: "account_review", review })),
  ];
}
