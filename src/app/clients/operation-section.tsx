import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "./section";
import { SprintCard } from "./sprint-card";
import { MonthTasksPanel } from "./month-tasks-panel";
import { ClientHistoryList } from "./client-history-list";
import { RecordAccountReviewDrawer } from "./record-account-review-drawer";
import { AccountReviewDetailDrawer } from "./account-review-detail-drawer";
import { RecurringTaskDrawer } from "./recurring-task-drawer";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationSectionData } from "./operation-section-data";

/**
 * Bloco visual da Operação (sprint atual + rotinas + revisões + histórico)
 * — extraído 1:1 de `[id]/operation/page.tsx` (Etapa "Correção de Direção
 * do Workspace") pra ser reaproveitado tanto lá quanto no Painel principal
 * (`[id]/page.tsx`), que volta a mostrar Operação por completo. Recebe
 * tudo já calculado por `loadOperationSectionData` — nunca recalcula nada,
 * nunca decide `origin` (isso já veio resolvido do loader).
 */
export function OperationSection({
  data,
  clientId,
  clientName,
  primaryManagerName,
  monthLabel,
  isAdmin,
  canOperate,
  returnTo,
  taskHrefPrefix,
  openReview,
  reviewError,
}: {
  data: OperationSectionData;
  clientId: string;
  clientName: string;
  primaryManagerName: string | null;
  monthLabel: string;
  isAdmin: boolean;
  canOperate: boolean;
  returnTo: string;
  taskHrefPrefix: string;
  openReview?: string;
  reviewError?: string;
}) {
  const {
    managers,
    sortedSprints,
    sprintPerformanceBySprintId,
    targetCostPerResult,
    bySprintId,
    manualSpendUpdatedAtBySprintId,
    monthTaskRows,
    recurringTasksForCurrentSprint,
    currentSprintForRecurring,
    recurringTaskDetail,
    recurringTaskReportHref,
    reviewDetail,
    buildReviewDetailHref,
    historyRows,
    hasMoreHistory,
    historyPage,
    buildHistoryPageHref,
    openTask,
    openTaskSprintPeriodLabel,
    taskCommentsById,
  } = data;

  return (
    <>
      <div className="mt-6">
        <MonthTasksPanel
          key={monthLabel}
          monthLabel={monthLabel}
          tasks={monthTaskRows}
          clientId={clientId}
          managers={managers}
          isAdmin={isAdmin}
          canOperate={canOperate}
          recurringTasks={recurringTasksForCurrentSprint}
          recurringTaskHrefPrefix={
            currentSprintForRecurring
              ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}recurringTaskSprint=${currentSprintForRecurring.sprintId}&recurringTaskDetail=`
              : undefined
          }
          taskHrefPrefix={taskHrefPrefix}
        />
      </div>

      <Section title={`Sprints de ${monthLabel}`}>
        <div className="flex flex-col gap-2">
          {sortedSprints.length > 0 ? (
            sortedSprints.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={[]}
                clientId={clientId}
                isAdmin={isAdmin}
                canEditPerformance={isAdmin}
                tasks={bySprintId.get(sprint.sprintId) ?? []}
                manualSpendUpdatedAt={manualSpendUpdatedAtBySprintId.get(sprint.sprintId) ?? null}
                metaSyncedAt={null}
                taskManagers={managers}
                defaultAssigneeName={primaryManagerName}
                performance={sprintPerformanceBySprintId.get(sprint.sprintId)}
                targetCostPerResult={targetCostPerResult}
                returnTo={returnTo}
                hideNextAction
                hideTaskList
                canOperate={canOperate}
              />
            ))
          ) : (
            <EmptyState>Nenhuma sprint encontrada para este período — verifique se as sprints do mês já foram geradas.</EmptyState>
          )}
        </div>
      </Section>

      <Section title={`Histórico de ${monthLabel}`}>
        <ClientHistoryList rows={historyRows} buildReviewDetailHref={buildReviewDetailHref} emptyLabel={`Nenhum evento registrado em ${monthLabel}.`} />
        {(historyPage > 0 || hasMoreHistory) && (
          <div className="mt-3 flex items-center justify-between border-t border-overview-border pt-2 text-xs">
            {historyPage > 0 ? (
              <Link href={buildHistoryPageHref(historyPage - 1)} scroll={false} className="font-medium text-brand hover:underline">
                &larr; Mais recentes
              </Link>
            ) : (
              <span />
            )}
            {hasMoreHistory && (
              <Link href={buildHistoryPageHref(historyPage + 1)} scroll={false} className="font-medium text-brand hover:underline">
                Mais antigos &rarr;
              </Link>
            )}
          </div>
        )}
      </Section>

      {openTask && (
        <TaskDrawerPanel
          task={openTask}
          clientId={clientId}
          clientName={clientName}
          sprintPeriodLabel={openTaskSprintPeriodLabel}
          comments={(taskCommentsById.get(openTask.id) ?? []) as never}
          closeHref={returnTo}
          returnTo={returnTo}
          isAdmin={isAdmin}
          managers={managers}
          canOperate={canOperate}
        />
      )}

      {openReview === "new" && <RecordAccountReviewDrawer clientId={clientId} closeHref={returnTo} managers={managers} error={reviewError} />}

      {reviewDetail && <AccountReviewDetailDrawer review={reviewDetail} clientId={clientId} closeHref={returnTo} />}

      {recurringTaskDetail && (
        <RecurringTaskDrawer detail={recurringTaskDetail} clientId={clientId} closeHref={returnTo} reportHref={recurringTaskReportHref} />
      )}
    </>
  );
}
