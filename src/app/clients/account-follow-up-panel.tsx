import type { ReactNode } from "react";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { classifySpendStatus, RITMO_STATUS_TEXT, type SpendStatus } from "@/lib/spend-status";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
import { MonthlyGoalProgress } from "./monthly-goal-progress";
import { MonthInvestmentSummary } from "./month-investment-summary";
import { ResultsByChannel } from "./results-by-channel";

/**
 * Última otimização (Etapa 74) — substitui os antigos indicadores separados
 * "Última análise"/"Última otimização": otimização é a revisão estratégica
 * da conta em si (account_reviews), registrada mesmo quando nenhuma
 * alteração foi necessária — nunca dois indicadores pro mesmo evento.
 */
export interface LastOptimizationInfo {
  reviewedAt: string;
  managerName: string;
  outcome: AccountReviewOutcome;
  /** Tipos das alterações técnicas registradas (só quando outcome é
   * OPTIMIZATION_PERFORMED) — vazio nos demais casos. */
  optimizationTypes: OptimizationType[];
  /** Descrição do problema (só quando outcome é ISSUE_IDENTIFIED). */
  issueDescription: string | null;
}

/** Tom semântico do ritmo de RESULTADO — "acima" do esperado é tão bom
 * quanto "dentro" (mais resultado nunca é problema); só "abaixo" pede
 * atenção. Mesma distinção que `RITMO_TONE_CLASSES` já fazia dentro de
 * `MonthlyGoalProgress` antes desta etapa — só promovida a um tipo
 * nomeado, pra poder ser comparada com o tom de Investimento (que tem uma
 * régua diferente — ver abaixo). Nenhum limiar novo: deriva 100% do mesmo
 * `SpendStatus` que `classifySpendStatus` já devolvia. */
function resultRitmoTone(status: SpendStatus): "good" | "caution" | null {
  if (status === "dentro" || status === "acima") return "good";
  if (status === "abaixo") return "caution";
  return null;
}

/** Tom semântico do ritmo de INVESTIMENTO — aqui "acima" É o problema
 * (gastar mais rápido que o planejado), o inverso de Resultado. Mesma
 * distinção que já existia embutida em `MonthInvestmentSummary` antes
 * desta etapa (classes de cor inline por status) — só nomeada. */
function investmentRitmoTone(status: SpendStatus): "good" | "caution" | "bad" | null {
  if (status === "dentro") return "good";
  if (status === "abaixo") return "caution";
  if (status === "acima") return "bad";
  return null;
}

const TONE_TEXT_CLASSES: Record<"good" | "caution" | "bad", string> = {
  good: "text-green-600 dark:text-green-400",
  caution: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

/**
 * Diagnóstico ÚNICO do "Ritmo do mês" (Etapa "Revisão Performance — Visão
 * Geral do cliente") — substitui os dois textos de ritmo independentes que
 * existiam antes (um em Performance, um em Investimento). Reaproveita
 * 100% `classifySpendStatus`/`RITMO_STATUS_TEXT` (`lib/spend-status.ts`) —
 * nenhum threshold novo, nenhuma segunda régua de "está no ritmo".
 *
 * Regra de consolidação (pensada pra nunca esconder uma condição
 * problemática só pra caber num texto único):
 * - Se as duas leituras existem e as duas têm tom "good" — uma frase só
 *   ("Dentro do ritmo esperado"): não há nada que mereça atenção em
 *   nenhuma das duas, mesmo que uma delas seja tecnicamente "acima" (mais
 *   resultado que o esperado nunca é um problema a ser sinalizado).
 * - Se só uma leitura existe (a outra sem meta configurada, mês futuro/
 *   encerrado etc.) — mostra só ela, sem prefixo.
 * - Se as duas existem e QUALQUER uma não é "good" — nunca colapsa: mostra
 *   as duas, cada uma atribuída ("Resultados: ..." / "Investimento: ..."),
 *   cada uma com o tom de cor que já usava isoladamente. É o caso central
 *   do pedido: performance acima do esperado (bom) e investimento acima do
 *   esperado (ruim) têm o MESMO texto-base ("Acima do ritmo esperado") mas
 *   significados opostos — nunca podem virar uma frase só.
 */
function RitmoDiagnostic({
  resultStatus,
  investmentStatus,
}: {
  /** `null` = sem leitura de resultado disponível nesta seção (sem meta de
   * quantidade configurada) — mesmo guard que já existia antes de
   * `MonthlyGoalProgress` ser renderizado. */
  resultStatus: SpendStatus | null;
  /** `null` = sem leitura de investimento disponível (sem planejamento, ou
   * mês futuro/encerrado) — mesmo guard que já existia antes da seção de
   * status de `MonthInvestmentSummary`. */
  investmentStatus: SpendStatus | null;
}) {
  const resultText = resultStatus ? (RITMO_STATUS_TEXT[resultStatus] ?? null) : null;
  const investmentText = investmentStatus ? (RITMO_STATUS_TEXT[investmentStatus] ?? null) : null;
  const resultTone = resultStatus ? resultRitmoTone(resultStatus) : null;
  const investmentTone = investmentStatus ? investmentRitmoTone(investmentStatus) : null;

  if (!resultText && !investmentText) return null;

  if (resultText && investmentText) {
    if (resultTone === "good" && investmentTone === "good") {
      return <p className={`text-sm font-medium ${TONE_TEXT_CLASSES.good}`}>Dentro do ritmo esperado</p>;
    }
    return (
      <p className="text-sm font-medium">
        <span className={resultTone ? TONE_TEXT_CLASSES[resultTone] : "text-overview-text-secondary"}>Resultados: {resultText}</span>
        <span className="mx-1.5 text-overview-border" aria-hidden="true">
          ·
        </span>
        <span className={investmentTone ? TONE_TEXT_CLASSES[investmentTone] : "text-overview-text-secondary"}>Investimento: {investmentText}</span>
      </p>
    );
  }

  const soloText = resultText ?? investmentText;
  const soloTone = resultText ? resultTone : investmentTone;
  return <p className={`text-sm font-medium ${soloTone ? TONE_TEXT_CLASSES[soloTone] : "text-overview-text-secondary"}`}>{soloText}</p>;
}

/**
 * "ACOMPANHAMENTO DA CONTA" — principal bloco operacional da página do
 * cliente. Nenhum cálculo financeiro ou de performance muda aqui — os KPIs,
 * o ritmo e o detalhamento por canal só consomem valores já calculados
 * pela página; nunca recomputados aqui (exceto `classifySpendStatus`, que é
 * uma função PURA recalculada de propósito — mesmo padrão já usado por
 * `MonthInvestmentActions`/`MonthInvestmentSummary`, nunca uma segunda
 * regra de negócio).
 *
 * Etapa "Revisão Performance — Visão Geral do cliente" (substitui a
 * hierarquia anterior — "Primeira dobra"/"Simetria Performance x
 * Investimento"): o mesmo dado aparecia de até 9 formas diferentes na
 * tela (fração, %, barra, "esperado hoje", diagnóstico de ritmo, diferença
 * em reais, restante, dias restantes...). Nova hierarquia, em 3 camadas:
 *
 * 1. KPIs (`MonthlyKpiSummary`) — "o que aconteceu no mês?": Resultado,
 *    Investimento, Custo por resultado (+ Faturamento/ROAS quando
 *    aplicável), todos o MESMO nível hierárquico, cada um com só valor +
 *    referência estática (Meta/Planejado) como texto secundário.
 * 2. "RITMO DO MÊS" — "o avanço está de acordo com o esperado?": duas
 *    leituras empilhadas (nunca mais lado a lado com divisor vertical —
 *    pedido explícito pra tirar essa separação visual), cada uma só
 *    título com o % embutido + barra (`MonthlyGoalProgress`/
 *    `MonthInvestmentSummary`, ambos trimados nesta etapa — a fração e o
 *    texto de status saíram dos dois, já estão nas camadas 1 e 3).
 * 3. Diagnóstico único (`RitmoDiagnostic`) — "existe algo que merece
 *    atenção?": um texto só quando as duas leituras estão bem, dois
 *    textos atribuídos quando alguma delas não está (nunca esconde uma
 *    condição problemática só pra caber numa frase única).
 * 4. Ações (`investmentActions` — "Ver detalhes do investimento"/"Editar
 *    planejamento"/"Ver histórico", inalteradas) e "Resultados por canal"
 *    em largura total, fechando o bloco.
 *
 * O histórico do mês (antigo `CollapsibleAccountHistory`) continua fora da
 * apresentação padrão (decisão de etapa anterior, inalterada) — a Timeline
 * e o disclosure "Informações da conta" continuam cobrindo isso.
 */
export function AccountFollowUpPanel({
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  targetResultCount,
  expectedResultsToDate,
  channelBreakdown,
  configureObjectiveHref,
  investmentPlanned,
  investmentExpectedToDate,
  investmentStatus,
  investmentMonthLabel,
  investmentMonthRange,
  isFutureMonth,
  isClosedMonth,
  currentPlanningEndDate,
  investmentActions,
}: {
  /** Investimento realizado do mês selecionado — já calculado pela camada
   * financeira (`sumActualSpendForMonth`), nunca recomputado aqui. */
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
  /** Meta de QUANTIDADE de resultado vigente pro mês selecionado — `null` =
   * sem meta configurada (nunca mostra "X/undefined"). */
  targetResultCount?: number | null;
  /** `computeMonthlyExpectedToDateByCalendar` aplicado a `targetResultCount`
   * — mesma lógica temporal já usada pro investimento. */
  expectedResultsToDate?: number | null;
  /** Resultado por canal do mês, só os canais com pelo menos 1 registro —
   * `ResultsByChannel` só renderiza algo com dado em mais de 1 canal. */
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
  configureObjectiveHref: string;
  /** Orçamento mensal vigente (`resolveMonthlyBudget`) — mesmo valor de
   * sempre, agora consumido tanto pelo KPI "Investimento" quanto pela
   * barra de "Ritmo do mês", nunca duas fontes diferentes. */
  investmentPlanned: number;
  investmentExpectedToDate: number;
  investmentStatus: SpendStatus;
  investmentMonthLabel: string;
  investmentMonthRange: { firstDay: string; lastDay: string };
  isFutureMonth: boolean;
  isClosedMonth: boolean;
  currentPlanningEndDate: string | null;
  /** `<MonthInvestmentActions />` já pronto — disclosure/edição/histórico
   * do investimento, renderizado numa linha própria abaixo da seção "Ritmo
   * do mês" (nunca dentro dela). */
  investmentActions?: ReactNode;
}) {
  // Resultado só tem leitura de ritmo quando há meta de QUANTIDADE
  // configurada pro mês — mesmo guard que já existia antes de
  // `MonthlyGoalProgress` ser renderizado, nenhuma condição nova.
  const hasResultRitmo = Boolean(performanceGoal) && targetResultCount != null && targetResultCount > 0 && expectedResultsToDate != null;
  const resultStatus = hasResultRitmo
    ? classifySpendStatus(performanceSummary?.resultCount ?? 0, expectedResultsToDate as number, targetResultCount as number)
    : null;

  // Investimento só tem leitura de ritmo com planejamento configurado E
  // mês em andamento (mês futuro ainda não tem ritmo pra avaliar; mês
  // encerrado já não tem "esperado até hoje" — mesmos dois guards que já
  // existiam antes da seção de status de `MonthInvestmentSummary`).
  const hasInvestmentRitmo = investmentPlanned > 0 && !isFutureMonth && !isClosedMonth;
  const investmentRitmoStatus = hasInvestmentRitmo ? investmentStatus : null;

  return (
    <>
      <MonthlyKpiSummary
        monthActual={monthActual}
        performanceGoal={performanceGoal}
        performanceSummary={performanceSummary}
        targetCostPerResult={targetCostPerResult}
        targetResultCount={targetResultCount}
        investmentPlanned={investmentPlanned}
        configureObjectiveHref={configureObjectiveHref}
      />

      <div className="mt-5 border-t border-overview-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Ritmo do mês</p>

        <div className="mt-2.5 flex flex-col gap-3.5">
          {hasResultRitmo && (
            <MonthlyGoalProgress
              monthResultCount={performanceSummary?.resultCount ?? 0}
              targetResultCount={targetResultCount as number}
              expectedToDate={expectedResultsToDate as number}
            />
          )}
          <MonthInvestmentSummary
            planned={investmentPlanned}
            actual={monthActual}
            expectedToDate={investmentExpectedToDate}
            status={investmentStatus}
            monthLabel={investmentMonthLabel}
            monthRange={investmentMonthRange}
            isClosedMonth={isClosedMonth}
            isFutureMonth={isFutureMonth}
            currentPlanningEndDate={currentPlanningEndDate}
          />
        </div>

        <div className="mt-2.5">
          <RitmoDiagnostic resultStatus={resultStatus} investmentStatus={investmentRitmoStatus} />
        </div>
      </div>

      {investmentActions && <div className="mt-3 border-t border-overview-border pt-2">{investmentActions}</div>}

      {performanceGoal && <ResultsByChannel goal={performanceGoal} channelBreakdown={channelBreakdown} />}
    </>
  );
}
