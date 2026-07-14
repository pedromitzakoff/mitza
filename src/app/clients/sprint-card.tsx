import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { SprintFinancials } from "@/lib/sprint-financials";
import { describeSpendSourceTimestamp } from "@/lib/sprint-financials";
import { formatCurrency, formatShortDateTime, formatWeekdayAndDayMonth } from "@/lib/format";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayUTC } from "@/lib/today";
import type { AttentionAlert } from "@/lib/attention-alerts";
import { CommentThread, type CommentItem } from "./comment-thread";
import { SprintTaskList } from "./sprint-task-list";
import type { TaskListItem } from "./task-row";
import { resetSprintSpendSourceAction, updateSprintActualSpendAction } from "./sprint-actions";
import { upsertSprintPerformanceResultAction } from "./performance-actions";
import { MoneyInput } from "./money-input";
import { AccountReviewsSection, type AccountReviewSummaryItem } from "./account-reviews-section";
import { getLatestPerformanceUpdateText, type SprintPerformanceView } from "@/lib/performance";
import { formatPerformanceResult, PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";

/** Dados de performance de UMA sprint (Etapa 71) — sempre opcional: quem
 * ainda não busca `performance_records` (nenhuma tela hoje) simplesmente
 * não passa a prop e nada de performance aparece, igual ao padrão já
 * existente de `accountReviews`/`alerts`. */
export interface SprintPerformanceProps {
  view: SprintPerformanceView;
  /** Valor já lançado de cada canal selecionável, pra pré-preencher
   * "Editar resultados" — vazio quando `view.kind` não é `has_data`/`no_data`
   * (nada pra editar numa sprint futura). */
  editableChannels: { channel: TrafficChannel; existingCount: number | null }[];
}

/** Linha compacta "32 leads · CPL R$ 25" / "Sem dados de performance" /
 * "Performance ainda não iniciada" / "Objetivo não configurado" — mesmo
 * texto no resumo recolhido do card e no início da seção expandida, nunca
 * duas fórmulas diferentes pro mesmo estado. */
function formatCompactPerformanceText(view: SprintPerformanceView): string {
  switch (view.kind) {
    case "not_configured":
      return "Objetivo não configurado";
    case "not_started":
      return "Performance ainda não iniciada";
    case "no_data":
      return "Sem dados de performance";
    case "has_data": {
      const { goal, summary } = view;
      const resultText = formatPerformanceResult(summary.resultCount, goal);
      if (summary.costPerResult === null) return resultText;
      const config = PERFORMANCE_GOALS[goal];
      return `${resultText} · ${config.costMetricShortLabel} ${formatCurrency(summary.costPerResult)}`;
    }
  }
}

const PERFORMANCE_STATUS_TEXT_CLASSES: Record<string, string> = {
  better: "text-green-600 dark:text-green-400",
  worse: "text-red-600 dark:text-red-400",
};

/**
 * Seção "Performance da sprint" (Etapa 71, seção 26) — Resultado / Custo por
 * resultado / Meta / Comparação / Fonte / Última atualização, nunca um
 * campo de CPL/CPA editável (sempre derivado). "Editar resultados" é
 * sempre por canal fixo (nunca um <select>, pra funcionar sem JS, mesmo
 * padrão checkbox-toggle já usado no gasto real acima) — um canal só
 * (Meta ou Google) ainda grava a dimensão de canal normalmente.
 */
function SprintPerformanceSection({
  performance,
  sprintId,
  clientId,
  isAdmin,
}: {
  performance: SprintPerformanceProps;
  sprintId: string;
  clientId: string;
  isAdmin: boolean;
}) {
  const { view, editableChannels } = performance;
  const compactText = formatCompactPerformanceText(view);
  const canEdit = isAdmin && (view.kind === "has_data" || view.kind === "no_data");
  const editToggleId = `edit-performance-${sprintId}`;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Performance da sprint</p>

      {view.kind !== "has_data" ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{compactText}</p>
      ) : (
        (() => {
          const { goal, summary } = view;
          const config = PERFORMANCE_GOALS[goal];
          const comparisonText =
            summary.comparison.status === "not_available"
              ? null
              : summary.comparison.status === "on_target"
                ? "Dentro da meta"
                : `${Math.round(Math.abs((summary.comparison.variation ?? 0) * 100))}% ${summary.comparison.status === "worse" ? "acima da meta" : "melhor que a meta"}`;
          return (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <p className="text-sm font-semibold text-foreground">{formatPerformanceResult(summary.resultCount, goal)}</p>
              <p className="text-sm text-foreground">
                {config.costMetricShortLabel}{" "}
                <span className="font-semibold">
                  {summary.costPerResult !== null ? formatCurrency(summary.costPerResult) : "—"}
                </span>
              </p>
              {summary.targetCostPerResult !== null && (
                <p className="text-[11px] text-muted-foreground">
                  Meta {config.costMetricShortLabel} {formatCurrency(summary.targetCostPerResult)}
                </p>
              )}
              {comparisonText && (
                <p className={`text-[11px] font-medium ${PERFORMANCE_STATUS_TEXT_CLASSES[summary.comparison.status] ?? "text-muted-foreground"}`}>
                  {comparisonText}
                </p>
              )}
              {summary.costUnavailableReason === "zero_results" && (
                <p className="text-[11px] text-muted-foreground">Nenhum resultado gerado no período.</p>
              )}
            </div>
          );
        })()
      )}

      {view.kind === "has_data" && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {getLatestPerformanceUpdateText(view.summary.latestSource, view.summary.latestUpdatedAt, formatShortDateTime)}
        </p>
      )}

      {canEdit && editableChannels.length > 0 && (
        <>
          <input type="checkbox" id={editToggleId} className="peer hidden" />
          <label
            htmlFor={editToggleId}
            className="mt-1 inline-block cursor-pointer text-[11px] font-medium text-brand hover:underline peer-checked:hidden"
          >
            Editar resultados
          </label>

          <div className="mt-1.5 hidden flex-col gap-1.5 peer-checked:flex">
            {editableChannels.map(({ channel, existingCount }) => (
              <form
                key={channel}
                action={upsertSprintPerformanceResultAction.bind(null, sprintId, clientId)}
                className="flex flex-wrap items-center gap-1.5"
              >
                <input type="hidden" name="channel" value={channel} />
                <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{TRAFFIC_CHANNELS[channel].shortLabel}</span>
                <input
                  type="number"
                  name="result_count"
                  min={0}
                  step={1}
                  defaultValue={existingCount ?? ""}
                  placeholder="0"
                  className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-[11px] text-foreground outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Salvar
                </button>
              </form>
            ))}
            <label htmlFor={editToggleId} className="cursor-pointer self-start text-[11px] text-muted-foreground hover:underline">
              Cancelar
            </label>
          </div>
        </>
      )}
    </div>
  );
}

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
  manualSpendUpdatedAt,
  metaSyncedAt,
  performance,
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
  /** Última edição do gasto manual desta sprint (`sprints.manual_spend_updated_at`)
   * — `undefined` (nunca buscado, ex.: painel Sprints) é diferente de `null`
   * (buscado, mas nunca editado manualmente); só a página do cliente busca
   * essa coluna por sprint hoje. */
  manualSpendUpdatedAt?: string | null;
  /** Último `daily_spend.synced_at` do cliente inteiro — mesma distinção
   * `undefined`/`null` de `manualSpendUpdatedAt` acima. */
  metaSyncedAt?: string | null;
  /** Dados de performance desta sprint (Etapa 71) — opcional, mesmo padrão
   * de `accountReviews`/`alerts`. */
  performance?: SprintPerformanceProps;
}) {
  const isCurrent = sprint.temporalStatus === "atual";
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

        {/* Investimento realizado — Etapa 73: a camada de planejamento/
            recomendação financeira POR SPRINT foi retirada da interface
            operacional (fica só no nível mensal, na seção "Investimento do
            mês"); a sprint agora só mostra o que de fato aconteceu. Nada foi
            apagado por baixo — `computeOriginalSprintPlans`/
            `computeMonthlyBudgetPlan`/`ensureClosedSprintSnapshots` continuam
            existindo e escrevendo o histórico congelado (ver
            `sprint-snapshot.ts`), só não alimentam mais nenhum componente de
            tela. */}
        <div className="rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Investimento realizado
          </p>
          {isAdmin ? (
            <>
              <input type="checkbox" id={editActualToggleId} className="peer hidden" />
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 peer-checked:hidden">
                <p className="text-lg font-semibold text-foreground">{formatCurrency(sprint.actualSpend)}</p>
                <label
                  htmlFor={editActualToggleId}
                  className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                >
                  Editar
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground peer-checked:hidden">
                {sourceTimestampText ?? (isManualSource ? "Manual" : "Meta")}
              </p>
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
                      <button type="submit" className="text-[11px] font-medium text-brand hover:underline">
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
              <p className="mt-0.5 text-lg font-semibold text-foreground">{formatCurrency(sprint.actualSpend)}</p>
              <p className="text-[11px] text-muted-foreground">
                {sourceTimestampText ?? (isManualSource ? "Manual" : "Meta")}
              </p>
            </>
          )}
        </div>

        {performance && (
          <SprintPerformanceSection
            performance={performance}
            sprintId={sprint.sprintId}
            clientId={clientId}
            isAdmin={isAdmin}
          />
        )}

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
  manualSpendUpdatedAt,
  metaSyncedAt,
  performance,
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
  manualSpendUpdatedAt?: string | null;
  metaSyncedAt?: string | null;
  performance?: SprintPerformanceProps;
}) {
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const isCurrent = sprint.temporalStatus === "atual";
  const isOpen = defaultOpen ?? isCurrent;

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
      {/* Linha compacta — Etapa 73: prioriza realizado + performance real,
          nunca mais orientação/planejamento financeiro semanal (isso vive só
          na seção mensal "Investimento do mês"). Ordem: período → status
          temporal → investido → resultado/custo → tarefas → análises. O
          próprio badge temporal já cobre "status operacional" (Sprint atual/
          Concluída/Futura) — nunca um segundo selo Acima/Abaixo/Dentro/Sem
          planejamento aqui, essas classificações são só do nível mensal. */}
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
          {/* Sprint futura sem nenhum gasto ainda: "R$0 investidos" é só
              ruído (seção 8 do pedido) — a própria performance já mostra
              "Performance ainda não iniciada" logo em seguida. */}
          {!(sprint.temporalStatus === "futura" && sprint.actualSpend === 0) && (
            <span className="tabular-nums">{formatCurrency(sprint.actualSpend)} investidos</span>
          )}
          {performance && performance.view.kind !== "not_configured" && (
            <span className="hidden tabular-nums sm:inline">{formatCompactPerformanceText(performance.view)}</span>
          )}
          {!(sprint.temporalStatus === "futura" && tasks.length === 0) && (
            <span className="hidden sm:inline">
              {tasksDone}/{tasks.length} tarefas
            </span>
          )}
          {accountReviews && (
            <span className="hidden sm:inline">
              {accountReviews.length} {accountReviews.length === 1 ? "análise" : "análises"}
            </span>
          )}
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
        manualSpendUpdatedAt={manualSpendUpdatedAt}
        metaSyncedAt={metaSyncedAt}
        performance={performance}
      />
    </details>
  );
}
