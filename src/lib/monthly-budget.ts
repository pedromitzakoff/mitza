import { sumActualSpendForMonth, type SpendSource } from "./sprint-financials";

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Todos os dias (YYYY-MM-DD) entre `firstDay` e `lastDay`, inclusive —
 * pública desde a Etapa 64, que precisa enumerar todos os dias do mês pra
 * calcular o investimento diário recomendado (seção 4), sem duplicar este
 * loop de datas. */
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
 * jogando a sobra do arredondamento na última — mesma convenção usada em
 * spend-chart-data.ts pro gasto manual, aqui reaplicada pro planejado. */
function distributeCentsEqually(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? baseCents + remainderCents : baseCents,
  );
}

export interface MonthlyBudgetSprintInput {
  sprintId: string;
  startDate: string;
  endDate: string;
  /** Necessários pra calcular o gasto REAL (não planejado) já realizado
   * antes da effective_date — ver `computeMonthlyBudgetRedistribution`. */
  spendSource: SpendSource;
  manualActualSpend: number | null;
}

export type MonthlyBudgetScenario = "aumento" | "reducao_normal" | "reducao_abaixo_consolidado";

export interface MonthlyBudgetRedistributionInput {
  /** Todas as sprints do cliente que caem no mês em questão, ordenadas por start_date. */
  sprints: MonthlyBudgetSprintInput[];
  /** Alocação diária PLANEJADA vigente (R$) pra cada dia do mês — vem do
   * backfill ou de uma alteração anterior. Usada só pra copiar o histórico de
   * planejamento inalterado e para as prévias por sprint; nunca mais usada
   * pra decidir quanto já foi "gasto" (ver `actualSpendBeforeEffectiveDate`). */
  currentAllocations: Map<string, number>;
  /** Gasto real diário (Meta) do cliente no mês — junto com
   * `manualActualSpend` de cada sprint, é a única fonte usada pra saber
   * quanto já foi de fato gasto antes da effective_date. */
  dailySpend: { date: string; spend: number }[];
  monthRange: { firstDay: string; lastDay: string };
  /** Data de referência (hoje, no fuso da agência) usada como corte consolidado/futuro.
   * Para meses futuros (sem período consolidado), passar uma data anterior ao início do mês. */
  effectiveDate: string;
  newBudget: number;
}

export interface MonthlyBudgetSprintPreview {
  sprintId: string;
  startDate: string;
  endDate: string;
  previousPlannedSpend: number;
  newPlannedSpend: number;
}

export interface MonthlyBudgetRedistributionResult {
  effectiveDate: string;
  previousMonthlyTotal: number;
  /** Gasto REAL (não planejado) do cliente entre o início do mês e a
   * effective_date, inclusive — nunca soma Meta + manual: cada sprint usa
   * exclusivamente sua própria `spend_source`. É o valor subtraído do novo
   * orçamento pra decidir o que ainda pode ser distribuído no futuro (ver
   * seção "Regra central do orçamento" do pedido que motivou esta correção). */
  actualSpendBeforeEffectiveDate: number;
  previousFutureAmount: number;
  futureBudgetAvailable: number;
  resultingTotal: number;
  isBelowConsolidated: boolean;
  scenario: MonthlyBudgetScenario;
  /** Alocação diária (R$) resultante pra todo o mês — dias <= effectiveDate ficam
   * idênticos aos de currentAllocations (histórico de planejamento nunca é
   * reescrito); só dias futuros mudam. */
  allocationsByDate: Map<string, number>;
  sprintPreviews: MonthlyBudgetSprintPreview[];
}

/**
 * Calcula a redistribuição do orçamento mensal entre as sprints do mês.
 *
 * Correção central (o motivo desta função ter sido revisada): o saldo
 * distribuível pro futuro é `newBudget - actualSpendBeforeEffectiveDate` —
 * o gasto REAL já ocorrido antes da effective_date, nunca a soma do que
 * tinha sido PLANEJADO pra esses mesmos dias. Usar o planejado ali era o bug:
 * numa primeira configuração de orçamento no meio do mês, ou numa mudança de
 * orçamento, o planejado dos dias passados podia ser zero (ou qualquer outro
 * valor sem relação com a realidade) enquanto o cliente já tinha gasto de
 * verdade — o resultado era ou distribuir o orçamento inteiro de novo sobre
 * o futuro (inflando o total do mês) ou usar uma base arbitrária.
 *
 * O planejamento histórico (dias <= effectiveDate) em si nunca é reescrito —
 * `allocationsByDate` copia os valores de `currentAllocations` sem alteração
 * pra esses dias; só o saldo pro futuro passa a ser calculado com base no
 * gasto real. Se o novo orçamento for menor que o já gasto, o futuro vira
 * zero e o total do mês fica acima do novo orçamento (excedente histórico)
 * — não é bloqueado, só sinalizado (`isBelowConsolidated`).
 *
 * Função pura: não lê nem escreve no banco, só decide os números — mesma
 * função usada pela prévia da UI (`MonthlyBudgetEditor`) e espelhada
 * exatamente pela função SQL `apply_monthly_budget_change`, que é quem de
 * fato grava a mudança (ver supabase/fix-monthly-budget-actual-spend.sql).
 */
/** Divide todos os dias do mês entre "histórico" (nunca mais recalculado) e
 * "elegível pra redistribuição" — Etapa 63, seção 4: função central única
 * pra essa pergunta, nunca mais um filtro inline duplicado em cada lugar que
 * precisa saber quais dias ainda podem receber orçamento. Elegível é
 * qualquer dia igual ou posterior à `effectiveDate` (dias restantes da
 * sprint atual, incluindo hoje, mais todas as sprints futuras) — nunca
 * sprints encerradas nem dias antes da data efetiva de uma mudança de
 * orçamento. A própria `effectiveDate` pertence ao período elegível, nunca
 * ao histórico (ver exemplo da sprint que atravessa a effective_date: "o
 * próprio dia 15/07 pertence ao novo período de planejamento"). */
export function getEligibleRedistributionDates(
  allDates: string[],
  effectiveDate: string,
): { historicalDates: string[]; eligibleDates: string[] } {
  return {
    historicalDates: allDates.filter((date) => date < effectiveDate),
    eligibleDates: allDates.filter((date) => date >= effectiveDate),
  };
}

export function computeMonthlyBudgetRedistribution(
  input: MonthlyBudgetRedistributionInput,
): MonthlyBudgetRedistributionResult {
  const { sprints, currentAllocations, dailySpend, monthRange, effectiveDate, newBudget } = input;
  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);

  // A própria effective_date pertence ao NOVO período de planejamento, nunca
  // ao histórico — "gasto real ANTES da data efetiva" é estritamente
  // anterior a ela (seção "Regra central do orçamento", item 2, e o exemplo
  // da sprint que atravessa a effective_date: "13/07 e 14/07 pertencem ao
  // período histórico [...] 15/07 até 19/07 pertencem ao novo planejamento",
  // com effective_date = 15/07). Por isso o corte é `date < effectiveDate`
  // (histórico) / `date >= effectiveDate` (futuro), nunca `<=`/`>`.
  const dayBeforeEffectiveDate = addDays(effectiveDate, -1);
  const { historicalDates: consolidatedDates, eligibleDates: futureDates } = getEligibleRedistributionDates(
    allDates,
    effectiveDate,
  );

  const sumAllocations = (dates: string[]) =>
    dates.reduce((sum, date) => sum + (currentAllocations.get(date) ?? 0), 0);

  const previousMonthlyTotal = sumAllocations(allDates);
  const previousFutureAmount = sumAllocations(futureDates);

  // Gasto real (não planejado) de cada sprint, mas só a fatia estritamente
  // ANTERIOR à effective_date — reaproveita exatamente
  // `sumActualSpendForMonth` (a mesma função que já calcula "realizado do
  // mês" em toda a Visão Geral/Sprints/página do cliente), só truncando o
  // intervalo no dia anterior à effective_date em vez do último dia do mês.
  // Pra sprint manual, o valor (`manual_actual_spend`) é único por sprint,
  // sem granularidade diária — conta inteiro se a sprint já começou até esse
  // corte (mesma regra de `sumActualSpendForMonth`), nunca fatiado por dia.
  const sprintsForActualSpend = sprints.map((sprint) => ({
    start_date: sprint.startDate,
    end_date: sprint.endDate,
    spend_source: sprint.spendSource,
    manual_actual_spend: sprint.manualActualSpend,
  }));
  const actualSpendBeforeEffectiveDate = sumActualSpendForMonth(
    sprintsForActualSpend,
    { firstDay: monthRange.firstDay, lastDay: dayBeforeEffectiveDate },
    dailySpend,
  );

  const futureBudgetAvailableRaw = newBudget - actualSpendBeforeEffectiveDate;
  const isBelowConsolidated = futureBudgetAvailableRaw < 0;
  const futureBudgetAvailable = isBelowConsolidated ? 0 : futureBudgetAvailableRaw;

  const allocationsByDate = new Map<string, number>();
  for (const date of consolidatedDates) {
    allocationsByDate.set(date, currentAllocations.get(date) ?? 0);
  }

  const futureCents = Math.round(futureBudgetAvailable * 100);
  const perDayCents = distributeCentsEqually(futureCents, futureDates.length);
  futureDates.forEach((date, index) => {
    allocationsByDate.set(date, (perDayCents[index] ?? 0) / 100);
  });

  // Total planejado do mês após a mudança: a fatia histórica de PLANEJAMENTO
  // nunca é reescrita (permanece igual a `previousMonthlyTotal -
  // previousFutureAmount`, o que já estava alocado antes desta edição pros
  // dias <= effectiveDate) + o novo saldo distribuído pro futuro. Nunca usa
  // `actualSpendBeforeEffectiveDate` aqui — são conceitos diferentes
  // (planejado histórico vs. gasto real histórico), só o segundo decide o
  // saldo distribuível, o primeiro decide o total exibido.
  const historicalPlannedAmount = previousMonthlyTotal - previousFutureAmount;
  const resultingTotal = historicalPlannedAmount + futureBudgetAvailable;

  const scenario: MonthlyBudgetScenario = isBelowConsolidated
    ? "reducao_abaixo_consolidado"
    : newBudget >= previousMonthlyTotal
      ? "aumento"
      : "reducao_normal";

  const sprintPreviews: MonthlyBudgetSprintPreview[] = sprints.map((sprint) => {
    const sprintDates = allDates.filter((date) => date >= sprint.startDate && date <= sprint.endDate);
    return {
      sprintId: sprint.sprintId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      previousPlannedSpend: sumAllocations(sprintDates),
      newPlannedSpend: sprintDates.reduce((sum, date) => sum + (allocationsByDate.get(date) ?? 0), 0),
    };
  });

  return {
    effectiveDate,
    previousMonthlyTotal,
    actualSpendBeforeEffectiveDate,
    previousFutureAmount,
    futureBudgetAvailable,
    resultingTotal,
    isBelowConsolidated,
    scenario,
    allocationsByDate,
    sprintPreviews,
  };
}

function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export const CLOSED_MONTH_MESSAGE = "Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.";

/**
 * Data de efeito (corte consolidado/futuro) pra uma alteração de orçamento:
 * hoje, no fuso da agência, quando o mês editado é o corrente; um dia antes
 * do primeiro dia do mês quando é um mês futuro (assim o consolidado já sai
 * zero, sem precisar de caso especial na redistribuição); mês já encerrado
 * (último dia < hoje) não tem data de efeito — bloqueado por este fluxo.
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

/**
 * Gera a alocação diária de backfill pra uma sprint existente que ainda não
 * tem `sprint_planned_allocations`: distribui o `planned_spend` atual dela
 * igualmente entre os dias do período, em centavos exatos (sobra no último
 * dia) — reconstrução técnica, nunca cria histórico de alteração e nunca
 * muda o total da sprint.
 */
export function computeSprintAllocationBackfill(sprint: {
  startDate: string;
  endDate: string;
  plannedSpend: number;
}): { date: string; amount: number }[] {
  const dates = listDatesInclusive(sprint.startDate, sprint.endDate);
  const totalCents = Math.round(sprint.plannedSpend * 100);
  const perDayCents = distributeCentsEqually(totalCents, dates.length);
  return dates.map((date, index) => ({ date, amount: (perDayCents[index] ?? 0) / 100 }));
}

/** % do orçamento mensal já utilizado — `null` quando não há planejamento
 * configurado (nunca 0%/NaN/Infinity). Única fonte desta conta: reaproveitada
 * pelo resumo do mês (mês em andamento e mês encerrado) e por
 * `computeMonthlyInvestmentRecommendation`, nunca recalculada direto num
 * componente React (Etapa 64, seção 15). */
export function computeUtilizedPct(monthPlanned: number, monthActual: number): number | null {
  return monthPlanned > 0 ? (monthActual / monthPlanned) * 100 : null;
}

export interface MonthlyInvestmentRecommendation {
  /** `max(orcamento_mensal_vigente - realizado_acumulado_no_mes, 0)`. */
  remainingBudget: number;
  /** Dias que ainda podem receber orçamento a partir da data de efeito —
   * mesma função central usada pela redistribuição da sprint atual/futuras. */
  eligibleDaysCount: number;
  /** `remainingBudget / eligibleDaysCount` — 0 quando o orçamento já foi
   * atingido/ultrapassado ou não há mais dias elegíveis. Nunca negativo. */
  recommendedDaily: number;
  isBudgetReached: boolean;
  /** Quanto o realizado ultrapassou o orçamento — 0 quando não atingiu. */
  overageAmount: number;
  utilizedPct: number | null;
}

/**
 * Investimento diário recomendado pro restante do mês (Etapa 64, seções
 * 4/5/12) — resposta a "quanto investir por dia daqui pra frente pra fechar
 * o mês dentro do orçamento planejado". Reaproveita `getEligibleRedistributionDates`
 * com a mesma `effectiveDate` que a prévia de redistribuição de orçamento já
 * usa (hoje, num mês em andamento; um dia antes do início, num mês futuro) —
 * nunca uma segunda conta de "quantos dias faltam". Por construção, quando o
 * orçamento do mês não muda hoje, a soma das alocações diárias já persistidas
 * pros dias elegíveis é igual a `remainingBudget` dividida em partes iguais —
 * o mesmo valor de `recommendedDaily`, nunca dois números divergentes pro
 * mesmo dia (ver relatório desta etapa).
 */
export function computeMonthlyInvestmentRecommendation(
  monthPlanned: number,
  monthActual: number,
  monthRange: { firstDay: string; lastDay: string },
  effectiveDate: string,
): MonthlyInvestmentRecommendation {
  const remainingBudget = Math.max(monthPlanned - monthActual, 0);
  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);
  const { eligibleDates } = getEligibleRedistributionDates(allDates, effectiveDate);
  const eligibleDaysCount = eligibleDates.length;
  const isBudgetReached = monthPlanned > 0 && monthActual >= monthPlanned;
  const overageAmount = isBudgetReached ? monthActual - monthPlanned : 0;
  const recommendedDaily = isBudgetReached || eligibleDaysCount <= 0 ? 0 : remainingBudget / eligibleDaysCount;

  return {
    remainingBudget,
    eligibleDaysCount,
    recommendedDaily,
    isBudgetReached,
    overageAmount,
    utilizedPct: computeUtilizedPct(monthPlanned, monthActual),
  };
}
