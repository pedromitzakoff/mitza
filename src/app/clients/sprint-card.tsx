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
import { resetSprintSpendSourceAction } from "./sprint-actions";
import { updateSprintPerformanceAction } from "./performance-actions";
import { MoneyInput } from "./money-input";
import { AccountReviewsSection, type AccountReviewSummaryItem } from "./account-reviews-section";
import { getLatestPerformanceUpdateText, type SprintPerformanceView } from "@/lib/performance";
import { formatPerformanceResult, PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { ROW_GRID_CLASSES } from "@/app/sprints/row-grid";
import { SubmitButton } from "@/app/submit-button";

/** Dados de performance de UMA sprint (Etapa 71) — sempre opcional: quem
 * ainda não busca `performance_records` (nenhuma tela hoje) simplesmente
 * não passa a prop e nada de performance aparece, igual ao padrão já
 * existente de `accountReviews`/`alerts`. */
export interface SprintPerformanceProps {
  view: SprintPerformanceView;
  /** Valor já lançado de cada canal selecionável, pra pré-preencher
   * "Atualizar performance" — vazio quando `view.kind` não é `has_data`/`no_data`
   * (nada pra editar numa sprint futura). */
  editableChannels: { channel: TrafficChannel; existingCount: number | null }[];
}

/** Linha compacta "32 leads · CPL R$ 25" / "Sem dados de performance" /
 * "Performance ainda não iniciada" / "Objetivo não configurado" — mesmo
 * texto no resumo recolhido do card e na linha "Resultados"/"Custo por
 * resultado" da seção expandida, nunca duas fórmulas diferentes pro mesmo
 * estado. */
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

/** Textos prontos das 2 células "Resultados"/"Custo por resultado" da seção
 * "Performance da sprint" — os 4 estados nunca são confundidos entre si
 * (Etapa 74, seção 5 do pedido): sem objetivo, sprint futura, sem dado
 * registrado, e dado registrado (que por sua vez nunca fabrica "0
 * leads"/"CPL R$ 0" a menos que o registro exista de verdade com contagem
 * 0 — `view.kind === "has_data"` já é essa distinção). */
export function derivePerformanceCellTexts(view: SprintPerformanceView): {
  resultsValue: string;
  resultsAux: string | null;
  costValue: string;
  costAux: { text: string; tone: "better" | "worse" | null } | null;
} {
  switch (view.kind) {
    case "not_configured":
      return { resultsValue: "—", resultsAux: "Objetivo não configurado", costValue: "—", costAux: null };
    case "not_started":
      return { resultsValue: "—", resultsAux: "Performance ainda não iniciada", costValue: "—", costAux: null };
    case "no_data":
      return { resultsValue: "—", resultsAux: "Sem dados de performance", costValue: "—", costAux: null };
    case "has_data": {
      const { goal, summary } = view;
      const config = PERFORMANCE_GOALS[goal];
      const resultsValue = formatPerformanceResult(summary.resultCount, goal);
      const resultsAux = summary.resultCount === 0 ? "Nenhum resultado gerado no período" : null;
      const costValue = summary.costPerResult !== null ? `${config.costMetricShortLabel} ${formatCurrency(summary.costPerResult)}` : "—";
      let costAux: { text: string; tone: "better" | "worse" | null } | null = null;
      if (summary.targetCostPerResult !== null && summary.costPerResult !== null) {
        if (summary.comparison.status === "on_target") {
          costAux = { text: "Dentro da meta", tone: null };
        } else if (summary.comparison.status === "worse" || summary.comparison.status === "better") {
          const pct = Math.round(Math.abs((summary.comparison.variation ?? 0) * 100));
          costAux = {
            text: `${pct}% ${summary.comparison.status === "worse" ? "acima da meta" : "melhor que a meta"}`,
            tone: summary.comparison.status,
          };
        }
      }
      return { resultsValue, resultsAux, costValue, costAux };
    }
  }
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
 * "Performance da sprint" (Etapa 74) — substitui os antigos blocos separados
 * "Investimento realizado" + "Performance da sprint": investimento,
 * resultado e custo por resultado agora vivem juntos, nas 3 colunas de uma
 * mesma seção, com UMA ação ("Atualizar performance") que grava os dois no
 * mesmo fluxo (`updateSprintPerformanceAction`). Nenhuma fórmula financeira
 * ou de custo por resultado mudou — só a apresentação e a ação de edição.
 */
function SprintPerformanceSection({
  sprint,
  performance,
  clientId,
  isAdmin,
  sourceTimestampText,
  isManualSource,
  revertSourceToggleId,
  returnTo,
}: {
  sprint: SprintFinancials;
  performance?: SprintPerformanceProps;
  clientId: string;
  isAdmin: boolean;
  sourceTimestampText: string | null;
  isManualSource: boolean;
  revertSourceToggleId: string;
  returnTo: string;
}) {
  const view = performance?.view ?? { kind: "not_configured" as const };
  const cells = derivePerformanceCellTexts(view);
  const editableChannels = performance?.editableChannels ?? [];
  const canEditResults = isAdmin && (view.kind === "has_data" || view.kind === "no_data") && editableChannels.length > 0;
  const editToggleId = `edit-performance-${sprint.sprintId}`;
  const investmentSourceText = sourceTimestampText ?? (isManualSource ? "Manual" : "Meta");
  const performanceSourceText =
    view.kind === "has_data" ? getLatestPerformanceUpdateText(view.summary.latestSource, view.summary.latestUpdatedAt, formatShortDateTime) : null;

  return (
    <div className="rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Performance da sprint</p>

      <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Investimento realizado</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{formatCurrency(sprint.actualSpend)}</p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resultados</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{cells.resultsValue}</p>
          {cells.resultsAux && <p className="text-[11px] text-muted-foreground">{cells.resultsAux}</p>}
          {view.kind === "not_configured" && (
            <Link href={`/clients/${clientId}/edit`} className="text-[11px] font-medium text-brand hover:underline">
              Configurar objetivo
            </Link>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Custo por resultado</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">{cells.costValue}</p>
          {cells.costAux && (
            <p
              className={`text-[11px] font-medium ${cells.costAux.tone ? PERFORMANCE_STATUS_TEXT_CLASSES[cells.costAux.tone] : "text-muted-foreground"}`}
            >
              {cells.costAux.text}
            </p>
          )}
        </div>
      </div>

      {performanceSourceText ? (
        <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <p>Investimento: {investmentSourceText}</p>
          <p>Resultados: {performanceSourceText}</p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">{investmentSourceText}</p>
      )}

      {isManualSource && (
        <div className="mt-0.5">
          <input type="checkbox" id={revertSourceToggleId} className="peer/revert hidden" />
          <label
            htmlFor={revertSourceToggleId}
            className="cursor-pointer text-[11px] text-muted-foreground hover:underline peer-checked/revert:hidden"
          >
            Usar dado do Meta
          </label>
          <div className="hidden items-center gap-1.5 peer-checked/revert:flex">
            <span className="text-[11px] text-muted-foreground">Substituir valor manual pelo do Meta?</span>
            <form action={resetSprintSpendSourceAction.bind(null, sprint.sprintId, clientId, returnTo)}>
              <SubmitButton className="text-[11px] font-medium text-brand hover:underline" pendingChildren="Confirmando...">
                Confirmar
              </SubmitButton>
            </form>
            <label htmlFor={revertSourceToggleId} className="cursor-pointer text-[11px] text-muted-foreground hover:underline">
              Cancelar
            </label>
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <input type="checkbox" id={editToggleId} className="peer hidden" />
          <label
            htmlFor={editToggleId}
            className="mt-2 inline-block cursor-pointer text-[11px] font-medium text-brand hover:underline peer-checked:hidden"
          >
            Atualizar performance
          </label>

          <form
            action={updateSprintPerformanceAction.bind(null, sprint.sprintId, clientId, returnTo)}
            className="mt-2 hidden flex-col gap-1.5 peer-checked:flex"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Investimento</span>
              <MoneyInput name="actual_spend" defaultValue={sprint.actualSpend} autoFocus />
            </div>
            {canEditResults &&
              editableChannels.map(({ channel, existingCount }) => (
                <div key={channel} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 shrink-0 text-[11px] text-muted-foreground">
                    Resultado · {TRAFFIC_CHANNELS[channel].shortLabel}
                  </span>
                  <input
                    type="number"
                    name={`result_${channel}`}
                    min={0}
                    step={1}
                    defaultValue={existingCount ?? ""}
                    placeholder="0"
                    className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-[11px] text-foreground outline-none focus:border-brand"
                  />
                </div>
              ))}
            <div className="flex items-center gap-1.5">
              <SubmitButton
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                pendingChildren="Salvando..."
              >
                Salvar
              </SubmitButton>
              <label htmlFor={editToggleId} className="cursor-pointer text-[11px] text-muted-foreground hover:underline">
                Cancelar
              </label>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/**
 * Conteúdo investigativo de uma sprint (Etapa 44: "card aberto = investigação
 * e execução") — "Performance da sprint" (investimento + resultado + custo,
 * Etapa 74) e "Execução da sprint" (tarefas + otimizações, Etapa 74),
 * alertas detalhados, comentários e "abrir cliente". Extraído de dentro do
 * próprio `<details>` de `SprintCard` pra poder ser reaproveitado também
 * pelo card compacto de conta da tela Sprints (Sprint atual), que precisa
 * do mesmo conteúdo de investigação mas sob um `<details>` próprio, com um
 * resumo fechado diferente (mais simples) — nunca uma segunda implementação
 * do financeiro/performance/tarefas/otimizações/comentários da sprint.
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
  returnTo,
  taskManagers,
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
  /** Pra onde voltar depois de salvar investimento/performance (Etapa MVP
   * 1.3) — a página do cliente passa a própria URL, a tela Sprints passa a
   * URL atual dela (view/grouping/filtros preservados); nunca mais um
   * redirect fixo pra `/clients/{id}`. */
  returnTo: string;
  /** Otimizações desta sprint (Etapa 57/74) — opcional: só quem já consulta
   * account_reviews passa isto (mesmo padrão de `alerts`/`executionLabel`,
   * nem toda tela que usa este componente precisa). */
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
  /** Sprint UX 2.0 Fase 2 — só a tela Sprints passa isto: habilita "+ Tarefa"
   * inline em `SprintTaskList` (formulário sem navegar pra `/tasks/new`). A
   * página do cliente não passa, então continua com o link de sempre. */
  taskManagers?: { id: string; name: string }[];
}) {
  const isCurrent = sprint.temporalStatus === "atual";
  const sourceTimestampText = describeSpendSourceTimestamp(
    sprint.spendSource,
    manualSpendUpdatedAt,
    metaSyncedAt,
    formatShortDateTime,
  );
  const revertSourceToggleId = `revert-source-${sprint.sprintId}`;
  const isManualSource = sprint.spendSource === "manual";

  const topAlert = alerts?.[0];
  const remainingAlerts = (alerts?.length ?? 0) - 1;

  return (
    <div className="border-t border-border p-3">
        {/* Contexto do período e do dia atual */}
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

        {/* Performance da sprint — investimento realizado, resultados e custo
            por resultado juntos, com uma única ação de atualização (Etapa 74).
            Etapa 73: a camada de planejamento/recomendação financeira POR
            SPRINT continua fora da interface operacional (fica só no nível
            mensal, "Investimento do mês") — aqui só o que de fato aconteceu. */}
        <SprintPerformanceSection
          sprint={sprint}
          performance={performance}
          clientId={clientId}
          isAdmin={isAdmin}
          sourceTimestampText={sourceTimestampText}
          isManualSource={isManualSource}
          returnTo={returnTo}
          revertSourceToggleId={revertSourceToggleId}
        />

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

        {/* Execução da sprint — tarefas recorrentes e otimizações (revisões
            estratégicas da conta) lado a lado, mesmo nível hierárquico
            (Etapa 74). */}
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Execução da sprint</p>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <SprintTaskList
              tasks={tasks}
              clientId={clientId}
              sprintId={sprint.sprintId}
              buildTaskHref={buildTaskHref}
              managers={taskManagers}
              returnTo={taskManagers ? returnTo : undefined}
            />
            {accountReviews && newReviewHref && buildReviewDetailHref && (
              <AccountReviewsSection
                reviews={accountReviews}
                newReviewHref={newReviewHref}
                buildDetailHref={buildReviewDetailHref}
              />
            )}
          </div>
        </div>

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
  returnTo,
  flat,
  taskManagers,
  accordionRowsPrototype,
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
  /** Pra onde voltar depois de salvar investimento/performance (Etapa MVP
   * 1.3) — ver doc de `SprintCardBody`. */
  returnTo: string;
  /** Sprint UX 2.0 Fase 2 — ver doc de `SprintCardBody`. */
  taskManagers?: { id: string; name: string }[];
  /** Interaction Physics 1.0 — protótipo ISOLADO da técnica
   * `grid-template-rows: 0fr → 1fr` (ver `.mitza-accordion-rows` em
   * globals.css). Opt-in, nunca default: só o chamador que está testando o
   * protótipo passa `true`, e só pra UMA sprint. Anima somente a abertura
   * (limitação da técnica sem JS — ver comentário do CSS); fechar continua
   * instantâneo, sem regressão frente ao comportamento atual. */
  accordionRowsPrototype?: boolean;
  /** Sprint UX 2.0 Fase 2 (Decisão 011) — quando a sprint é filha visual de
   * um cliente já expandido (painel Sprints, "Mensal > Por sprints"), o
   * próprio card não deveria repetir moldura de card (borda/fundo/raio):
   * isso é "card dentro de card", o que a árvore operacional evita. `flat`
   * troca a moldura por só uma divisória inferior discreta + menos padding,
   * indentação fica por conta de quem chama (o wrapper do grupo). Nunca
   * passado pela página do cliente — lá a sprint continua com moldura de
   * card própria, sem cliente "pai" visível na mesma tela. */
  flat?: boolean;
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
      className={
        flat
          ? `group scroll-mt-4 border-b border-border/60 last:border-0 [&_summary::-webkit-details-marker]:hidden ${
              isCurrent ? "bg-brand/[0.03]" : ""
            }`
          : `group scroll-mt-4 rounded-lg border bg-card [&_summary::-webkit-details-marker]:hidden ${
              isCurrent ? "border-l-4 border-l-brand border-y-border border-r-border" : "border-border"
            }`
      }
    >
      {/* Linha compacta — Etapa 73/74: prioriza realizado + performance real,
          nunca mais orientação/planejamento financeiro semanal (isso vive só
          na seção mensal "Investimento do mês"). Ordem: período → status
          temporal → investido → resultado/custo → tarefas → otimizações. O
          próprio badge temporal já cobre "status operacional" (Sprint atual/
          Concluída/Futura) — nunca um segundo selo Acima/Abaixo/Dentro/Sem
          planejamento aqui, essas classificações são só do nível mensal.
          Sprint UX 2.0 Fase 3: em modo `flat` (só a tela Sprints usa), essa
          linha usa o mesmo grid de colunas da linha do cliente
          (`ROW_GRID_CLASSES`) — a coluna "Cliente/Gestor" fica vazia (só a
          indentação do wrapper do grupo já comunica "isto é filho do
          cliente"), Período/Investimento/Tarefas/Otimizações/Status caem
          exatamente sob as mesmas colunas de cima. A página do cliente
          nunca passa `flat`, então mantém a linha corrida de sempre. */}
      {flat ? (
        <summary className="flex cursor-pointer list-none items-start gap-2 px-2 py-1.5">
          <span className="mitza-chevron mt-0.5 shrink-0 text-xs text-muted-foreground group-open:rotate-90">
            ▸
          </span>
          <div className="min-w-0 flex-1">
            {/* Mobile (< sm): linha corrida — ver doc do bloco equivalente em
                `account-card-summary.tsx`. */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:hidden">
              <span className="font-medium text-foreground">
                {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
              >
                {TEMPORAL_LABEL[sprint.temporalStatus]}
              </span>
              {!(sprint.temporalStatus === "futura" && sprint.actualSpend === 0) && (
                <span className="tabular-nums text-muted-foreground">{formatCurrency(sprint.actualSpend)} investidos</span>
              )}
              {!(sprint.temporalStatus === "futura" && tasks.length === 0) && (
                <span className="tabular-nums text-muted-foreground">
                  {tasksDone}/{tasks.length} tarefas
                </span>
              )}
              {accountReviews && (
                <span className="tabular-nums text-muted-foreground">
                  {accountReviews.length} {accountReviews.length === 1 ? "otimização" : "otimizações"}
                </span>
              )}
            </div>

            {/* Desktop (sm+): mesmo grid da linha do cliente
                (`ROW_GRID_CLASSES`) — a coluna "Cliente/Gestor" fica vazia
                (só a indentação do wrapper do grupo já comunica "isto é filho
                do cliente"); Período/Investimento/Tarefas/Otimizações/Status
                caem exatamente sob as mesmas colunas de cima. */}
            <div className={ROW_GRID_CLASSES}>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className="truncate text-xs text-muted-foreground">
                {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
              </span>
              <div className="min-w-0">
                {!(sprint.temporalStatus === "futura" && sprint.actualSpend === 0) ? (
                  <>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(sprint.actualSpend)} / {formatCurrency(sprint.plannedSpend)}
                    </p>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.min(Math.max(sprint.progressPct, 0), 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Não iniciada</span>
                )}
              </div>
              <span className="truncate text-xs tabular-nums text-muted-foreground">
                {tasks.length === 0 ? "—" : `${tasksDone}/${tasks.length}`}
              </span>
              <span className="truncate text-xs tabular-nums text-muted-foreground">
                {accountReviews ? (accountReviews.length === 0 ? "—" : accountReviews.length) : ""}
              </span>
              <span
                className={`block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
              >
                {TEMPORAL_LABEL[sprint.temporalStatus]}
              </span>
            </div>

            {topAlert && (
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
              </span>
            )}
          </div>
        </summary>
      ) : (
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="mitza-chevron shrink-0 text-xs text-muted-foreground group-open:rotate-90">
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
                {accountReviews.length} {accountReviews.length === 1 ? "otimização" : "otimizações"}
              </span>
            )}
          </span>

          {topAlert && (
            <span className="flex w-full min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
            </span>
          )}
        </summary>
      )}

      {accordionRowsPrototype ? (
        <div className="mitza-accordion-rows">
          <div className="mitza-accordion-rows-inner">
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
              taskManagers={taskManagers}
              metaSyncedAt={metaSyncedAt}
              performance={performance}
              returnTo={returnTo}
            />
          </div>
        </div>
      ) : (
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
          taskManagers={taskManagers}
          metaSyncedAt={metaSyncedAt}
          performance={performance}
          returnTo={returnTo}
        />
      )}
    </details>
  );
}
