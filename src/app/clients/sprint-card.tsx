import Link from "next/link";
import type { SprintFinancials } from "@/lib/sprint-financials";
import { describeSpendSourceTimestamp } from "@/lib/sprint-financials";
import { formatCurrency, formatShortDateTime } from "@/lib/format";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { computeNextAction } from "@/lib/next-action";
import { CommentThread, type CommentItem } from "./comment-thread";
import { ActivitySection } from "./activity-section";
import type { TaskListItem } from "./task-row";
import { resetSprintSpendSourceAction } from "./sprint-actions";
import { updateSprintPerformanceAction } from "./performance-actions";
import { MoneyInput } from "./money-input";
import type { AccountReviewSummaryItem } from "./account-reviews-section";
import { getLatestPerformanceUpdateText, type SprintPerformanceView } from "@/lib/performance";
import { formatPerformanceResult, PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { ClientPerformanceGoalEditor } from "./client-performance-goal-editor";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { ROW_GRID_CLASSES } from "@/app/sprints/row-grid";
import { SECONDARY_ACTION_BUTTON_CLASSES } from "@/components/ui/section-header";
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
  /** Objetivo de performance do CLIENTE (não da sprint) — separado de `view`
   * porque `view.kind === "not_started"` (sprint futura) não carrega o goal
   * mesmo quando ele já está configurado (ver `buildSprintPerformanceView`).
   * O editor inline de objetivo (Refinamento de Densidade, Parte 3) precisa
   * saber o valor atual em QUALQUER estado da sprint, não só quando há dado. */
  performanceGoal: PerformanceGoal | null;
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
      // Refinamento de Densidade (Parte 8): "Não configurado" — falta
      // configuração, não é "sem dado suficiente pra calcular" (isso seria
      // "—"). O aux "Objetivo não configurado" saiu daqui porque agora o
      // próprio editor inline de objetivo já comunica isso na mesma linha —
      // repetir os dois seria duplicar a mesma informação (ver sprint-card).
      return { resultsValue: "Não configurado", resultsAux: null, costValue: "Não configurado", costAux: null };
    case "not_started":
      return { resultsValue: "—", resultsAux: "Performance ainda não iniciada", costValue: "—", costAux: null };
    case "no_data":
      // Parte 8: "Sem dados" — objetivo configurado e sprint já começou, mas
      // nenhum registro foi lançado ainda (a fonte existe, só não há dado no
      // período). Isso é diferente de "—" (não dá pra calcular): aqui dá,
      // simplesmente não há nada lançado — por isso o valor já diz isso, sem
      // precisar de um aux repetindo a mesma informação.
      return { resultsValue: "Sem dados", resultsAux: null, costValue: "Sem dados", costAux: null };
    case "has_data": {
      const { goal, summary } = view;
      const resultsValue = formatPerformanceResult(summary.resultCount, goal);
      const resultsAux = summary.resultCount === 0 ? "Nenhum resultado gerado no período" : null;
      // Etapa "Sprint Workspace Polish 1.0" (Parte 8): o valor não carrega
      // mais o prefixo CPA/CPL embutido — o rótulo agora é sempre exibido
      // separado (ver `SprintPerformanceSection`), pra nunca duplicar
      // "CPA: CPA R$ 45,00" e pra continuar rotulado mesmo quando `config`
      // não está disponível (estados sem objetivo/sem dado).
      const costValue = summary.costPerResult !== null ? formatCurrency(summary.costPerResult) : "—";
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
  editToggleId,
  returnTo,
  newReviewHref,
}: {
  sprint: SprintFinancials;
  performance?: SprintPerformanceProps;
  clientId: string;
  isAdmin: boolean;
  sourceTimestampText: string | null;
  isManualSource: boolean;
  revertSourceToggleId: string;
  /** Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 10): subiu pra
   * `SprintCardBody` (mesmo padrão de `revertSourceToggleId`, computado ali
   * e passado como prop) porque a linha "Próxima ação" precisa referenciar
   * este MESMO id a partir de um `<label htmlFor>` fora desta seção — um
   * `<label>` aciona o checkbox por id independente de posição no DOM,
   * então não precisa ser irmão dele (diferente do `peer-checked:` usado
   * aqui dentro, que sim exige irmandade direta). */
  editToggleId: string;
  returnTo: string;
  /** MITZA Unified Activities 1.0 (correção de modelo de produto): revisão
   * de conta é um registro estruturado ligado à análise da conta — sua
   * ação de criação vive aqui, dentro de Performance, nunca no cabeçalho
   * da fila "Atividades" (que é só leitura). Opcional: quem não busca
   * `account_reviews` simplesmente não vê a ação. */
  newReviewHref?: string;
}) {
  const view = performance?.view ?? { kind: "not_configured" as const };
  const cells = derivePerformanceCellTexts(view);
  const editableChannels = performance?.editableChannels ?? [];
  const performanceGoal = performance?.performanceGoal ?? null;
  // Etapa "Sprint Workspace Polish 1.0" (Parte 8): rótulo da coluna de custo
  // é sempre CPA/CPL quando o objetivo já está configurado — mesmo antes de
  // existir qualquer dado lançado (`not_started`/`no_data`) — e cai pro
  // rótulo genérico só quando não há objetivo pra saber qual dos dois é.
  const costLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].costMetricShortLabel : "Custo por resultado";
  const canEditResults = isAdmin && (view.kind === "has_data" || view.kind === "no_data") && editableChannels.length > 0;
  const investmentSourceText = sourceTimestampText ?? (isManualSource ? "Manual" : "Meta");
  const performanceSourceText =
    view.kind === "has_data" ? getLatestPerformanceUpdateText(view.summary.latestSource, view.summary.latestUpdatedAt, formatShortDateTime) : null;

  // Executive Dashboard 1.0: proveniência do dado (fonte/timestamp) é
  // informação de auditoria — consultada raramente, nunca a primeira coisa
  // que o gestor olha no card. Sai da linha sempre-visível e vira o title
  // (tooltip nativo) do próprio rótulo "Performance da sprint", liberando
  // uma linha inteira sem remover a informação nem a funcionalidade.
  const sourceTooltip = performanceSourceText
    ? `Investimento: ${investmentSourceText}\nResultados: ${performanceSourceText}`
    : investmentSourceText;

  // Refinamento de Densidade, Hierarquia e Contexto Operacional — Parte 1:
  // uma linha horizontal só (era 3 colunas empilhadas + linha de fonte +
  // toggle "Atualizar performance" em linhas separadas). "·" como separador
  // discreto entre métricas, igual ao já usado em outras linhas compactas da
  // plataforma (ex.: resumo de alertas).
  //
  // Etapa "Sprint Workspace Polish 1.0" (Partes 6-9) — toolbar operacional:
  // "Resultados"/"CPA"/"CPL" ganharam rótulo explícito sempre visível (nunca
  // mais "Sem dados · Sem dados" sem dizer qual é qual — Parte 8), inclusive
  // no estado sem objetivo configurado (a linha nunca "encolhe", sempre a
  // mesma forma — Parte 9). "Objetivo" virou rótulo + badge (Parte 7,
  // clicável só pra admin). "Atualizar performance" virou um botão de
  // verdade no fim da linha (Parte 6), não mais um link azul solto.
  //
  // Etapa "Sprint Workspace Polish 1.1" (Parte 2): "R$ X investido" virou
  // "Investido: R$ X" — mesmo padrão rótulo:valor de Resultados/CPA/CPL,
  // nunca mais um campo com forma diferente dos outros na mesma toolbar.
  // Padding/gaps reduzidos (Parte 2/4) sem perder legibilidade.
  //
  // Etapa "Sprint Workspace Density 1.0": padding reduzido mais uma vez
  // (`px-2.5 py-1.5` → `px-2 py-1`) — nenhuma informação a menos, só menos
  // espaço morto ao redor do texto. Tipografia e área de clique intactas.
  return (
    <div className="rounded-lg border border-border bg-zinc-50 px-2 py-1 dark:bg-zinc-900/40">
      {/* Os dois checkboxes-hack (revert de fonte manual / editar performance)
          precisam ser IRMÃOS diretos dos blocos que eles revelam
          (`peer-checked:`/`peer-checked/revert:` dependem do seletor de
          irmão geral do CSS — não funciona atravessando um nível de
          aninhamento). Por isso ficam aqui fora, antes da linha compacta;
          os <label> que os acionam continuam dentro da linha, referenciando
          por `htmlFor` (isso não exige irmandade). */}
      {isManualSource && <input type="checkbox" id={revertSourceToggleId} className="peer/revert hidden" />}
      {isAdmin && <input type="checkbox" id={editToggleId} className="peer hidden" />}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span
          title={sourceTooltip}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Performance
        </span>

        <span className="text-muted-foreground">Investido:</span>
        <span className="font-semibold text-foreground">{formatCurrency(sprint.actualSpend)}</span>

        <span className="text-border" aria-hidden="true">
          ·
        </span>
        <span className="text-muted-foreground">Resultados:</span>
        <span className="font-semibold text-foreground">{cells.resultsValue}</span>
        {cells.resultsAux && <span className="text-muted-foreground">({cells.resultsAux})</span>}

        <span className="text-border" aria-hidden="true">
          ·
        </span>
        <span className="text-muted-foreground">{costLabel}:</span>
        <span className="font-semibold text-foreground">{cells.costValue}</span>
        {cells.costAux && (
          <span
            className={`font-medium ${cells.costAux.tone ? PERFORMANCE_STATUS_TEXT_CLASSES[cells.costAux.tone] : "text-muted-foreground"}`}
          >
            ({cells.costAux.text})
          </span>
        )}

        <span className="text-border" aria-hidden="true">
          ·
        </span>
        <span className="text-muted-foreground">Objetivo:</span>
        {isAdmin ? (
          <ClientPerformanceGoalEditor clientId={clientId} currentGoal={performanceGoal} />
        ) : (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground">
            {performanceGoal ? PERFORMANCE_GOALS[performanceGoal].label : "Não configurado"}
          </span>
        )}

        {isManualSource && (
          <>
            <span className="text-border" aria-hidden="true">
              ·
            </span>
            <label
              htmlFor={revertSourceToggleId}
              className="cursor-pointer text-muted-foreground hover:underline peer-checked/revert:hidden"
            >
              Usar dado do Meta
            </label>
          </>
        )}

        {(newReviewHref || isAdmin) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {newReviewHref && (
              <Link href={newReviewHref} scroll={false} className={SECONDARY_ACTION_BUTTON_CLASSES}>
                + Registrar revisão
              </Link>
            )}
            {isAdmin && (
              <label
                htmlFor={editToggleId}
                className="mitza-pressable shrink-0 cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-brand hover:bg-brand/5 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand peer-checked:hidden"
              >
                Atualizar performance
              </label>
            )}
          </span>
        )}
      </div>

      {isManualSource && (
        <div className="mt-1 hidden items-center gap-1.5 text-xs peer-checked/revert:flex">
          <span className="text-muted-foreground">Substituir valor manual pelo do Meta?</span>
          <form action={resetSprintSpendSourceAction.bind(null, sprint.sprintId, clientId, returnTo)}>
            <SubmitButton
              className="rounded font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              pendingChildren="Confirmando..."
            >
              Confirmar
            </SubmitButton>
          </form>
          <label htmlFor={revertSourceToggleId} className="cursor-pointer text-muted-foreground hover:underline">
            Cancelar
          </label>
        </div>
      )}

      {isAdmin && (
        <form
          action={updateSprintPerformanceAction.bind(null, sprint.sprintId, clientId, returnTo)}
          className="mt-1.5 hidden flex-col gap-1.5 peer-checked:flex"
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
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-brand hover:bg-brand/5 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              pendingChildren="Salvando..."
            >
              Salvar
            </SubmitButton>
            <label htmlFor={editToggleId} className="cursor-pointer text-[11px] text-muted-foreground hover:underline">
              Cancelar
            </label>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Conteúdo investigativo de uma sprint (Etapa 44: "card aberto = investigação
 * e execução") — "Performance da sprint" (investimento + resultado + custo,
 * Etapa 74), "Execução da sprint" (tarefas + otimizações, Etapa 74),
 * comentários e "abrir cliente". Extraído de dentro do próprio `<details>` de
 * `SprintCard` pra poder ser reaproveitado também pelo card compacto de conta
 * da tela Sprints (Sprint atual), que precisa do mesmo conteúdo de
 * investigação mas sob um `<details>` próprio, com um resumo fechado
 * diferente (mais simples) — nunca uma segunda implementação do
 * financeiro/performance/tarefas/otimizações/comentários da sprint.
 *
 * Etapa "Simplificação da Área Operacional da Sprint" (Parte 1): a Sprint
 * deixou de exibir a lista de alertas (`AttentionAlert[]`) — a lógica e o
 * cálculo continuam intactos em `buildAttentionAlerts`/`computeAccountHealth`
 * (ainda alimentam `accountHealth`, `priorityTier` e a fila de prioridades),
 * só a apresentação aqui dentro foi removida: a Sprint é área de execução,
 * não painel de alertas.
 */
export function SprintCardBody({
  sprint,
  comments,
  clientId,
  isAdmin,
  tasks,
  executionLabel,
  executionSeverity,
  openClientHref,
  buildTaskHref,
  accountReviews,
  newReviewHref,
  buildReviewDetailHref,
  manualSpendUpdatedAt,
  metaSyncedAt,
  performance,
  returnTo,
  hideNextAction,
}: {
  sprint: SprintFinancials;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
  openClientHref?: string;
  buildTaskHref?: (taskId: string) => string;
  /** Pra onde voltar depois de salvar investimento/performance (Etapa MVP
   * 1.3) — a página do cliente passa a própria URL, a tela Sprints passa a
   * URL atual dela (view/grouping/filtros preservados); nunca mais um
   * redirect fixo pra `/clients/{id}`. */
  returnTo: string;
  /** Otimizações desta sprint (Etapa 57/74) — opcional: só quem já consulta
   * account_reviews passa isto (mesmo padrão de `executionLabel`, nem toda
   * tela que usa este componente precisa). */
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
   * de `accountReviews`. */
  performance?: SprintPerformanceProps;
  /** Etapa "MITZA Operational Workspace 1.0" — a página do cliente promoveu
   * "Próxima ação" da sprint atual pro topo da página (`SprintFocusBar`,
   * primeiro conteúdo operacional, antes de qualquer scroll), então passa
   * `true` só pra ela, pra não repetir a mesma frase duas vezes na mesma
   * tela. O cálculo (`computeNextAction`) continua rodando normalmente —
   * só a renderização deste bloco é omitida; o painel Sprints não passa
   * esta prop, então continua exatamente como antes. */
  hideNextAction?: boolean;
}) {
  const sourceTimestampText = describeSpendSourceTimestamp(
    sprint.spendSource,
    manualSpendUpdatedAt,
    metaSyncedAt,
    formatShortDateTime,
  );
  const revertSourceToggleId = `revert-source-${sprint.sprintId}`;
  const editToggleId = `edit-performance-${sprint.sprintId}`;
  const isManualSource = sprint.spendSource === "manual";

  // Etapa "Instant Action & Context Memory 1.0" (hoje em `ActivitySection`,
  // que absorveu o que antes era `SprintTaskList`): Client Component
  // (precisa de `useOptimistic` pra contador/progresso reagirem junto com o
  // check da linha — Parte 2/5). Uma função não pode atravessar a
  // fronteira servidor→cliente como prop, então em vez de repassar
  // `buildTaskHref` (closure) pra ela, calculamos aqui — ainda no servidor —
  // o PREFIXO de string equivalente (chamando a própria função com
  // `taskId=""`, já que as duas fórmulas existentes hoje só concatenam o id
  // no final) e passamos só essa string, serializável. Nenhuma URL gerada
  // muda — é o mesmo destino de sempre, só a forma de entregar o dado pra
  // um Client Component é que precisou mudar.
  const taskHrefPrefix = buildTaskHref ? buildTaskHref("") : `/clients/${clientId}?task=`;

  // MITZA Unified Activities 1.0 — CORREÇÃO CRÍTICA: mesmo motivo do
  // `taskHrefPrefix` acima. `ActivitySection` (Client Component) não pode
  // receber `buildReviewDetailHref` como função — só o PREFIXO de string
  // equivalente, serializável. Nenhuma URL gerada muda.
  const reviewHrefPrefix = buildReviewDetailHref ? buildReviewDetailHref("") : undefined;

  // Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 10): "Próxima
  // ação" só na sprint atual — é o ponto onde o gestor de fato começa o dia
  // (fluxo "cliente → contexto atual → próxima ação → execução" do pedido).
  // Sprints futuras/concluídas não entram: mostrar a mesma recomendação em
  // toda sprint visível na tela (ex.: "Mensal por Sprints" lista várias)
  // duplicaria a mesma ação repetida em cada uma, o que a Parte 2 e a regra
  // "não duplicar uma ação já evidente" da própria Parte 10 proíbem.
  const isCurrent = sprint.temporalStatus === "atual";
  const nextAction = isCurrent
    ? computeNextAction({
        tasks,
        today: todayDateString(),
        performanceViewKind: performance?.view.kind ?? null,
        performanceGoal: performance?.performanceGoal ?? null,
        optimizationCount: accountReviews ? accountReviews.length : null,
        canConfigureObjective: isAdmin,
      })
    : null;

  return (
    <div className="border-t border-border p-1.5">
        {/* MITZA Operational Card Architecture 2.0 (Steve Jobs Review):
            "Próxima ação" abre o corpo expandido — é a única pergunta que a
            Sprint aberta precisa responder de cara ("o que eu faço agora?").
            "Última execução" só aparece quando exige atenção (ver abaixo).
            Performance virou um disclosure (mais abaixo): é informação de
            CONSULTA ("como estão os números"), não a decisão em si — nasce
            escondida, exatamente como Comentários já nascia. Nenhum dado ou
            cálculo mudou, só a ordem e o que fica visível sem clique. */}
        <div className="flex flex-col gap-1">
          {/* Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 10): "Próxima
              ação" — uma única recomendação executável, nunca um alerta (sem
              vermelho, sem "crítico"/"atenção", nunca uma lista). Cada destino
              reaproveita uma ação JÁ existente na própria Sprint: tarefa leva
              direto à tarefa, "Atualizar performance" abre o MESMO formulário
              de sempre (via o mesmo `editToggleId` que o botão da toolbar
              usa), "Configurar objetivo" reaproveita o próprio
              `ClientPerformanceGoalEditor` (2ª instância montada, mesmo
              componente/Server Action — nunca uma segunda implementação), e
              "Registrar otimização" reaproveita `newReviewHref`. Nenhum dado
              novo, nenhuma tarefa criada automaticamente. */}
          {!hideNextAction && nextAction && nextAction.kind !== "none" && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-muted-foreground">Próxima ação:</span>
              {nextAction.taskId ? (
                <>
                  <span className="text-foreground">{nextAction.text}</span>
                  <Link
                    href={buildTaskHref ? buildTaskHref(nextAction.taskId) : `/clients/${clientId}?task=${nextAction.taskId}`}
                    scroll={false}
                    className={SECONDARY_ACTION_BUTTON_CLASSES}
                  >
                    Abrir tarefa
                  </Link>
                </>
              ) : nextAction.kind === "update_performance" && isAdmin ? (
                <label htmlFor={editToggleId} className={`${SECONDARY_ACTION_BUTTON_CLASSES} cursor-pointer`}>
                  {nextAction.text}
                </label>
              ) : nextAction.kind === "configure_objective" ? (
                <ClientPerformanceGoalEditor
                  clientId={clientId}
                  currentGoal={performance?.performanceGoal ?? null}
                  triggerClassName={SECONDARY_ACTION_BUTTON_CLASSES}
                  triggerLabel={nextAction.text}
                />
              ) : nextAction.kind === "register_optimization" && newReviewHref ? (
                <Link href={newReviewHref} scroll={false} className={SECONDARY_ACTION_BUTTON_CLASSES}>
                  {nextAction.text}
                </Link>
              ) : (
                <span className="text-muted-foreground">{nextAction.text}</span>
              )}
            </div>
          )}
          {!hideNextAction && nextAction && nextAction.kind === "none" && (
            <p className="text-xs text-muted-foreground">Próxima ação: {nextAction.text}</p>
          )}

          {/* MITZA Operational Card Architecture 2.0: "Última execução" só
              nasce visível quando sinaliza atenção/crítico — no caso neutro
              (sprint sendo executada normalmente) ela não respondia a
              nenhuma decisão, só ocupava uma linha porque "havia espaço",
              o que o Princípio 2 desta etapa proíbe explicitamente. O
              cálculo (`sprintExecutionInfo`/severidade) continua o mesmo;
              só a condição de exibição mudou. */}
          {executionLabel && executionSeverity && (
            <p className={`text-xs ${EXECUTION_LABEL_CLASSES[executionSeverity]}`}>
              Última execução: {executionLabel}
            </p>
          )}
        </div>

        {/* "Atividades" (MITZA Unified Activities 1.0) — fila única de
            trabalho da Sprint: tarefa e revisão de conta convivem na mesma
            lista, uma linha por atividade, cada uma com o componente
            oficial do próprio domínio (`TaskRow`/`AccountReviewRow`).
            Substitui a antiga divisão "Tarefas" | "Revisões de conta" (duas
            colunas lado a lado, cada uma com cabeçalho e estado vazio
            próprios) — é o motivo real pelo qual alguém abre uma Sprint,
            por isso continua sempre visível, nunca atrás de disclosure. */}
        <div className="mt-1.5">
          <ActivitySection
            tasks={tasks}
            clientId={clientId}
            sprintId={sprint.sprintId}
            taskHrefPrefix={taskHrefPrefix}
            isAdmin={isAdmin}
            reviews={accountReviews}
            reviewHrefPrefix={reviewHrefPrefix}
          />
        </div>

        {/* MITZA Operational Card Architecture 2.0: Performance virou um
            disclosure — mesmo padrão exato de Comentários logo abaixo
            (botão pill + chevron, conteúdo revelado só com intenção). O
            resumo já visível na linha fechada da Sprint (`formatCompactPerformanceText`,
            no `<summary>` acima) cobre o "olhar rápido"; o que está aqui
            dentro é comparação com meta + as ações de edição — informação
            de consulta, nunca a decisão em si. Nenhum número, fórmula ou
            ação mudou, só deixou de ficar sempre montada como uma caixa
            cheia permanente. */}
        <details className="group mt-1.5 border-t border-border pt-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="mitza-pressable inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-brand hover:bg-brand/5 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <span className="mitza-chevron text-xs text-muted-foreground group-open:rotate-90">▸</span>
            Performance
          </summary>
          <div className="mt-1.5">
            <SprintPerformanceSection
              sprint={sprint}
              performance={performance}
              clientId={clientId}
              isAdmin={isAdmin}
              sourceTimestampText={sourceTimestampText}
              isManualSource={isManualSource}
              returnTo={returnTo}
              revertSourceToggleId={revertSourceToggleId}
              editToggleId={editToggleId}
              newReviewHref={newReviewHref}
            />
          </div>
        </details>

        {/* Etapa "Sprint Workspace Polish 1.1" (Parte 1): botão secundário de
            verdade — mesma altura, borda, hover e focus-visible de
            "Atualizar performance" — em vez de um texto sublinhado que
            parecia um link solto. Ação inalterada: continua só um
            `<details>` nativo revelando os comentários, agora com o
            chevron padrão de accordion já usado no resto da plataforma.
            Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 6):
            "Ver detalhes da sprint" renomeado pra "Comentários" — auditado
            e confirmado que esta ação nunca revelou nada além da lista de
            comentários (`CommentThread`), então o nome genérico só
            escondia o que de fato tinha ali. Contador reaproveita
            `comments.length`, já calculado — nenhuma contagem nova. */}
        <details
          id={`comments-${sprint.sprintId}`}
          className="group mt-1 border-t border-border pt-1 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="mitza-pressable inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-brand hover:bg-brand/5 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <span className="mitza-chevron text-xs text-muted-foreground group-open:rotate-90">▸</span>
            Comentários{comments.length > 0 ? ` · ${comments.length}` : ""}
          </summary>
          <div className="mt-1.5">
            <CommentThread
              comments={comments}
              commentableType="sprint"
              commentableId={sprint.sprintId}
              clientId={clientId}
            />
          </div>
        </details>

        {openClientHref && (
          <div className="mt-1 border-t border-border pt-1 text-xs">
            <Link
              href={openClientHref}
              className="mitza-pressable inline-block rounded text-muted-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
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
 * - `openClientHref`: só o painel Sprints passa ("Abrir cliente" não faz
 *   sentido dentro da própria página do cliente).
 * - `buildTaskHref`: como cada tela abre o drawer de tarefa a partir de uma
 *   URL diferente (a própria página do cliente vs. o painel Sprints
 *   preservando filtros/mês/modo), quem chama decide a URL; o padrão
 *   preserva o comportamento já existente na página do cliente.
 *
 * Etapa "Simplificação da Área Operacional da Sprint": esta função não
 * recebe mais `alerts` — a lista de alertas deixou de ser exibida dentro da
 * Sprint (ver doc de `SprintCardBody`).
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
  accordionRowsPrototype,
  hideNextAction,
}: {
  sprint: SprintFinancials;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
  defaultOpen?: boolean;
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
  /** Etapa "MITZA Operational Workspace 1.0" — ver doc de `SprintCardBody`. */
  hideNextAction?: boolean;
}) {
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const isCurrent = sprint.temporalStatus === "atual";
  const isOpen = defaultOpen ?? isCurrent;

  return (
    <details
      id={`sprint-${sprint.sprintId}`}
      // Etapa "Instant Action & Context Memory 1.0" (Parte 9): continua
      // `open={isOpen}`, não uma prop "default" — React não existe pra
      // `<details>` (só `value`/`checked` têm essa dualidade controlada/
      // não-controlada). Isso continua seguro porque o React só reaplica
      // um atributo quando o VALOR da prop muda entre renders; `isOpen`
      // (derivado de `sprint.temporalStatus`, estável durante a sessão)
      // não muda sozinho entre revalidações, então nem o toggle manual do
      // usuário nem a restauração de contexto via DOM
      // (`SprintsContextMemory`) são desfeitos pelas novas ações otimistas
      // que chamam `revalidatePath`.
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
          na seção mensal "Investimento do mês"). Ordem: período → investido →
          status temporal → tarefas → otimizações. O próprio badge temporal já
          cobre "status operacional" (Sprint atual/Concluída/Futura) — nunca
          um segundo selo Acima/Abaixo/Dentro/Sem planejamento aqui, essas
          classificações são só do nível mensal.
          Sprint UX 2.0 Fase 3: em modo `flat` (só a tela Sprints usa), essa
          linha usa o mesmo grid de colunas da linha do cliente
          (`ROW_GRID_CLASSES`) — a 1ª coluna (Cliente/Gestor na linha do
          cliente) mostra aqui o período desta sprint (a indentação do
          wrapper do grupo já comunica "isto é filho do cliente", então a
          coluna nunca fica ociosa); Investimento/Status/Tarefas/Otimizações
          caem exatamente sob as mesmas colunas de cima (MITZA Operational
          Tables 1.0: esta é a única lista da plataforma onde o período segue
          existindo como coluna própria, porque é a única onde ele de fato
          diferencia elementos entre si — cada sprint do mês tem sua própria
          janela). A página do cliente nunca passa `flat`, então mantém a
          linha corrida de sempre. */}
      {flat ? (
        <summary className="flex cursor-pointer list-none items-start gap-2 px-2 py-1">
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
              {!(sprint.temporalStatus === "futura" && sprint.actualSpend === 0) && (
                <span className="tabular-nums text-muted-foreground">{formatCurrency(sprint.actualSpend)} investidos</span>
              )}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
              >
                {TEMPORAL_LABEL[sprint.temporalStatus]}
              </span>
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
                (`ROW_GRID_CLASSES`) — ver doc acima: a 1ª coluna mostra o
                período desta sprint; Investimento/Status/Tarefas/Otimizações
                caem exatamente sob as mesmas colunas de cima. */}
            <div className={ROW_GRID_CLASSES}>
              <span aria-hidden="true" />
              <span className="truncate text-xs font-medium text-foreground">
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
              <span
                className={`block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
              >
                {TEMPORAL_LABEL[sprint.temporalStatus]}
              </span>
              <span className="truncate text-xs tabular-nums text-muted-foreground">
                {tasks.length === 0 ? "—" : `${tasksDone}/${tasks.length}`}
              </span>
              <span className="truncate text-xs tabular-nums text-muted-foreground">
                {accountReviews ? (accountReviews.length === 0 ? "—" : accountReviews.length) : ""}
              </span>
            </div>
          </div>
        </summary>
      ) : (
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5">
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
              openClientHref={openClientHref}
              buildTaskHref={buildTaskHref}
              accountReviews={accountReviews}
              newReviewHref={newReviewHref}
              buildReviewDetailHref={buildReviewDetailHref}
              manualSpendUpdatedAt={manualSpendUpdatedAt}
              metaSyncedAt={metaSyncedAt}
              performance={performance}
              returnTo={returnTo}
              hideNextAction={hideNextAction}
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
          openClientHref={openClientHref}
          buildTaskHref={buildTaskHref}
          accountReviews={accountReviews}
          newReviewHref={newReviewHref}
          buildReviewDetailHref={buildReviewDetailHref}
          manualSpendUpdatedAt={manualSpendUpdatedAt}
          metaSyncedAt={metaSyncedAt}
          performance={performance}
          returnTo={returnTo}
          hideNextAction={hideNextAction}
        />
      )}
    </details>
  );
}
