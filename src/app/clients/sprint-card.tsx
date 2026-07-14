import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { SprintFinancials } from "@/lib/sprint-financials";
import {
  computeSprintPlannedSplit,
  computeSprintInvestmentAmounts,
  describeSprintInvestment,
  describeSpendSourceTimestamp,
} from "@/lib/sprint-financials";
import { computeSprintDailyRecommendation } from "@/lib/monthly-budget";
import { formatCurrency, formatShortDateTime, formatWeekdayAndDayMonth } from "@/lib/format";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString, todayUTC } from "@/lib/today";
import type { AttentionAlert } from "@/lib/attention-alerts";
import { CommentThread, type CommentItem } from "./comment-thread";
import { SprintTaskList } from "./sprint-task-list";
import type { TaskListItem } from "./task-row";
import { resetSprintSpendSourceAction, updateSprintActualSpendAction } from "./sprint-actions";
import { MoneyInput } from "./money-input";
import { SprintFinancialBar } from "./sprint-financial-bar";
import { AccountReviewsSection, type AccountReviewSummaryItem } from "./account-reviews-section";

const TEMPORAL_LABEL = {
  futura: "Futura",
  atual: "Sprint atual",
  concluida: "Concluída",
} as const;

const TEMPORAL_BADGE_CLASSES = {
  futura: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  atual: "bg-brand/10 text-brand",
  concluida: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
} as const;

const EXECUTION_LABEL_CLASSES: Record<"atencao" | "critico" | "neutro", string> = {
  neutro: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  critico: "text-red-600 dark:text-red-400",
};

/** Linha compacta de alertas — 1 ícone + o alerta mais prioritário (já vêm
 * ordenados por severidade em buildAttentionAlerts, então `alerts[0]` já é
 * o mais prioritário sem recalcular nada) + quantos restam. Vermelho só
 * quando esse alerta é crítico. Vive aqui (não em cada tela que usa
 * SprintCard) porque é sempre a mesma apresentação nos lugares que a usam
 * (resumo recolhido + toggle "Ver alertas" expandido; também exportada pra
 * o resumo mensal consolidado da tela Sprints, que não tem SprintCard). */
export function AlertsSummaryLine({ topAlert, remaining }: { topAlert: AttentionAlert; remaining: number }) {
  const isCritical = topAlert.severity === "critico";
  return (
    <>
      <TriangleAlert
        className={`h-3 w-3 shrink-0 ${isCritical ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className={isCritical ? "font-medium text-red-600 dark:text-red-400" : ""}>{topAlert.message}</span>
      {remaining > 0 && <span>· +{remaining} alerta{remaining !== 1 ? "s" : ""}</span>}
    </>
  );
}

/**
 * Conteúdo investigativo de uma sprint (Etapa 44: "card aberto = investigação
 * e execução") — grid financeiro com edição de gasto manual, alertas
 * detalhados, lista de tarefas, comentários e "abrir cliente". Extraído de
 * dentro do próprio `<details>` de `SprintCard` pra poder ser reaproveitado
 * também pelo card compacto de conta da tela Sprints (Sprint atual), que
 * precisa do mesmo conteúdo de investigação mas sob um `<details>` próprio,
 * com um resumo fechado diferente (mais simples) — nunca uma segunda
 * implementação do financeiro/tarefas/comentários da sprint.
 */
export function SprintCardBody({
  sprint,
  comments,
  clientId,
  isAdmin,
  tasks,
  executionLabel,
  executionSeverity,
  alerts,
  openClientHref,
  buildTaskHref,
  accountReviews,
  newReviewHref,
  buildReviewDetailHref,
  plannedAllocations,
  manualSpendUpdatedAt,
  metaSyncedAt,
}: {
  sprint: SprintFinancials;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
  alerts?: AttentionAlert[];
  openClientHref?: string;
  buildTaskHref?: (taskId: string) => string;
  /** Análises da Conta desta sprint (Etapa 57) — opcional: só quem já
   * consulta account_reviews passa isto (mesmo padrão de `alerts`/
   * `executionLabel`, nem toda tela que usa este componente precisa). */
  accountReviews?: AccountReviewSummaryItem[];
  newReviewHref?: string;
  buildReviewDetailHref?: (reviewId: string) => string;
  /** Alocações diárias (`sprint_planned_allocations`) só desta sprint —
   * opcional (Etapa 63): quando fornecida, o resumo financeiro passa a
   * distinguir a fatia histórica (dias já decorridos, nunca recalculada) da
   * fatia futura (dias restantes, ainda ajustável) da sprint atual. Sem
   * isso (ex.: painel Sprints, que ainda não busca por sprint individual),
   * cai pro total bruto (`plannedSpend`) — nunca um segundo cálculo. */
  plannedAllocations?: { date: string; amount: number }[];
  /** Última edição do gasto manual desta sprint (`sprints.manual_spend_updated_at`)
   * — Etapa 65: `undefined` (nunca buscado, ex.: painel Sprints) é diferente
   * de `null` (buscado, mas nunca editado manualmente); só a página do
   * cliente busca essa coluna por sprint hoje. */
  manualSpendUpdatedAt?: string | null;
  /** Último `daily_spend.synced_at` do cliente inteiro (Etapa 65) — mesma
   * distinção `undefined`/`null` de `manualSpendUpdatedAt` acima. */
  metaSyncedAt?: string | null;
}) {
  const split = plannedAllocations !== undefined ? computeSprintPlannedSplit(plannedAllocations, todayUTC()) : undefined;
  const isCurrent = sprint.temporalStatus === "atual";
  const isConcluded = sprint.temporalStatus === "concluida";
  const hasHistoricalPlan = split ? split.hasAnyAllocation : sprint.plannedSpend > 0;
  // Etapa 65: "previsto"/"restante" nunca recalculados aqui — mesma fonte
  // (`computeSprintInvestmentAmounts`) que `describeSprintInvestment` usa pro
  // resumo compacto da linha fechada (`SprintCard`), pra nunca haver dois
  // valores divergentes entre a linha fechada e o card aberto.
  const amounts = computeSprintInvestmentAmounts(sprint, split);
  const isRecalculated = isCurrent && !!split;
  const dailyRecommendation = !isConcluded
    ? computeSprintDailyRecommendation(sprint, amounts.remainingPlanned, todayDateString())
    : null;
  const finalResultDiff = amounts.totalPrevisto - sprint.actualSpend;
  const sourceTimestampText = describeSpendSourceTimestamp(
    sprint.spendSource,
    manualSpendUpdatedAt,
    metaSyncedAt,
    formatShortDateTime,
  );
  const editActualToggleId = `edit-actual-${sprint.sprintId}`;
  const revertSourceToggleId = `revert-source-${sprint.sprintId}`;
  const isManualSource = sprint.spendSource === "manual";

  const topAlert = alerts?.[0];
  const remainingAlerts = (alerts?.length ?? 0) - 1;

  return (
    <div className="border-t border-border p-3">
        {isCurrent && (
          <div className="mb-3 inline-flex flex-col rounded-md border border-brand/30 bg-brand/5 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-brand">Hoje</span>
            <span className="text-sm font-medium text-brand">{formatWeekdayAndDayMonth(todayUTC())}</span>
          </div>
        )}
        {isCurrent && executionLabel && (
          <p className={`mb-3 text-xs ${EXECUTION_LABEL_CLASSES[executionSeverity ?? "neutro"]}`}>
            Última execução da sprint: {executionLabel}
          </p>
        )}

        <div className="rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
          {/* Etapa 65: sem os textos introdutórios "R$X investidos de R$Y
              previstos"/"R$X ainda planejados" — já repetiam os mesmos
              valores dos indicadores abaixo. Esse resumo continua existindo
              só na linha compacta da sprint fechada (`SprintCard`,
              `investment.primary`), nunca duplicado aqui dentro. */}
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${isConcluded ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Investimento previsto
              </p>
              <p className="mt-0.5 text-base font-semibold text-foreground">{formatCurrency(amounts.totalPrevisto)}</p>
              <p className="text-[11px] text-muted-foreground">
                {isConcluded && !hasHistoricalPlan
                  ? "Planejamento histórico não definido"
                  : isRecalculated
                    ? "Planejamento total atualizado da sprint"
                    : "Definido pelo orçamento do mês"}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Gasto real
              </p>
              {isAdmin ? (
                <>
                  <input type="checkbox" id={editActualToggleId} className="peer hidden" />
                  <div className="mt-0.5 flex items-center gap-1.5 peer-checked:hidden">
                    <p className="text-base font-semibold text-foreground">
                      {formatCurrency(sprint.actualSpend)}
                    </p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 peer-checked:hidden">
                    <label
                      htmlFor={editActualToggleId}
                      className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                    >
                      Editar
                    </label>
                    <span
                      className="text-[11px] text-muted-foreground"
                      title={isManualSource ? "Valor digitado manualmente" : "Valor sincronizado do Meta"}
                    >
                      · {isManualSource ? "Manual" : "Meta"}
                    </span>
                  </div>
                  {sourceTimestampText && (
                    <p className="text-[11px] text-muted-foreground peer-checked:hidden">{sourceTimestampText}</p>
                  )}
                  {isManualSource && (
                    <div className="mt-0.5 peer-checked:hidden">
                      <input type="checkbox" id={revertSourceToggleId} className="peer/revert hidden" />
                      <label
                        htmlFor={revertSourceToggleId}
                        className="cursor-pointer text-[11px] text-muted-foreground hover:underline peer-checked/revert:hidden"
                      >
                        Usar dado do Meta
                      </label>
                      <div className="hidden items-center gap-1.5 peer-checked/revert:flex">
                        <span className="text-[11px] text-muted-foreground">Substituir valor manual pelo do Meta?</span>
                        <form action={resetSprintSpendSourceAction.bind(null, sprint.sprintId, clientId)}>
                          <button
                            type="submit"
                            className="text-[11px] font-medium text-brand hover:underline"
                          >
                            Confirmar
                          </button>
                        </form>
                        <label
                          htmlFor={revertSourceToggleId}
                          className="cursor-pointer text-[11px] text-muted-foreground hover:underline"
                        >
                          Cancelar
                        </label>
                      </div>
                    </div>
                  )}
                  <form
                    action={updateSprintActualSpendAction.bind(null, sprint.sprintId, clientId)}
                    className="mt-1 hidden flex-wrap items-center gap-1.5 peer-checked:flex"
                  >
                    <MoneyInput name="actual_spend" defaultValue={sprint.actualSpend} autoFocus />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Salvar
                    </button>
                    <label
                      htmlFor={editActualToggleId}
                      className="cursor-pointer text-[11px] text-muted-foreground hover:underline"
                    >
                      Cancelar
                    </label>
                  </form>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatCurrency(sprint.actualSpend)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{isManualSource ? "Manual" : "Meta"}</p>
                  {sourceTimestampText && <p className="text-[11px] text-muted-foreground">{sourceTimestampText}</p>}
                </>
              )}
            </div>

            {isConcluded ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Resultado final
                </p>
                {hasHistoricalPlan ? (
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {finalResultDiff > 0
                      ? `${formatCurrency(finalResultDiff)} abaixo do previsto`
                      : finalResultDiff < 0
                        ? `${formatCurrency(Math.abs(finalResultDiff))} acima do previsto`
                        : "Dentro do previsto"}
                  </p>
                ) : (
                  <p className="mt-0.5 text-base font-semibold text-muted-foreground">Sprint encerrada</p>
                )}
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Planejamento restante
                  </p>
                  {/* Etapa 65: nunca mais vermelho automático aqui — só o
                      indicador de excedente abaixo da barra assume essa cor,
                      reservada pra situação realmente crítica. */}
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatCurrency(amounts.remainingPlanned)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Para os dias restantes da sprint</p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Investimento diário recomendado
                  </p>
                  {dailyRecommendation && dailyRecommendation.eligibleDaysCount > 0 ? (
                    <>
                      <p className="mt-0.5 text-base font-semibold text-brand">
                        {formatCurrency(dailyRecommendation.recommendedDaily)}/dia
                      </p>
                      <p className="text-[11px] text-muted-foreground">Até o final da sprint</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 text-base font-semibold text-foreground">{formatCurrency(0)}/dia</p>
                      <p className="text-[11px] text-muted-foreground">Sem dias restantes para ajuste</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {amounts.overageAmount > 0 && (
            <p className="mt-2 text-[11px] font-medium text-red-600 dark:text-red-400">
              {formatCurrency(amounts.overageAmount)} acima do previsto
            </p>
          )}

          <div className="mt-2">
            <SprintFinancialBar actualSpend={sprint.actualSpend} totalPrevisto={amounts.totalPrevisto} />
          </div>
        </div>

        {topAlert && (
          <details className="group/alerts mt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
              <span className="ml-auto shrink-0 font-medium text-brand">
                <span className="group-open/alerts:hidden">{(alerts?.length ?? 0) > 1 ? "Ver todos" : "Ver detalhe"}</span>
                <span className="hidden group-open/alerts:inline">Ocultar alertas</span>
              </span>
            </summary>
            <ul className="mt-1.5 flex flex-col gap-0.5 border-l-2 border-border pl-2">
              {alerts?.map((alert, index) => (
                <li
                  key={index}
                  className={`text-xs leading-tight ${
                    alert.severity === "critico"
                      ? "text-red-600 dark:text-red-400"
                      : alert.severity === "atencao"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {alert.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        <SprintTaskList tasks={tasks} clientId={clientId} sprintId={sprint.sprintId} buildTaskHref={buildTaskHref} />

        {accountReviews && newReviewHref && buildReviewDetailHref && (
          <AccountReviewsSection
            reviews={accountReviews}
            newReviewHref={newReviewHref}
            buildDetailHref={buildReviewDetailHref}
          />
        )}

        <details className="mt-3 border-t border-border pt-2 [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="text-xs font-medium text-muted-foreground hover:text-brand">
            Ver detalhes da sprint {comments.length > 0 ? `(${comments.length} comentário${comments.length !== 1 ? "s" : ""})` : ""}
          </summary>
          <div className="mt-2">
            <CommentThread
              comments={comments}
              commentableType="sprint"
              commentableId={sprint.sprintId}
              clientId={clientId}
            />
          </div>
        </details>

        {openClientHref && (
          <div className="mt-3 border-t border-border pt-2 text-xs">
            <Link href={openClientHref} className="text-muted-foreground hover:underline">
              Abrir cliente
            </Link>
          </div>
        )}
    </div>
  );
}

/**
 * Card único de sprint — implementação compartilhada entre a página
 * individual do cliente e o agrupamento "Mensal > Por sprints" do painel
 * Sprints (Etapa 42): mesmo componente, mesma estrutura visual, mesmas
 * informações e ações nos dois lugares. Wrapper fino em volta de
 * `SprintCardBody` (Etapa 44) — o próprio resumo/`<details>` não muda,
 * só o conteúdo expandido foi extraído pra ser reaproveitado também pelo
 * card compacto de conta da visão "Sprint atual" (`account-card.tsx`), que
 * precisa de um resumo fechado diferente (mais simples) em volta do mesmo
 * conteúdo investigativo.
 *
 * - `defaultOpen`: a página do cliente deixa a sprint atual já aberta por
 *   padrão (omitir a prop preserva esse comportamento); o painel Sprints
 *   passa sempre `false` (toda sprint começa recolhida lá).
 * - `alerts`: só o painel Sprints passa (a página do cliente já tem seu
 *   próprio AttentionPanel client-wide, acima da lista de sprints — não
 *   duplicar mostrando alerta dentro E fora do card). Quando fornecido,
 *   aparece um indicador compacto já no resumo recolhido (pra não perder a
 *   leitura rápida que o painel Sprints já tinha) e a lista completa no
 *   corpo expandido, exatamente como antes.
 * - `openClientHref`: só o painel Sprints passa ("Abrir cliente" não faz
 *   sentido dentro da própria página do cliente).
 * - `buildTaskHref`: como cada tela abre o drawer de tarefa a partir de uma
 *   URL diferente (a própria página do cliente vs. o painel Sprints
 *   preservando filtros/mês/modo), quem chama decide a URL; o padrão
 *   preserva o comportamento já existente na página do cliente.
 */
export function SprintCard({
  sprint,
  comments,
  clientId,
  isAdmin,
  tasks,
  executionLabel,
  executionSeverity,
  defaultOpen,
  alerts,
  openClientHref,
  buildTaskHref,
  accountReviews,
  newReviewHref,
  buildReviewDetailHref,
  plannedAllocations,
  manualSpendUpdatedAt,
  metaSyncedAt,
}: {
  sprint: SprintFinancials;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
  defaultOpen?: boolean;
  alerts?: AttentionAlert[];
  openClientHref?: string;
  buildTaskHref?: (taskId: string) => string;
  accountReviews?: AccountReviewSummaryItem[];
  newReviewHref?: string;
  buildReviewDetailHref?: (reviewId: string) => string;
  /** Ver `SprintCardBody` — mesmo dado, mesmo comportamento opcional. */
  plannedAllocations?: { date: string; amount: number }[];
  manualSpendUpdatedAt?: string | null;
  metaSyncedAt?: string | null;
}) {
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const isCurrent = sprint.temporalStatus === "atual";
  const isOpen = defaultOpen ?? isCurrent;
  const split = plannedAllocations !== undefined ? computeSprintPlannedSplit(plannedAllocations, todayUTC()) : undefined;
  const investment = describeSprintInvestment(sprint, split, formatCurrency);

  const topAlert = alerts?.[0];
  const remainingAlerts = (alerts?.length ?? 0) - 1;

  return (
    <details
      id={`sprint-${sprint.sprintId}`}
      open={isOpen}
      className={`group scroll-mt-4 rounded-lg border bg-card [&_summary::-webkit-details-marker]:hidden ${
        isCurrent ? "border-l-4 border-l-brand border-y-border border-r-border" : "border-border"
      }`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="shrink-0 text-sm font-semibold text-foreground">
          {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
        >
          {TEMPORAL_LABEL[sprint.temporalStatus]}
        </span>

        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{investment.primary}</span>
          <span className="hidden tabular-nums sm:inline">{Math.round(sprint.progressPct)}%</span>
          <span className="hidden sm:inline">
            {tasksDone}/{tasks.length} tarefas
          </span>
          {accountReviews && (
            <span className="hidden sm:inline">
              {accountReviews.length} {accountReviews.length === 1 ? "análise" : "análises"}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[sprint.status]}`}
          >
            {SPEND_STATUS_LABEL[sprint.status]}
          </span>
        </span>

        {topAlert && (
          <span className="flex w-full min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
          </span>
        )}
      </summary>

      <SprintCardBody
        sprint={sprint}
        comments={comments}
        clientId={clientId}
        isAdmin={isAdmin}
        tasks={tasks}
        executionLabel={executionLabel}
        executionSeverity={executionSeverity}
        alerts={alerts}
        openClientHref={openClientHref}
        buildTaskHref={buildTaskHref}
        accountReviews={accountReviews}
        newReviewHref={newReviewHref}
        buildReviewDetailHref={buildReviewDetailHref}
        plannedAllocations={plannedAllocations}
        manualSpendUpdatedAt={manualSpendUpdatedAt}
        metaSyncedAt={metaSyncedAt}
      />
    </details>
  );
}
