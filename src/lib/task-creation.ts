/**
 * `tasks.original_due_date` é NOT NULL sem default (ver
 * `supabase/operational-events.sql`) e representa a data inicial combinada
 * da tarefa — nunca reescrita depois (reagendamentos só mudam `due_date`,
 * ver `updateTaskAction` em `src/app/clients/tasks-actions.ts`).
 *
 * Esta função é o único lugar que decide o valor de `original_due_date` na
 * CRIAÇÃO de uma tarefa: sempre igual ao `due_date` daquela mesma inserção.
 * Todo insert em `tasks` no código da aplicação passa por aqui, pra nunca
 * mais um insert esquecer a coluna (o que já aconteceu 3 vezes de forma
 * independente antes desta correção).
 */
export function withOriginalDueDate<T extends { due_date: string }>(
  fields: T,
): T & { original_due_date: string } {
  return { ...fields, original_due_date: fields.due_date };
}
