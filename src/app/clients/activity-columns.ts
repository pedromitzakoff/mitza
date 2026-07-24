/**
 * Grade de colunas da fila "Atividades" (Sprint) — Etapa "Padronizar e
 * destacar criação de Atividades". Cabeçalho (`ActivitySection`), a linha
 * de criação (`ActivityComposer`) e as duas linhas de leitura (`TaskRow`,
 * `AccountReviewRow`) usam EXATAMENTE estas larguras — nenhuma delas
 * define a própria largura de coluna solta no meio do JSX, justamente
 * pra nenhuma coluna "flutuar" (ficar desalinhada) entre um tipo de linha
 * e outro, ou entre o cabeçalho e as linhas.
 */
export const ACTIVITY_COL_STATUS = "flex w-8 shrink-0 items-center justify-center sm:w-14";
export const ACTIVITY_COL_DATE = "w-24 shrink-0 text-xs tabular-nums";
export const ACTIVITY_COL_ASSIGNEE = "hidden w-32 shrink-0 items-center gap-1.5 md:flex";
export const ACTIVITY_COL_TYPE = "hidden w-24 shrink-0 lg:block";
export const ACTIVITY_COL_ACTIONS = "flex w-6 shrink-0 justify-end";

/**
 * Coluna "sprint (referência)" — Etapa "Tarefas e Sprints separadas":
 * usada só pelo novo módulo "Tarefas de {mês}" (`month-tasks-panel.tsx`),
 * onde uma única lista mistura tarefas de várias sprints + soltas — nenhum
 * outro consumidor de `TaskRow` (Atividades da Sprint, Outras tarefas) usa
 * esta coluna, porque neles a sprint já é implícita pelo próprio contexto.
 */
export const ACTIVITY_COL_SPRINT = "hidden w-20 shrink-0 md:block";
