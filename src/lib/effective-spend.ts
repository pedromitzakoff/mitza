/**
 * Módulo de domínio neutro — Single Source of Truth do investimento
 * realizado. Nenhuma tela é "dona" deste dado: Cliente, Operação, Visão
 * Geral, Relatórios e qualquer tela futura chamam exatamente estas três
 * funções, nunca uma reimplementação própria da fórmula.
 * `lib/sprint-financials.ts` (nomes históricos usados pela maior parte da
 * plataforma) virou uma casca fina que só adapta `snake_case` → estas
 * funções — não existe mais uma segunda cópia da fórmula em lugar nenhum.
 *
 * As três funções, em ordem de composição:
 * - `resolveEffectiveSpend`: decide, com os dois valores já resolvidos
 *   (manual e sincronizado), qual vale.
 * - `resolveEffectiveSpendForDateRange`: resolve o gasto efetivo de UMA
 *   sprint num intervalo de datas — a própria sprint inteira ou recortada
 *   por um mês, quem chama decide o intervalo.
 * - `sumEffectiveSpendForMonth`: soma o gasto efetivo de várias sprints
 *   recortado por um mês — a fonte da verdade do investimento mensal que
 *   toda tela consome.
 *
 * Regra oficial (corrigida nesta etapa — a versão anterior desta
 * plataforma tinha DUAS regras diferentes: `resolveSprintActualSpend`
 * caía pro sincronizado quando `manual_actual_spend` estava vazio, mas
 * `computeSprintMonthActualSpend`, usada pelo total mensal, retornava `0`
 * direto nesse mesmo caso, ignorando qualquer `daily_spend` existente —
 * a causa raiz do valor divergente encontrado entre Cliente e Operação):
 * 1. `spendSource === "manual"` e existe `manualActualSpend` → usa o manual.
 * 2. Senão, se existe `syncedSpend` → usa o sincronizado (fallback).
 * 3. Senão → ausência de dados (`hasData: false`), nunca `0` silencioso.
 */

export type SpendSource = "manual" | "meta_api";

export interface EffectiveSpendInput {
  spendSource: SpendSource;
  /** `sprints.manual_actual_spend` — `null` = gestor ainda não lançou
   * nenhum valor manual pra esta sprint. */
  manualActualSpend: number | null;
  /** Soma de `daily_spend` no período relevante — `null` = nenhuma linha
   * sincronizada ainda. Distinto de `0` (sincronizou e o gasto real do
   * período é zero) — quem monta este valor nunca deve colapsar "sem
   * linha nenhuma" em `0` antes de chamar esta função. */
  syncedSpend: number | null;
}

export interface EffectiveSpend {
  actual: number;
  /** `false` = não há nenhum dado confiável pra este gasto (nem manual,
   * nem sincronizado) — `actual` fica em `0` só como valor de
   * preenchimento nesse caso; ausência nunca deve ser lida como "gasto
   * real zero" sem checar este campo primeiro. */
  hasData: boolean;
}

export function resolveEffectiveSpend(input: EffectiveSpendInput): EffectiveSpend {
  if (input.spendSource === "manual" && input.manualActualSpend !== null) {
    return { actual: input.manualActualSpend, hasData: true };
  }
  if (input.syncedSpend === null) return { actual: 0, hasData: false };
  return { actual: input.syncedSpend, hasData: true };
}

export interface SprintSpendSource {
  startDate: string;
  endDate: string;
  spendSource: SpendSource;
  manualActualSpend: number | null;
  /** `sprints.manual_spend_updated_at` — opcional: só quem precisa do
   * timestamp da fonte usada (indicador de atualização) passa isto;
   * omitir é seguro pra quem só quer o valor. */
  manualSpendUpdatedAt?: string | null;
}

export interface DailySpendRow {
  date: string;
  spend: number;
  /** `daily_spend.synced_at` — opcional, mesma razão de
   * `manualSpendUpdatedAt`. */
  syncedAt?: string;
}

/**
 * Gasto efetivo de UMA sprint, recortado por um intervalo de datas
 * arbitrário — a sprint inteira (`{start: sprint.startDate, end:
 * sprint.endDate}`) ou um mês (`sumEffectiveSpendForMonth`, abaixo).
 */
export function resolveEffectiveSpendForDateRange(
  sprint: SprintSpendSource,
  dateRange: { start: string; end: string },
  dailySpend: DailySpendRow[],
): EffectiveSpend & { matchingDailySpend: DailySpendRow[] } {
  const overlapStart = sprint.startDate > dateRange.start ? sprint.startDate : dateRange.start;
  const overlapEnd = sprint.endDate < dateRange.end ? sprint.endDate : dateRange.end;
  if (overlapStart > overlapEnd) {
    return { actual: 0, hasData: false, matchingDailySpend: [] };
  }

  const matchingDailySpend = dailySpend.filter((d) => d.date >= overlapStart && d.date <= overlapEnd);
  const syncedSpend = matchingDailySpend.length > 0 ? matchingDailySpend.reduce((sum, d) => sum + d.spend, 0) : null;

  const resolved = resolveEffectiveSpend({
    spendSource: sprint.spendSource,
    manualActualSpend: sprint.manualActualSpend,
    syncedSpend,
  });

  return { ...resolved, matchingDailySpend };
}

export interface MonthlyEffectiveSpend {
  actual: number;
  hasData: boolean;
  /** Timestamp mais recente da fonte EFETIVAMENTE usada em cada sprint —
   * `null` quando `hasData` é `false`, ou quando nenhum chamador passou
   * os campos opcionais de freshness (`manualSpendUpdatedAt`/`syncedAt`). */
  lastUpdatedAt: string | null;
}

/**
 * Soma o gasto efetivo de várias sprints, recortado por um mês — fonte
 * da verdade única do investimento mensal (substitui qualquer soma de
 * `daily_spend` feita por fora, e qualquer segunda cópia da fórmula de
 * sobreposição sprint×mês). Recebe TODAS as sprints que se sobrepõem ao
 * mês (não só as que começam nele) — quem monta essa lista precisa
 * filtrar por sobreposição (`start_date <= lastDay && end_date >=
 * firstDay`), nunca por `start_date` dentro do mês.
 */
export function sumEffectiveSpendForMonth(
  sprints: SprintSpendSource[],
  monthRange: { firstDay: string; lastDay: string },
  dailySpend: DailySpendRow[],
): MonthlyEffectiveSpend {
  let actual = 0;
  let hasData = false;
  let lastUpdatedAt: string | null = null;

  const considerTimestamp = (candidate: string | null | undefined) => {
    if (candidate && (!lastUpdatedAt || candidate > lastUpdatedAt)) lastUpdatedAt = candidate;
  };

  for (const sprint of sprints) {
    const resolved = resolveEffectiveSpendForDateRange(
      sprint,
      { start: monthRange.firstDay, end: monthRange.lastDay },
      dailySpend,
    );
    actual += resolved.actual;
    if (resolved.hasData) {
      hasData = true;
      if (sprint.spendSource === "manual" && sprint.manualActualSpend !== null) {
        considerTimestamp(sprint.manualSpendUpdatedAt);
      } else {
        for (const row of resolved.matchingDailySpend) considerTimestamp(row.syncedAt);
      }
    }
  }

  return { actual, hasData, lastUpdatedAt };
}
