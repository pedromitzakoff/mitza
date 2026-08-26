import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent, formatDayShortMonth } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import {
  computeExpectedPct,
  formatDeviationCurrencyText,
  resolveMonthPeriodSummary,
  type FinancialPeriodSummary,
} from "@/lib/financial-period";
import {
  computeMonthlyBudgetPlan,
  computeUtilizedPct,
  type MonthlyBudgetPlanSprintInput,
  type MonthTemporalStatus,
} from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import { ChannelPlanEditor } from "./channel-plan-editor";

export interface MonthlyBudgetChangeSummary {
  lastEffectiveDate: string;
  lastPreviousAmount: number;
  lastNewAmount: number;
  changeCountThisMonth: number;
}

/** Diferença em pontos percentuais com sinal explícito ("+2,10 p.p."/
 * "-4,25 p.p.") — só formatação, nunca uma conta nova: sempre aplicado a
 * `pctRealizado - expectedPct`, os dois já calculados por quem chama. */
const percentagePointsFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

/**
 * Barra "autoexplicativa" (Etapa "Card de ritmo do orçamento"): a barra em
 * si e o marcador continuam exatamente `AgencyInvestmentBar`, sem nenhuma
 * alteração — este wrapper só soma um tooltip por cima (hover E foco de
 * teclado via `tabIndex`/CSS `group-hover`+`group-focus`, sem JS), com o
 * mesmo texto que já aparecia em "Ver detalhes do investimento". Vive só
 * neste arquivo (nunca em `agency-investment-bar.tsx`) de propósito: a
 * barra é compartilhada por Visão Geral/Sprints/Relatório, e esta etapa
 * pediu explicitamente pra não alterar essas telas.
 */
function InvestmentBarWithTooltip({
  summary,
  monthTemporalStatus,
  tooltipText,
}: {
  summary: FinancialPeriodSummary;
  monthTemporalStatus?: MonthTemporalStatus;
  tooltipText: string;
}) {
  return (
    <div
      className="group/investmentbar relative mt-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      tabIndex={0}
      aria-label={tooltipText}
    >
      <AgencyInvestmentBar summary={summary} monthTemporalStatus={monthTemporalStatus} showLegend={false} />
      {/* Só visual — o nome acessível já vem do aria-label no wrapper acima,
          então este bloco fica fora da árvore de acessibilidade pra não
          duplicar o anúncio pra leitor de tela. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 w-60 whitespace-pre-line rounded-md border border-overview-border bg-overview-surface p-2 text-[11px] text-overview-text-primary opacity-0 shadow-lg transition-opacity duration-150 group-hover/investmentbar:opacity-100 group-focus/investmentbar:opacity-100"
      >
        {tooltipText}
      </div>
    </div>
  );
}

/**
 * Bloco 1 da hierarquia da página do cliente — "Investimento do mês"
 * (Etapa 58: unifica neste único card o que antes eram dois — o resumo
 * financeiro e o card separado "Orçamento de [mês]"/edição — removendo o
 * valor planejado duplicado entre eles).
 *
 * Etapa 66: a "orçamento mensal vigente" (`planned`) e o "planejamento
 * restante" nunca mais vêm de `sprint_planned_allocations` — sempre de
 * `computeMonthlyBudgetPlan`, a única função central que decide "quanto ainda
 * pode ser investido este mês" (mesmos números, nenhuma fórmula nova).
 * `classifySpendStatus`/`SPEND_STATUS_*` continuam intactos e em uso em
 * Visão Geral, Sprints e Relatório — não fazem parte desta seção.
 *
 * Refinamento visual (Etapa 73): as informações de diagnóstico (percentual
 * realizado/esperado detalhado, esperado em reais, diferença para o ritmo,
 * explicação do dia atual) saíram do card sempre visível e passaram pra
 * "Ver detalhes do investimento", recolhida por padrão — mesmo padrão de
 * disclosure (`<details>/<summary>` nativo) já usado em "Histórico" dos
 * comentários/análises. Nenhuma fórmula mudou: os mesmos valores só
 * passaram a ter uma única apresentação (nunca mais a mesma diferença
 * repetida em duas frases — a barra deixou de mostrar sua própria
 * legenda/desvio aqui via `showLegend={false}`, unificando tudo dentro dos
 * detalhes).
 *
 * Etapa "Revisão de disclosure da Visão Geral do cliente": a legenda de
 * cores (Realizado/Esperado hoje) voltou a ficar sempre visível, logo
 * abaixo da barra — 2 rótulos curtos não justificam um clique, e ficar
 * escondida obrigava quem olha o card a adivinhar o que cada cor significa
 * antes de abrir os detalhes. O resto do disclosure (números de
 * acompanhamento, regra da projeção) continua recolhido — é diagnóstico
 * denso, não uma legenda.
 *
 * Etapa "Visão Geral: decisão em 5 segundos" (2ª rodada): mesma linguagem
 * visual do novo card "Performance" (`MonthlyGoalProgress`) — realizado/
 * planejado + % no topo, barra, status de ritmo (bolinha colorida) ao lado
 * de "Restam/Dias" numa única linha, e só então o rodapé de ações. O valor
 * "Ritmo: RX/dia" (recomendação diária) saiu da área sempre visível e
 * passou a viver dentro de "Ver detalhes do investimento" — nenhum cálculo
 * mudou (`plan.recommendedDaily` continua o mesmo), só a exibição por
 * padrão ficou mais enxuta. Nenhum texto de diagnóstico foi reescrito
 * (`diagnosisText`/`formatDeviationCurrencyText` continuam os mesmos) — só
 * reposicionado pra depois da barra, com o mesmo indicador de bolinha que
 * o card de Performance usa.
 *
 * A borda/fundo do "card" saiu daqui — `[id]/page.tsx` agora envolve este
 * componente E `AccountFollowUpPanel` numa ÚNICA superfície (pedido
 * explícito do usuário: "evitar caixa dentro de caixa"); este vira só mais
 * uma SEÇÃO dela (rótulo "Investimento"), nunca um card próprio empilhado.
 * Nenhuma prop, cálculo ou lógica interna mudou.
 *
 * Etapa "Primeira dobra: Performance e Investimento lado a lado":
 * `AccountFollowUpPanel` passou a receber este componente pronto via slot
 * (`investmentSummary`, um `ReactNode` montado por `[id]/page.tsx` — mesmo
 * padrão já usado por `channelSwitch`) e a colocá-lo numa coluna ao lado de
 * "Performance" (`MonthlyGoalProgress`) num grid responsivo — por isso a
 * divisória/margem superior que existia aqui (`mt-3 border-t ...`, pensada
 * pra empilhar embaixo dos KPIs) saiu: o espaçamento entre as duas colunas
 * agora é responsabilidade do grid, nunca deste componente. `%` ganhou mais
 * destaque tipográfico (era `text-sm`) pra ficar comparável de relance com
 * o `%` de Performance — mesmo valor de sempre, só maior.
 */
export function MonthInvestmentSummary({
  planned,
  actual,
  expectedToDate,
  status,
  clientId,
  monthParam,
  monthLabel,
  sprints,
  monthRange,
  effectiveDate,
  isAdmin,
  isClosedMonth,
  isClosedByHorizonOnly,
  isFutureMonth,
  lastChange,
  historyHref,
  performanceGoal,
  channels,
  byChannel,
  calendarMonthRange,
  currentPlanningEndDate,
}: {
  /** Orçamento mensal VIGENTE (Etapa 66) — sempre `resolveMonthlyBudget`,
   * nunca a soma dos planejamentos diários persistidos. */
  planned: number;
  actual: number;
  expectedToDate: number;
  status: SpendStatus;
  clientId: string;
  monthParam: string;
  monthLabel: string;
  sprints: MonthlyBudgetPlanSprintInput[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string | null;
  isAdmin: boolean;
  isClosedMonth: boolean;
  /** Etapa "Horizonte de Planejamento": `true` quando `isClosedMonth` veio
   * do horizonte de evento (mês civil ainda em andamento, só a campanha já
   * terminou) — só decide o TEXTO do rodapé ("Mês encerrado" x "Período de
   * planejamento encerrado"), nunca nenhum cálculo. */
  isClosedByHorizonOnly: boolean;
  /** Etapa 64: mês selecionado ainda não começou (`!isCurrentMonth &&
   * !isClosedMonth` — já calculado uma vez na página, nunca uma segunda
   * comparação de datas aqui) — muda o texto principal e a recomendação
   * diária vira "investimento diário planejado inicial" (seção 11). */
  isFutureMonth: boolean;
  lastChange: MonthlyBudgetChangeSummary | null;
  historyHref: string;
  performanceGoal: PerformanceGoal | null;
  /** Etapa "Planejamento por Canal": canais selecionáveis (Meta/Google) e o
   * plano vigente de cada um — repassados direto pro `ChannelPlanEditor`,
   * nunca recalculados aqui (este componente só mostra o consolidado). */
  channels: TrafficChannel[];
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  /** Etapa "Horizonte de Planejamento": mês CIVIL inteiro (nunca o horizonte
   * já encurtado, que é o que `monthRange` acima passou a ser) — só pro
   * `ChannelPlanEditor` montar o seletor de data e o rótulo "Período de
   * planejamento". */
  calendarMonthRange: { firstDay: string; lastDay: string };
  currentPlanningEndDate: string | null;
}) {
  // A barra (sem marcador) ainda usa o formato central `FinancialPeriodSummary`
  // só pra decidir preenchimento/estouro — nenhum outro campo dele (status,
  // expectedToDate) é lido por esta seção.
  const summary = resolveMonthPeriodSummary({ monthPlanned: planned, monthActual: actual, monthExpectedToDate: expectedToDate, monthStatus: status }, monthLabel, monthRange);
  const utilizedPct = computeUtilizedPct(planned, actual);
  // RITMO (Etapa 68, seções 9/10) — "onde deveríamos estar hoje", sempre a
  // mesma fórmula central de calendário (`monthExpectedToDate`, já recebida
  // pronta via prop `expectedToDate`), nunca planejamento de sprint/histórico.
  const pctRealizado = planned > 0 ? (actual / planned) * 100 : null;
  const expectedPct = computeExpectedPct(summary);
  const ritmoDiff = actual - expectedToDate;
  // Etapa 73, seção 17: uma única apresentação da diferença (linha "Diferença
  // para o ritmo" dentro dos detalhes) — nunca mais repetida como "abaixo do
  // investimento esperado até hoje" (era o texto da própria barra, agora
  // suprimido via `showLegend={false}`) e como "abaixo do ritmo esperado" ao
  // mesmo tempo.
  const ritmoDiffText =
    ritmoDiff < 0 ? `${formatCurrency(Math.abs(ritmoDiff))} abaixo` : ritmoDiff > 0 ? `${formatCurrency(ritmoDiff)} acima` : "Sem diferença";
  // Só existe recomendação diária quando há uma data de efeito vigente —
  // `effectiveDate` é `null` exatamente quando o mês está encerrado (seção 10:
  // mês passado nunca mostra recomendação diária).
  const plan = effectiveDate
    ? computeMonthlyBudgetPlan({ monthlyBudget: planned, monthActual: actual, monthRange, effectiveDate, sprints })
    : null;

  const closedDiffText = (() => {
    if (planned <= 0) return null;
    const diff = planned - actual;
    if (diff > 0) return `${formatCurrency(diff)} abaixo do orçamento planejado`;
    if (diff < 0) return `${formatCurrency(Math.abs(diff))} acima do orçamento planejado`;
    return "Orçamento utilizado integralmente";
  })();

  // Etapa 73: conteúdo de "Ver detalhes do investimento" — varia conforme o
  // estado temporal do mês (mesmos dados que já existiam em cada branch,
  // só reagrupados numa única área recolhível em vez de sempre visíveis).
  const hasDetails = planned > 0;

  // Etapa "Facelift do card de Investimento Mensal": o diagnóstico principal
  // (mês corrente, em andamento) reaproveita `formatDeviationCurrencyText` —
  // a MESMA frase central que a barra já produzia e ficava suprimida via
  // `showLegend={false}` — só promovida de dentro da barra pra virar o
  // destaque principal do card, nunca uma segunda lógica de diagnóstico.
  // Cor por tom reaproveita exatamente a mesma paleta já usada abaixo em
  // "Diferença para o ritmo" (dentro/acima/abaixo — mesmo `status` central
  // de `classifySpendStatus`).
  const diagnosisText = !isFutureMonth && !isClosedMonth ? formatDeviationCurrencyText(summary, formatCurrency) : null;
  const diagnosisToneClass =
    status === "acima"
      ? "text-red-600 dark:text-red-400"
      : status === "abaixo"
        ? "text-amber-600 dark:text-amber-400"
        : status === "dentro"
          ? "text-green-600 dark:text-green-400"
          : "text-overview-text-primary";

  // Etapa "Card de ritmo do orçamento": tooltip da barra — mesmas 5 linhas
  // que já viviam em "Ver detalhes do investimento" (Realizado/Esperado
  // hoje/Diferença), mais Investido/Planejado (já disponíveis como props),
  // nenhum valor novo.
  const diffPP = pctRealizado !== null ? pctRealizado - expectedPct : null;
  const barTooltipText = [
    `Investido: ${formatCurrency(actual)}`,
    `Planejado: ${formatCurrency(planned)}`,
    `Realizado: ${pctRealizado !== null ? formatPercent(pctRealizado) : "—"}`,
    `Esperado hoje: ${formatPercent(expectedPct)}`,
    `Diferença: ${diffPP !== null ? `${percentagePointsFormatter.format(diffPP)} p.p.` : "—"}`,
  ].join("\n");

  // Etapa "Visão Geral: decisão em 5 segundos" (2ª rodada): mesma condição
  // que já decidia se o diagnóstico aparecia (nunca em mês futuro/
  // encerrado/sem plano) — só não decide mais margem de "zona de contexto"
  // nenhuma (essa zona não existe mais), só se a linha de status é
  // renderizada.
  const showDiagnosis = planned > 0 && !isFutureMonth && !isClosedMonth && diagnosisText;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Investimento</p>

      {/* Badge de evento (Etapa "Horizonte de Planejamento" — impede o
          gestor de achar que ainda existem dias de operação até o fim do
          mês quando a campanha já terminou antes disso, ex.: Baile do
          Hawaii) — sempre no topo do conteúdo, independente do resto. Mesmo
          texto/condição de sempre, só a posição relativa mudou. */}
      {currentPlanningEndDate && (
        <p className="mb-2 mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Evento · até {formatDayShortMonth(currentPlanningEndDate)}
        </p>
      )}

      {planned <= 0 ? (
        <div className="mt-1.5">
          <EmptyState>Sem planejamento configurado para este mês.</EmptyState>
        </div>
      ) : (
        <div className="mt-1.5">
          {/* Cabeçalho — realizado/planejado + % (mesma linguagem visual do
              card "Performance", `MonthlyGoalProgress`): antes este número
              não aparecia aqui de propósito (evitar repetir o que
              `MonthlyKpiSummary` já mostrava) — mas o KPI principal mostra
              só o investido, nunca a proporção contra o planejado do mês,
              então esta linha não duplica informação, complementa. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm text-overview-text-secondary">
              <span className="font-semibold text-overview-text-primary">
                {formatCurrency(actual)} / {formatCurrency(planned)}
              </span>
            </p>
            {pctRealizado !== null && <p className="text-xl font-bold text-overview-text-primary">{Math.round(pctRealizado)}%</p>}
          </div>

          {/* Barra + marcador de esperado (mesmo componente pros 3 estados
              temporais, só o `monthTemporalStatus` muda — nenhuma barra
              nova, nenhuma prop nova). Legenda de cores (Realizado/Esperado
              hoje) continua sempre visível logo abaixo — 2 rótulos curtos,
              pequenos demais pra justificar um clique. */}
          <div className="mt-1.5">
            <InvestmentBarWithTooltip
              summary={summary}
              monthTemporalStatus={isFutureMonth ? "futuro" : isClosedMonth ? "passado" : undefined}
              tooltipText={barTooltipText}
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-overview-text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-brand" aria-hidden="true" />
                Realizado
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-0.5 bg-navy dark:bg-white" aria-hidden="true" />
                Esperado hoje
              </span>
            </p>
          </div>

          {/* Status do ritmo (bolinha colorida, mesmo padrão do card
              "Performance") + Restam/Dias na mesma linha — só mês em
              andamento (mês futuro ainda não tem ritmo pra avaliar; mês
              encerrado já não tem "restam"). "Ritmo: RX/dia" (recomendação
              diária) saiu da área sempre visível — mesmo valor de sempre
              (`plan.recommendedDaily`), agora só dentro de "Ver detalhes do
              investimento". */}
          {!isFutureMonth && !isClosedMonth && plan && !plan.isBudgetReached && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {showDiagnosis && (
                <p className={`flex items-center gap-1.5 text-xs font-medium ${diagnosisToneClass}`}>
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  {diagnosisText}
                </p>
              )}
              <p className="text-xs text-overview-text-secondary">
                Restam {formatCurrency(plan.remainingBudget)} · {plan.eligibleDaysCount} dias
              </p>
            </div>
          )}
          {!isFutureMonth && !isClosedMonth && plan && plan.isBudgetReached && (
            <div className="mt-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Orçamento mensal atingido</p>
              {plan.overageAmount > 0 && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                  {formatCurrency(plan.overageAmount)} acima do orçamento planejado
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ZONA 4 — Ações: "Ver detalhes" à esquerda; "Editar planejamento"
          (ou o aviso de mês encerrado) e "Ver histórico" agrupados na MESMA
          região de ações à direita — antes "Ver histórico" vivia numa faixa
          própria abaixo deste rodapé, um elemento a mais espalhado pelo
          card. Mesmos textos/condições/links de sempre, só reagrupados. */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-t border-overview-border pt-2">
        {hasDetails ? (
          <details className="group/details min-w-0 flex-1 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[11px] font-medium text-overview-text-muted hover:text-overview-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-brand">
              <span className="mitza-chevron text-xs group-open/details:rotate-90">▸</span>
              <span className="group-open/details:hidden">Ver detalhes do investimento</span>
              <span className="hidden group-open/details:inline">Ocultar detalhes do investimento</span>
            </summary>

          <div className="mt-2 flex flex-col gap-3">
            {!isFutureMonth && !isClosedMonth && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">
                  Detalhes do acompanhamento
                </p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Realizado</p>
                    <p className="text-sm font-medium text-overview-text-primary">
                      {pctRealizado !== null ? formatPercent(pctRealizado) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Esperado hoje</p>
                    <p className="text-sm font-medium text-overview-text-primary">{formatPercent(expectedPct)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Esperado até hoje</p>
                    <p className="text-sm font-medium text-overview-text-primary">{formatCurrency(expectedToDate)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-overview-text-muted">Diferença para o ritmo</p>
                    <p
                      className={`text-sm font-medium ${
                        ritmoDiff < 0
                          ? "text-amber-600 dark:text-amber-400"
                          : ritmoDiff > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-overview-text-primary"
                      }`}
                    >
                      {ritmoDiffText}
                    </p>
                  </div>
                  {/* Etapa "Visão Geral: decisão em 5 segundos" (2ª rodada):
                      "Ritmo recomendado" saiu da área sempre visível do card
                      e passou a viver só aqui — mesmo valor de sempre
                      (`plan.recommendedDaily`), nenhum cálculo novo. */}
                  {plan && !plan.isBudgetReached && (
                    <div>
                      <p className="text-[11px] text-overview-text-muted">Ritmo recomendado</p>
                      <p className="text-sm font-medium text-overview-text-primary">{formatCurrency(plan.recommendedDaily)}/dia</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isClosedMonth && (utilizedPct != null || closedDiffText) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">
                  Detalhes do acompanhamento
                </p>
                {utilizedPct != null && (
                  <p className="mt-1 text-sm text-overview-text-primary">{Math.round(utilizedPct)}% do orçamento utilizado</p>
                )}
                {closedDiffText && <p className="mt-0.5 text-[11px] text-overview-text-muted">{closedDiffText}</p>}
              </div>
            )}

            {isFutureMonth && plan && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Ritmo planejado inicial</p>
                <p className="mt-1 text-sm font-medium text-overview-text-primary">{formatCurrency(plan.recommendedDaily)}/dia</p>
                <p className="mt-0.5 text-[11px] text-overview-text-muted">
                  {plan.eligibleDaysCount} dias em {monthLabel}
                </p>
              </div>
            )}

            {!isFutureMonth && !isClosedMonth && plan && !plan.isBudgetReached && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">
                  Regra da projeção
                </p>
                <p className="mt-1 text-[11px] text-overview-text-muted">
                  O cálculo considera o dia de hoje como disponível para ajuste.
                </p>
              </div>
            )}
          </div>
          </details>
        ) : (
          <span />
        )}

        <div className="flex shrink-0 flex-col items-end gap-1">
          {isAdmin &&
            (isClosedMonth ? (
              <span className="text-[11px] text-overview-text-muted">
                {isClosedByHorizonOnly ? "Período de planejamento encerrado" : "Mês encerrado"}
              </span>
            ) : (
              effectiveDate && (
                <ChannelPlanEditor
                  clientId={clientId}
                  monthParam={monthParam}
                  monthLabel={monthLabel}
                  monthRange={calendarMonthRange}
                  currentPlanningEndDate={currentPlanningEndDate}
                  channels={channels}
                  byChannel={byChannel}
                  performanceGoal={performanceGoal}
                />
              )
            ))}
          {isAdmin && lastChange && lastChange.changeCountThisMonth > 1 && (
            <Link href={historyHref} className="text-xs font-medium text-overview-text-primary hover:underline">
              Ver histórico
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
