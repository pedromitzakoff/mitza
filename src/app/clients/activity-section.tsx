"use client";

import { useState } from "react";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { effectiveTaskStatus } from "@/lib/task-status";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { buildActivityFeed } from "./activity";
import { TaskRow, type TaskListItem } from "./task-row";
import { ActivityComposer } from "./activity-composer";
import type { InlineTaskManagerOption } from "./inline-task-form";
import { AccountReviewRow, type AccountReviewSummaryItem } from "./account-reviews-section";

/**
 * "ATIVIDADES" (MITZA Unified Activities 1.0) — substitui a antiga divisão
 * "Tarefas" | "Revisões de conta" (duas colunas lado a lado, cada uma com
 * cabeçalho e estado vazio próprios) por uma única fila de trabalho: um
 * cabeçalho, uma lista, um estado vazio. Internamente as duas entidades
 * continuam 100% separadas (schemas, ações, permissões, optimistic UI e
 * histórico intactos) — só a apresentação virou uma lista só, ordenada por
 * `buildActivityFeed` (`./activity.ts`) e renderizada linha a linha pelos
 * componentes oficiais de cada domínio (`TaskRow`/`AccountReviewRow`), cada
 * um com um rótulo discreto de tipo pra desambiguar dentro da fila comum.
 *
 * MITZA Unified Activities 1.0 (correção de modelo de produto): "Atividades"
 * é uma camada de LEITURA e histórico, não uma entidade única de criação —
 * por isso não existe mais um botão "+ Nova tarefa"/"+ Registrar revisão"
 * lado a lado aqui (essa dupla sugeria que as duas eram formas equivalentes
 * de adicionar a mesma coisa, o que nunca foi verdade). Em vez disso:
 * - tarefas nascem pelo `ActivityComposer` logo abaixo do cabeçalho —
 *   criação rápida, só título, sempre visível, nunca um modal;
 * - revisões de conta nascem em "Performance" (`SprintPerformanceSection`,
 *   "+ Registrar revisão"), porque revisão é um registro estruturado ligado
 *   à análise da conta, não um item de trabalho rápido.
 * Ambas continuam aparecendo juntas nesta mesma fila depois de criadas —
 * só o CAMINHO de criação é diferente, nunca a leitura.
 *
 * MITZA Unified Activities — Task Inline Editing: configuração posterior
 * (responsável/data/tipo/notas) acontece na PRÓPRIA linha, nunca num
 * drawer — clicar na linha (ou "Ver detalhes" no "•••") expande a tarefa
 * em vez de navegar. `expandedTaskId` garante uma única linha expandida
 * por vez em toda a fila (nunca duas ao mesmo tempo). O drawer
 * (`TaskDrawerPanel`) continua existindo pra outros fluxos que ainda
 * dependem dele (ex.: "Abrir tarefa" a partir de "Próxima ação"), mas
 * deixou de ser o caminho de configuração dentro desta fila.
 */
export function ActivitySection({
  tasks,
  clientId,
  sprintId,
  taskHrefPrefix,
  managers,
  isAdmin,
  reviews,
  reviewHrefPrefix,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente — ver
   * doc equivalente em `SprintCardBody`. Continua computado (usado por
   * "Próxima ação" em `SprintCardBody`), mas as próprias linhas desta fila
   * não navegam mais pra lá — expandem in-line (ver acima). */
  taskHrefPrefix?: string;
  /** Gestores ativos — usado pelo select de responsável na expansão
   * inline de cada linha de tarefa. */
  managers?: InlineTaskManagerOption[];
  /** Habilita "Excluir tarefa" no menu "•••" de cada linha de tarefa. */
  isAdmin?: boolean;
  /** Revisões de conta desta sprint — opcional: quem ainda não busca
   * `account_reviews` simplesmente não passa (a fila mostra só tarefas). */
  reviews?: AccountReviewSummaryItem[];
  /** PREFIXO de string (não função — este é um Client Component, uma
   * função não atravessa a fronteira servidor→cliente como prop, ver
   * `taskHrefPrefix`/doc em `SprintCardBody`), concatenado com
   * `review.id` pra formar o href completo do drawer de detalhe. */
  reviewHrefPrefix?: string;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const tasksDone = optimisticTasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = optimisticTasks.length > 0 ? (tasksDone / optimisticTasks.length) * 100 : 0;
  const reviewList = reviews ?? [];
  const activities = buildActivityFeed(optimisticTasks, reviewList);
  // Só uma tarefa expandida por vez em toda a fila.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  return (
    <div>
      <SectionHeader
        action={
          /* Etapa Parte 8: só a métrica de tarefas (concluídas/total) — a
             mesma de sempre, nunca fundida com a contagem de revisões
             (métricas semanticamente diferentes). */
          optimisticTasks.length > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {tasksDone}/{optimisticTasks.length} concluída{optimisticTasks.length !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
      >
        Atividades
      </SectionHeader>

      <div className="mt-1.5">
        <ActivityComposer
          clientId={clientId}
          sprintId={sprintId}
          onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
        />
      </div>

      {optimisticTasks.length > 0 && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150"
            style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
          />
        </div>
      )}

      {activities.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {activities.map((item) =>
            item.kind === "task" ? (
              <TaskRow
                key={`task-${item.task.id}`}
                task={item.task}
                clientId={clientId}
                detailsHref={
                  taskHrefPrefix ? `${taskHrefPrefix}${item.task.id}` : `/clients/${clientId}?task=${item.task.id}`
                }
                isAdmin={isAdmin}
                typeLabel="Tarefa"
                onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: item.task.id })}
                onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: item.task.id })}
                managers={managers}
                isExpanded={expandedTaskId === item.task.id}
                onToggleExpand={() =>
                  setExpandedTaskId((current) => (current === item.task.id ? null : item.task.id))
                }
              />
            ) : (
              <AccountReviewRow
                key={`review-${item.review.id}`}
                review={item.review}
                detailHref={`${reviewHrefPrefix}${item.review.id}`}
                typeLabel="Revisão de conta"
              />
            ),
          )}
        </ul>
      ) : (
        <EmptyStateRow className="mt-1.5">Nenhuma atividade nesta sprint.</EmptyStateRow>
      )}
    </div>
  );
}
