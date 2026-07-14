function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Todos os dias (YYYY-MM-DD) entre `firstDay` e `lastDay`, inclusive. */
export function listDatesInclusive(firstDay: string, lastDay: string): string[] {
  const start = parseDateUTC(firstDay);
  const end = parseDateUTC(lastDay);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(toDateString(d));
  }
  return dates;
}

/** Distribui um total (em centavos) igualmente entre `count` posições,
 * jogando a sobra do arredondamento na última posição. */
function distributeCentsEqually(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? baseCents + remainderCents : baseCents,
  );
}

/** Divide todos os dias do mês entre "histórico" (já encerrado, nunca
 * recalculado) e "elegível pra redistribuição" — função central única pra
 * essa pergunta, nunca um filtro inline duplicado em cada lugar que precisa
 * saber quais dias ainda podem receber orçamento. Elegível é qualquer dia
 * igual ou posterior à `effectiveDate` (hoje, num mês em andamento — dias
 * restantes da sprint atual, incluindo hoje, mais todas as sprints futuras).
 * A própria `effectiveDate` pertence ao período elegível, nunca ao histórico. */
export function getEligibleRedistributionDates(
  allDates: string[],
  effectiveDate: string,
): { historicalDates: string[]; eligibleDates: string[] } {
  return {
    historicalDates: allDates.filter((date) => date < effectiveDate),
    eligibleDates: allDates.filter((date) => date >= effectiveDate),
  };
}

export const CLOSED_MONTH_MESSAGE = "Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.";

/**
 * Data de efeito (corte histórico/elegível) pra uma alteração de orçamento:
 * hoje, no fuso da agência, quando o mês editado é o corrente; um dia antes
 * do primeiro dia do mês quando é um mês futuro (assim todos os dias do mês
 * futuro saem elegíveis, sem precisar de caso especial na redistribuição);
 * mês já encerrado (último dia < hoje) não tem data de efeito — bloqueado
 * por este fluxo (não existe "quanto ainda pode ser investido" num mês que
 * já acabou).
 */
export function resolveBudgetEffectiveDate(
  monthRange: { firstDay: string; lastDay: string },
  todayStr: string,
): { effectiveDate: string | null; isClosedMonth: boolean } {
  if (monthRange.lastDay < todayStr) {
    return { effectiveDate: null, isClosedMonth: true };
  }
  if (monthRange.firstDay > todayStr) {
    return { effectiveDate: addDays(monthRange.firstDay, -1), isClosedMonth: false };
  }
  return { effectiveDate: todayStr, isClosedMonth: false };
}

function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/** % do orçamento mensal já utilizado — `null` quando não há orçamento
 * configurado (nunca 0%/NaN/Infinity). */
export function computeUtilizedPct(monthlyBudget: number, monthActual: number): number | null {
  return monthlyBudget > 0 ? (monthActual / monthlyBudget) * 100 : null;
}

/**
 * Orçamento mensal VIGENTE — Etapa 66: fonte única, nunca mais a soma dos
 * planejamentos diários persistidos (`sprint_planned_allocations`). Essa
 * soma parecia razoável mas divergia do orçamento de verdade sempre que o
 * planejado histórico (dias já encerrados) não batia exatamente com o
 * realizado histórico real — o que é a regra, não a exceção, já que
 * "planejado" e "realizado" são conceitos diferentes por definição. O
 * orçamento vigente é sempre o valor mais recente configurado pelo cliente
 * (`monthly_budget_changes.new_amount`, o registro mais recente pra este
 * mês) — nunca reconstruído subtraindo/somando planejamentos antigos.
 *
 * `fallbackPlannedSum` só é usado quando NENHUMA alteração de orçamento foi
 * registrada ainda pra este mês (cliente que nunca passou pelo editor de
 * orçamento) — nesse caso não existe nenhum drift possível ainda (nada foi
 * redistribuído independentemente do realizado), então a soma do que já
 * está persistido é, por definição, o único valor conhecido.
 */
export function resolveMonthlyBudget(
  budgetChanges: { newAmount: number; changedAt: string }[],
  fallbackPlannedSum: number,
): number {
  if (budgetChanges.length === 0) return fallbackPlannedSum;
  const latest = budgetChanges.reduce((latest, change) =>
    change.changedAt > latest.changedAt ? change : latest,
  );
  return latest.newAmount;
}

export interface MonthlyExpectedToDate {
  /** 0–100. `dias_transcorridos_no_mes / dias_totais_do_mes`. Mês futuro = 0;
   * mês encerrado = 100. */
  expectedPct: number;
  /** `orcamento_mensal_vigente × (expectedPct / 100)`. */
  expectedToDate: number;
}

/**
 * "Esperado até hoje" do MÊS (Etapa 67) — fonte central única, substitui
 * `sumExpectedToDateForMonth`. A regra é só avanço de calendário: quantos
 * dias do mês já passaram (hoje incluso) sobre o total de dias do mês,
 * multiplicado pelo orçamento vigente (`resolveMonthlyBudget`) — nunca soma
 * de `sprint_planned_allocations`, nunca `sprints.planned_spend`, nunca
 * planejamento redistribuído pra sprints futuras. Isso é DELIBERADAMENTE
 * independente de sprints: as sprints existem só pra agrupar dias em
 * semanas operacionais, nunca pra decidir o ritmo esperado do mês.
 *
 * Por ser só uma razão de dois números (dias e orçamento), esta função
 * reage instantaneamente a qualquer alteração de orçamento — nunca fica
 * presa a um valor gravado no passado, ao contrário da fonte antiga (que
 * somava linhas de planejamento diário já persistidas, sujeitas a nunca
 * terem sido recalculadas desde a última mudança de orçamento).
 *
 * Independente de `computeMonthlyBudgetPlan` (saldo restante/recomendação
 * diária): uma responde "qual o ritmo esperado até agora", a outra responde
 * "quanto investir daqui pra frente" — nunca a mesma fórmula, nunca uma
 * chama a outra.
 */
export function computeMonthlyExpectedToDateByCalendar(
  monthlyBudget: number,
  monthRange: { firstDay: string; lastDay: string },
  todayStr: string,
): MonthlyExpectedToDate {
  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);
  const daysInMonth = allDates.length;

  let daysElapsed: number;
  if (todayStr < monthRange.firstDay) {
    daysElapsed = 0; // mês futuro — nada transcorrido ainda
  } else if (todayStr > monthRange.lastDay) {
    daysElapsed = daysInMonth; // mês encerrado — 100% transcorrido
  } else {
    daysElapsed = allDates.indexOf(todayStr) + 1; // hoje conta como transcorrido
  }

  const expectedPct = daysInMonth > 0 ? (daysElapsed / daysInMonth) * 100 : 0;
  const expectedToDate = monthlyBudget * (expectedPct / 100);

  return { expectedPct, expectedToDate };
}

export interface MonthlyBudgetPlanSprintInput {
  sprintId: string;
  startDate: string;
  endDate: string;
}

export interface MonthlyBudgetPlanSprintResult {
  sprintId: string;
  /** Dias desta sprint, dentro do mês, que ainda são elegíveis (hoje +
   * futuro) — 0 pra sprint encerrada. */
  eligibleDaysCount: number;
  /** `valor_diario_recomendado × dias_elegiveis_desta_sprint` — sempre 0 pra
   * sprint encerrada. A soma de `remainingPlanned` de todas as sprints
   * elegíveis é EXATAMENTE `remainingBudget` (garantido por construção: os
   * dois vêm da mesma partição em centavos do mesmo total, nunca de duas
   * contas independentes que possam divergir por arredondamento). */
  remainingPlanned: number;
}

export interface MonthlyBudgetPlan {
  monthlyBudget: number;
  monthActual: number;
  /** `max(orcamento_mensal_vigente - realizado_acumulado, 0)`. */
  remainingBudget: number;
  /** Dias elegíveis restantes do mês inteiro (hoje + futuro, nunca dias já
   * encerrados nem dias de fora do mês). */
  eligibleDaysCount: number;
  /** `remainingBudget / eligibleDaysCount` — 0 quando o orçamento já foi
   * atingido/ultrapassado ou não há mais dias elegíveis. Nunca negativo. */
  recommendedDaily: number;
  isBudgetReached: boolean;
  /** Quanto o realizado ultrapassou o orçamento — 0 quando não ultrapassou. */
  overageAmount: number;
  utilizedPct: number | null;
  /** Planejamento restante de cada sprint (chave = sprintId) — mesma
   * partição em centavos que gera `remainingBudget`, nunca uma segunda
   * divisão independente por sprint. */
  sprintPlans: Map<string, MonthlyBudgetPlanSprintResult>;
}

/**
 * Função central única do planejamento financeiro mensal (Etapa 66) — a
 * fonte de verdade pra "quanto ainda pode ser investido este mês" e "como
 * isso se divide entre a sprint atual e as sprints futuras". Nunca lê
 * `sprint_planned_allocations`/`sprints.planned_spend`: os únicos insumos
 * são o orçamento vigente (`monthlyBudget`, já resolvido por
 * `resolveMonthlyBudget`), o realizado acumulado real (`monthActual`, soma
 * de gasto de verdade), a data de referência (`effectiveDate`) e a
 * estrutura das sprints do mês (só `sprintId`/`startDate`/`endDate` —
 * nenhum valor financeiro delas entra aqui). Determinística e idempotente:
 * chamar duas vezes com os mesmos argumentos produz exatamente o mesmo
 * resultado, nunca acumula em cima de uma redistribuição anterior.
 *
 * A distribuição entre sprints reaproveita a MESMA partição em centavos que
 * decide `recommendedDaily` (`distributeCentsEqually` sobre os dias
 * elegíveis do mês inteiro, na ordem do calendário) — cada dia elegível é
 * atribuído à sprint que o contém, e a sobra de arredondamento cai sempre no
 * último dia elegível do mês (dentro de qualquer sprint que o contenha,
 * normalmente a última). Por construção, `sum(sprintPlans.remainingPlanned)
 * === remainingBudget` sempre — nunca duas contas que possam divergir.
 */
export function computeMonthlyBudgetPlan(input: {
  monthlyBudget: number;
  monthActual: number;
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string;
  sprints: MonthlyBudgetPlanSprintInput[];
}): MonthlyBudgetPlan {
  const { monthlyBudget, monthActual, monthRange, effectiveDate, sprints } = input;

  const remainingBudget = Math.max(monthlyBudget - monthActual, 0);
  const isBudgetReached = monthlyBudget > 0 && monthActual >= monthlyBudget;
  const overageAmount = isBudgetReached ? monthActual - monthlyBudget : 0;

  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);
  const { eligibleDates } = getEligibleRedistributionDates(allDates, effectiveDate);
  const eligibleDaysCount = eligibleDates.length;
  const recommendedDaily = eligibleDaysCount > 0 ? remainingBudget / eligibleDaysCount : 0;

  const remainingCents = Math.round(remainingBudget * 100);
  const perDayCents = distributeCentsEqually(remainingCents, eligibleDaysCount);

  const sprintPlans = new Map<string, MonthlyBudgetPlanSprintResult>();
  for (const sprint of sprints) {
    sprintPlans.set(sprint.sprintId, { sprintId: sprint.sprintId, eligibleDaysCount: 0, remainingPlanned: 0 });
  }

  eligibleDates.forEach((date, index) => {
    const sprint = sprints.find((s) => date >= s.startDate && date <= s.endDate);
    if (!sprint) return;
    const entry = sprintPlans.get(sprint.sprintId);
    if (!entry) return;
    entry.eligibleDaysCount += 1;
    entry.remainingPlanned += (perDayCents[index] ?? 0) / 100;
  });

  return {
    monthlyBudget,
    monthActual,
    remainingBudget,
    eligibleDaysCount,
    recommendedDaily,
    isBudgetReached,
    overageAmount,
    utilizedPct: computeUtilizedPct(monthlyBudget, monthActual),
    sprintPlans,
  };
}
