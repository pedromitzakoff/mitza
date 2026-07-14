import {
  distributeCentsEqually,
  listDatesInclusive,
  resolveMonthlyBudget,
  computeMonthlyBudgetPlan,
} from "./monthly-budget";

/**
 * Camada de planejamento original + recomendação dinâmica por SPRINT (Etapa
 * 70) — nova funcionalidade, não uma correção da lógica mensal. O orçamento
 * mensal continua sendo a única fonte de verdade financeira (nunca
 * reimplementada aqui); este arquivo só distribui/reconcilia esse orçamento
 * entre as sprints do mês, sempre reaproveitando `computeMonthlyBudgetPlan`/
 * `resolveMonthlyBudget` (monthly-budget.ts) por baixo.
 *
 * Quatro conceitos financeiros de UMA sprint, nunca confundidos entre si:
 *
 * 1. PLANEJAMENTO ORIGINAL (`computeOriginalSprintPlans`) — quanto o
 *    orçamento mensal, distribuído proporcionalmente por TODOS os dias do
 *    mês (encerrados + hoje + futuros), destina a esta sprint. Referência
 *    inicial/histórico — nunca o alvo operacional atual.
 * 2. INVESTIDO/REALIZADO — já existe (`SprintFinancials.actualSpend`,
 *    `computeSprintEffectiveSpend`), não duplicado aqui.
 * 3. RECOMENDAÇÃO ATUAL e 4. RESTANTE RECOMENDADO — já existem via
 *    `computeMonthlyBudgetPlan().sprintPlans`/`computeSprintInvestmentAmounts`
 *    (`totalPrevisto`/`remainingPlanned` de uma sprint atual/futura JÁ SÃO,
 *    numericamente, a recomendação atual total/restante recomendado — só a
 *    interface passa a nomeá-los "recomendado" em vez de "previsto"/
 *    "planejamento restante", Etapa 70). Nada de novo é computado pra
 *    sprint atual/futura neste arquivo.
 *
 * O que É novo: (a) `computeOriginalSprintPlans`, a distribuição por TODOS
 * os dias do mês (diferente da distribuição só dos dias ELEGÍVEIS que
 * `computeMonthlyBudgetPlan` já faz pro saldo restante); e (b)
 * `computeSprintClosedSnapshot`, o congelamento retroativo dos 3 valores
 * históricos de uma sprint que acabou de encerrar (ver
 * `src/lib/sprint-snapshot.ts` pra quem persiste isso no banco).
 */

export interface SprintCalendarInput {
  sprintId: string;
  startDate: string;
  endDate: string;
}

export interface SprintOriginalPlanResult {
  sprintId: string;
  /** Quantos dias desta sprint pertencem ao mês (uma sprint que atravessa a
   * fronteira de mês tem menos dias "no mês" do que sua duração total). */
  daysInMonth: number;
  originalPlannedAmount: number;
}

/**
 * Planejamento original de TODAS as sprints do mês — distribui o orçamento
 * mensal proporcionalmente por TODOS os dias do mês (nunca só os dias
 * elegíveis/futuros, ao contrário de `computeMonthlyBudgetPlan`), depois
 * atribui cada dia à sprint que o contém. Garante por construção que a soma
 * de `originalPlannedAmount` de todas as sprints é EXATAMENTE `monthlyBudget`
 * (mesma técnica de `computeMonthlyBudgetPlan`: partição em centavos, sobra
 * de arredondamento no último dia do mês).
 *
 * Determinística: chamar de novo com o mesmo orçamento e o mesmo calendário
 * sempre reproduz o mesmo resultado — é assim que uma sprint concluída
 * congela `original_planned_amount` (Etapa 70, seção 15: sprint atual/
 * futura pode recalcular ao vivo quando o orçamento mensal muda; sprint
 * concluída usa o orçamento vigente NO MOMENTO do congelamento, nunca o
 * atual).
 */
export function computeOriginalSprintPlans(
  monthlyBudget: number,
  monthRange: { firstDay: string; lastDay: string },
  sprints: SprintCalendarInput[],
): Map<string, SprintOriginalPlanResult> {
  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);
  const totalCents = Math.round(monthlyBudget * 100);
  const perDayCents = distributeCentsEqually(totalCents, allDates.length);

  const plans = new Map<string, SprintOriginalPlanResult>();
  for (const sprint of sprints) {
    plans.set(sprint.sprintId, { sprintId: sprint.sprintId, daysInMonth: 0, originalPlannedAmount: 0 });
  }

  allDates.forEach((date, index) => {
    const sprint = sprints.find((s) => date >= s.startDate && date <= s.endDate);
    if (!sprint) return; // dia do mês sem nenhuma sprint (não deveria acontecer nos dados reais)
    const entry = plans.get(sprint.sprintId);
    if (!entry) return;
    entry.daysInMonth += 1;
    entry.originalPlannedAmount += (perDayCents[index] ?? 0) / 100;
  });

  return plans;
}

export interface SprintClosedSnapshot {
  /** Congelado — orçamento vigente na última configuração antes da sprint
   * encerrar, distribuído proporcionalmente pelo calendário do mês. */
  originalPlannedAmount: number;
  /** Congelado — recomendação atual total desta sprint no momento em que
   * ela deixou de ser "atual". `null` quando nenhum orçamento mensal existia
   * enquanto a sprint ainda estava aberta (nunca inventado retroativamente —
   * Etapa 70, seção 5). */
  finalRecommendedAmount: number | null;
  /** Congelado — realizado final da sprint (sempre conhecido). */
  finalActualAmount: number;
}

export interface ComputeSprintClosedSnapshotInput {
  sprint: SprintCalendarInput & { actualSpend: number };
  monthRange: { firstDay: string; lastDay: string };
  /** Todas as sprints do mês — precisa do calendário inteiro pra partição
   * (planejamento original) e pra recomendação, não só desta sprint. */
  allSprintsOfMonth: SprintCalendarInput[];
  /** Histórico de `monthly_budget_changes` do mês inteiro (qualquer data),
   * já buscado — esta função filtra internamente pelas mudanças que
   * aconteceram até o fim desta sprint. */
  budgetChanges: { newAmount: number; changedAt: string }[];
  /** Fallback de `resolveMonthlyBudget` pra quando não existe NENHUMA linha
   * em `monthly_budget_changes` até o fim desta sprint — soma das alocações
   * diárias (`sprint_planned_allocations`) através do fim desta sprint. */
  fallbackPlannedSumThroughSprintEnd: number;
  /** Orçamento mensal vigente AGORA (todas as mudanças, sem filtro de data)
   * — usado SÓ quando nenhum orçamento existia enquanto a sprint estava
   * aberta (orçamento configurado pela primeira vez depois que ela já tinha
   * encerrado): o planejamento original retroativo usa este valor; a
   * recomendação final continua `null` (não há como reconstruir um alvo
   * diário que nunca existiu). */
  currentMonthlyBudget: number;
  /** Realizado acumulado do mês através do DIA ANTERIOR ao início desta
   * sprint (nunca inclui o realizado da própria sprint, nem de sprints
   * posteriores) — é o "histórico" a partir do qual a recomendação desta
   * sprint é calculada, ver doc da função abaixo. */
  monthActualThroughSprintStart: number;
}

/**
 * Congela o "histórico financeiro" de uma sprint que acabou de deixar de
 * ser "atual" — os 3 valores que `ensureClosedSprintSnapshots`
 * (`sprint-snapshot.ts`) persiste exatamente uma vez, e que depois disso
 * nunca mais mudam (Etapa 70, seção 16).
 *
 * A recomendação final usa `effectiveDate = sprint.startDate` (o momento em
 * que a sprint COMEÇOU a ser atual) com o realizado acumulado até o dia
 * ANTERIOR a esse início — nunca o dia anterior ao FIM. Decisão desta etapa
 * (MVP, mesmo espírito da seção 15 do pedido original, que já previa uma
 * escolha explícita quando a regra admitia mais de uma leitura razoável):
 * usar `effectiveDate = sprint.endDate` faria TODOS os dias da própria
 * sprint, exceto o último, virarem "histórico" (fora da partição elegível),
 * sobrando só 1 dia elegível pra ela — e somar `sprint.actualSpend` (o
 * realizado FINAL, já incluindo esse último dia) a essa fatia de 1 dia
 * contaria o último dia da sprint DUAS VEZES (uma como realizado, outra como
 * recomendação nova pro mesmo dia), inflando artificialmente a recomendação
 * final. Com `effectiveDate = sprint.startDate`, nenhum dia da própria
 * sprint é histórico ainda (todos >= effectiveDate), então a fatia
 * `remainingPlanned` dela JÁ é o "recomendado pra sprint inteira" — nunca
 * somada a `sprint.actualSpend` de novo. O resultado é exatamente "quanto
 * esta sprint deveria totalizar, considerando o que as sprints ANTERIORES já
 * tinham consumido quando ela começou" — o mesmo número que o gestor via ao
 * vivo no primeiro dia da sprint, preservado mesmo que o realizado dela
 * própria só seja conhecido depois.
 */
export function computeSprintClosedSnapshot(input: ComputeSprintClosedSnapshotInput): SprintClosedSnapshot {
  const {
    sprint,
    monthRange,
    allSprintsOfMonth,
    budgetChanges,
    fallbackPlannedSumThroughSprintEnd,
    currentMonthlyBudget,
    monthActualThroughSprintStart,
  } = input;

  const cutoff = `${sprint.endDate}T23:59:59.999Z`;
  const budgetChangesAsOfEnd = budgetChanges.filter((c) => c.changedAt <= cutoff);
  const hadBudgetDuringSprint = budgetChangesAsOfEnd.length > 0 || fallbackPlannedSumThroughSprintEnd > 0;

  const budgetForOriginalPlan = hadBudgetDuringSprint
    ? resolveMonthlyBudget(budgetChangesAsOfEnd, fallbackPlannedSumThroughSprintEnd)
    : currentMonthlyBudget;

  const originalPlans = computeOriginalSprintPlans(budgetForOriginalPlan, monthRange, allSprintsOfMonth);
  const originalPlannedAmount = originalPlans.get(sprint.sprintId)?.originalPlannedAmount ?? 0;

  let finalRecommendedAmount: number | null = null;
  if (hadBudgetDuringSprint) {
    const monthlyBudgetAsOfEnd = resolveMonthlyBudget(budgetChangesAsOfEnd, fallbackPlannedSumThroughSprintEnd);
    const plan = computeMonthlyBudgetPlan({
      monthlyBudget: monthlyBudgetAsOfEnd,
      monthActual: monthActualThroughSprintStart,
      monthRange,
      effectiveDate: sprint.startDate,
      sprints: allSprintsOfMonth,
    });
    const sprintPlan = plan.sprintPlans.get(sprint.sprintId);
    finalRecommendedAmount = sprintPlan?.remainingPlanned ?? 0;
  }

  return {
    originalPlannedAmount,
    finalRecommendedAmount,
    finalActualAmount: sprint.actualSpend,
  };
}
