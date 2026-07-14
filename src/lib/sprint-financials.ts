import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { todayUTC } from "@/lib/today";

export type SprintTemporalStatus = "futura" | "atual" | "concluida";

/** Origem do gasto real de uma sprint: "meta_api" é o padrão (soma de
 * daily_spend, como sempre foi); "manual" é um valor digitado à mão
 * enquanto a sync do Meta não é a fonte de teste. */
export type SpendSource = "manual" | "meta_api";

export interface SprintFinancials {
  sprintId: string;
  startDate: string;
  endDate: string;
  plannedSpend: number;
  actualSpend: number;
  expectedToDate: number;
  status: SpendStatus;
  progressPct: number;
  temporalStatus: SprintTemporalStatus;
  spendSource: SpendSource;
}

/**
 * Decide qual valor de gasto real vale pra uma sprint: se a origem
 * configurada é "manual" e existe um valor manual salvo, esse valor manda —
 * a sync do Meta continua rodando e gravando em daily_spend normalmente,
 * mas essa função é o único lugar que decide se ela deve "aparecer" ou não.
 * Fora daqui (Sprints, Visão Geral, /clients), nada muda: essas telas nunca
 * chamam esta função e continuam com a soma de daily_spend de sempre.
 */
export function resolveSprintActualSpend(
  sprint: { spend_source: SpendSource; manual_actual_spend: number | null },
  metaSpendSum: number,
): number {
  if (sprint.spend_source === "manual" && sprint.manual_actual_spend !== null) {
    return sprint.manual_actual_spend;
  }
  return metaSpendSum;
}

/** Fonte única do gasto real de UMA sprint: soma o daily_spend do período
 * dela e resolve manual x meta_api. Todo lugar que precisa do gasto real de
 * uma sprint (mensal consolidado, cartão da sprint, gráfico) passa por
 * aqui — nunca duplica o filtro+soma de daily_spend por conta própria. */
export function computeSprintEffectiveSpend(
  sprint: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  },
  dailySpend: { date: string; spend: number }[],
): number {
  const metaSpendSum = dailySpend
    .filter((d) => d.date >= sprint.start_date && d.date <= sprint.end_date)
    .reduce((sum, d) => sum + d.spend, 0);
  return resolveSprintActualSpend(sprint, metaSpendSum);
}

/** Soma o gasto real efetivo de várias sprints — usado pra consolidar o
 * gasto realizado do mês (soma do effective_spend de cada sprint do mês,
 * nunca a soma direta de daily_spend). */
export function sumEffectiveSpend(
  sprints: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[],
  dailySpend: { date: string; spend: number }[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintEffectiveSpend(sprint, dailySpend), 0);
}

export function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Compara datas civis YYYY-MM-DD por ordem lexicográfica (sem nenhuma
 * conversão de timezone) — `date` pertence ao período `[startDate, endDate]`,
 * ambos inclusivos. Fonte única pra "essa data está dentro desse período?",
 * reaproveitada por `findSprintForDate` e por qualquer tela que precise da
 * mesma pergunta, pra nunca duplicar essa comparação. */
export function isDateWithinPeriod(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

/** Encontra, numa lista de sprints, aquela cujo período contém `date`
 * (normalmente `todayDateString()`) — a "sprint atual" de um cliente.
 * Fonte única: antes esse mesmo filtro (`start_date <= todayStr && end_date
 * >= todayStr`) estava duplicado em 4 páginas diferentes (Visão Geral,
 * Sprints, /clients, layout do cliente); agora todas chamam esta função. */
export function findSprintForDate<T extends { start_date: string; end_date: string }>(
  sprints: T[],
  date: string,
): T | null {
  return sprints.find((sprint) => isDateWithinPeriod(date, sprint.start_date, sprint.end_date)) ?? null;
}

/**
 * Status temporal de UMA sprint — concluída (já terminou), atual (hoje cai
 * dentro do período, os dois limites inclusivos) ou futura (ainda não
 * começou). Único lugar que faz essa comparação: `today` e as bordas da
 * sprint (`start`/`end`) precisam ser o MESMO tipo de valor (meia-noite UTC
 * do dia civil no fuso da agência, via `todayUTC()`) — passar um `today` que
 * seja um instante real (`new Date()` puro, sem passar por `todayUTC()`)
 * quebra esta conta character durante a janela em que o UTC já virou o dia
 * seguinte mas ainda é o dia anterior em São Paulo (21h–23h59 no horário de
 * verão desligado, já que o Brasil é UTC-3).
 */
export function getSprintTemporalStatus(
  sprint: { start_date: string; end_date: string },
  today: Date,
): SprintTemporalStatus {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);
  return today < start ? "futura" : today > end ? "concluida" : "atual";
}

/** Confirma que no máximo uma sprint da lista está "atual" — nunca duas ao
 * mesmo tempo. Isso só pode acontecer se os próprios dados tiverem sprints
 * sobrepostas (o que a constraint `sprints_no_overlap`, Etapa 50, já deveria
 * impedir no banco); esta função é uma segunda camada de defesa, puramente
 * de diagnóstico — nunca lança exceção pra não derrubar a página, só avisa
 * no console em desenvolvimento. */
export function assertSingleCurrentSprint(
  sprints: { start_date: string; end_date: string }[],
  today: Date,
): void {
  if (process.env.NODE_ENV === "production") return;
  const current = sprints.filter((sprint) => getSprintTemporalStatus(sprint, today) === "atual");
  if (current.length > 1) {
    console.warn(
      `[sprint-financials] ${current.length} sprints simultaneamente "atual" — dados com sobreposição:`,
      current.map((s) => `${s.start_date}–${s.end_date}`),
    );
  }
}

/** Classifica o status financeiro de UMA sprint sem nunca misturar status
 * temporal com status financeiro: uma sprint que ainda não começou é sempre
 * "nao_iniciado", mesmo que o planejamento já esteja configurado — os
 * números (realizado=0, esperado=0) NUNCA são interpretados como "dentro do
 * esperado"/"bateu meta" só porque ainda não há nada pra comparar.
 *
 * Etapa 67: a sprint ATUAL também nunca é classificada Acima/Abaixo/Dentro —
 * vira sempre "em_andamento", incondicionalmente. Antes, a sprint atual
 * comparava `actual` com um "esperado" proporcional aos dias já decorridos
 * DENTRO da própria sprint (`computeSprintExpectedToDate`) — uma fórmula
 * diferente da nova regra central de "esperado até hoje" do mês
 * (`computeMonthlyExpectedToDateByCalendar`), que olha pro calendário do MÊS
 * inteiro, não pros dias de uma sprint de ~7 dias. Manter as duas fórmulas
 * coexistindo seria exatamente o "duas fórmulas divergentes" que esta etapa
 * elimina — a sprint atual não tem mais nenhum veredito de ritmo, só um
 * status operacional ("Em andamento"); quem quiser comparar ritmo usa os
 * indicadores do card expandido (previsto atualizado/realizado/restante),
 * nunca este selo.
 *
 * Sprint concluída continua comparando o realizado final com o planejado
 * final (`expected === plannedTotal`, sempre 100% de uma sprint que já
 * acabou) — `plannedTotal <= 0` (sem nenhum planejamento histórico válido)
 * já cai em "sem_meta" dentro de `classifySpendStatus`, nunca inventa
 * Acima/Abaixo sem uma base de comparação real.
 *
 * Fonte única usada tanto por `computeSprintFinancials` (cartão da sprint)
 * quanto por `computeSprintBehaviorRows` (Comportamento por Sprint do
 * Relatório) — nunca duas implementações dessa regra. */
export function classifySprintSpendStatus(
  sprint: { start_date: string; end_date: string },
  actual: number,
  expected: number,
  plannedTotal: number,
  today: Date,
): SpendStatus {
  const temporalStatus = getSprintTemporalStatus(sprint, today);
  if (temporalStatus === "futura") return "nao_iniciado";
  if (temporalStatus === "atual") return "em_andamento";
  return classifySpendStatus(actual, expected, plannedTotal);
}

/**
 * Gasto esperado até hoje de UMA sprint, proporcional aos dias já passados
 * dentro dela: sprint futura = R$ 0; sprint encerrada = 100% do planejado.
 *
 * Etapa 67: pra sprint ATUAL, este valor não decide mais o status
 * (`classifySprintSpendStatus` sempre devolve "em_andamento" pra sprint em
 * andamento, sem olhar pra este número) — usado só como um dado auxiliar de
 * apoio onde ainda fizer sentido internamente, nunca mais como base de
 * comparação Acima/Abaixo pra sprint atual. A regra de "esperado até hoje"
 * de verdade (calendário do mês × orçamento vigente) vive em
 * `computeMonthlyExpectedToDateByCalendar` (monthly-budget.ts) — as duas
 * fórmulas medem coisas diferentes (dias da sprint vs. dias do mês) e nunca
 * devem ser confundidas.
 */
export function computeSprintExpectedToDate(
  sprint: { start_date: string; end_date: string; planned_spend: number },
  today: Date,
): number {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);
  const totalDays = daysBetweenInclusive(start, end);
  if (totalDays <= 0) return 0;

  const daysPassed = today < start ? 0 : today > end ? totalDays : daysBetweenInclusive(start, today);
  return (sprint.planned_spend * daysPassed) / totalDays;
}

/**
 * Calcula o financeiro de uma sprint: gasto esperado até hoje, status
 * (dentro/acima/abaixo/não iniciado/sem planejamento) e % de progresso da
 * barra (gasto / planejado).
 */
export function computeSprintFinancials(
  sprint: { id: string; start_date: string; end_date: string; planned_spend: number },
  actualSpend: number,
  today: Date = todayUTC(),
  spendSource: SpendSource = "meta_api",
): SprintFinancials {
  const expectedToDate = computeSprintExpectedToDate(sprint, today);
  const status = classifySprintSpendStatus(sprint, actualSpend, expectedToDate, sprint.planned_spend, today);
  const progressPct = sprint.planned_spend > 0 ? (actualSpend / sprint.planned_spend) * 100 : 0;
  const temporalStatus = getSprintTemporalStatus(sprint, today);

  return {
    sprintId: sprint.id,
    startDate: sprint.start_date,
    endDate: sprint.end_date,
    plannedSpend: sprint.planned_spend,
    actualSpend,
    expectedToDate,
    status,
    progressPct,
    temporalStatus,
    spendSource,
  };
}

/** Números brutos por trás da RECOMENDAÇÃO de UMA sprint atual/futura —
 * fonte única de "quanto é a recomendação atual total" e "quanto ainda
 * resta recomendado", nunca recalculados separadamente pelo resumo
 * compacto e pelos indicadores do card expandido. A recomendação atual
 * total é sempre `realizado + recomendação restante` (Etapa 66, seção 7,
 * renomeado na Etapa 70 — a fórmula não mudou, só o nome: antes "previsto",
 * agora "recomendado", porque este É o número que fecha o orçamento mensal
 * vigente, não uma estimativa solta) — nunca o `plannedSpend` bruto (coluna
 * persistida, que fica desatualizada assim que o realizado muda sem uma
 * nova redistribuição).
 *
 * `remainingPlanned` já vem PRONTO de `computeMonthlyBudgetPlan().sprintPlans`
 * (a única função que decide "quanto ainda pode ser investido" — nunca
 * recalculado aqui a partir de `sprint_planned_allocations`).
 *
 * Etapa 70: esta função só serve sprint ATUAL/FUTURA — sprint CONCLUÍDA usa
 * o snapshot congelado (`SprintClosedSnapshot`, `sprint-recommendation.ts`),
 * nunca mais `sprint_planned_allocations`/`computeSprintPlannedSplit`
 * (removida: o "planejamento histórico" que ela reconstruía virou o
 * "planejamento original" congelado, uma fonte mais confiável porque não
 * depende de quantas vezes o orçamento foi redistribuído no meio do
 * caminho). */
export interface SprintRecommendationAmounts {
  totalRecommended: number;
  remainingRecommended: number;
}

export function computeSprintRecommendationAmounts(
  sprint: { actualSpend: number },
  remainingPlanned: number,
): SprintRecommendationAmounts {
  const safeRemaining = Math.max(remainingPlanned, 0);
  return {
    totalRecommended: sprint.actualSpend + safeRemaining,
    remainingRecommended: safeRemaining,
    // Nunca ultrapassa pra atual/futura: a recomendação total É `realizado +
    // restante` (nunca um alvo fixo que o realizado possa superar) — o único
    // jeito do realizado "ultrapassar" é o orçamento do MÊS já ter sido
    // atingido, o que já zera `remainingPlanned` (ver `computeMonthlyBudgetPlan`),
    // e aí `totalRecommended === actualSpend` (nunca menor).
  };
}

/** Texto operacional da RECOMENDAÇÃO de UMA sprint — nunca mais o "R$ X de
 * R$ Y previstos" ambíguo do resumo compacto (Etapa 70: renomeado de
 * `describeSprintInvestment` — "previsto" virou "recomendado" em toda a
 * interface, porque este é o número que o gestor deve seguir pra fechar o
 * mês no orçamento, não uma estimativa solta). Cobre os 3 estados:
 *
 * - futura: nunca "R$0 investidos de R$X planejados" (ainda não existe
 *   realizado, e o valor é uma recomendação dinâmica, não um planejamento
 *   fixo) — mostra só "R$X recomendados para esta sprint".
 * - atual: "R$X investidos · R$Y recomendados para esta sprint" — os dois
 *   números lado a lado, nunca "de" (que sugeria um teto, não uma meta).
 * - concluída: usa o snapshot congelado (`originalPlannedAmount`), nunca
 *   mais a recomendação dinâmica atual — "R$X investidos · R$Y planejados
 *   originalmente", ou "sem planejamento histórico registrado" quando nem
 *   isso existe (`originalPlannedAmount <= 0`, só quando a sprint nunca
 *   chegou a ser congelada por falta de qualquer orçamento configurado). */
export interface SprintInvestmentText {
  primary: string;
  secondary: string | null;
}

export function describeSprintRecommendation(
  sprint: { temporalStatus: SprintTemporalStatus; actualSpend: number },
  amounts: SprintRecommendationAmounts,
  originalPlannedAmount: number,
  formatCurrency: (value: number) => string,
): SprintInvestmentText {
  if (sprint.temporalStatus === "futura") {
    return { primary: `${formatCurrency(amounts.totalRecommended)} recomendados para esta sprint`, secondary: null };
  }

  if (sprint.temporalStatus === "atual") {
    return {
      primary: `${formatCurrency(sprint.actualSpend)} investidos · ${formatCurrency(amounts.totalRecommended)} recomendados para esta sprint`,
      secondary:
        amounts.remainingRecommended > 0 ? `${formatCurrency(amounts.remainingRecommended)} ainda recomendados para os dias restantes` : null,
    };
  }

  // concluída — nunca "de R$0 planejados" quando não existia planejamento
  // original congelado (`originalPlannedAmount <= 0` só acontece quando a
  // sprint nunca foi congelada por falta de qualquer orçamento).
  if (originalPlannedAmount <= 0) {
    return { primary: `${formatCurrency(sprint.actualSpend)} investidos · sem planejamento histórico registrado`, secondary: null };
  }
  return {
    primary: `${formatCurrency(sprint.actualSpend)} investidos · ${formatCurrency(originalPlannedAmount)} planejados originalmente`,
    secondary: null,
  };
}

/** Texto da origem + momento do gasto real exibido (Etapa 65, seções 4/6) —
 * `manualUpdatedAt`/`metaSyncedAt` em `undefined` (não `null`) significa "quem
 * chamou não buscou esse dado" (ex.: painel Sprints, que ainda não consulta
 * `manual_spend_updated_at` por sprint) — nesse caso devolve `null` (não
 * exibe nada, nunca afirma "sem atualização registrada" sobre um dado que
 * simplesmente não foi consultado). `null` de verdade (dado buscado, mas
 * nunca aconteceu) é o único caso que gera o texto "Sem atualização/
 * sincronização registrada". Nunca mistura a data das duas fontes. */
export function describeSpendSourceTimestamp(
  spendSource: SpendSource,
  manualUpdatedAt: string | null | undefined,
  metaSyncedAt: string | null | undefined,
  formatShortDateTime: (value: string) => string,
): string | null {
  if (spendSource === "manual") {
    if (manualUpdatedAt === undefined) return null;
    return manualUpdatedAt
      ? `Manual · Atualizado em ${formatShortDateTime(manualUpdatedAt)}`
      : "Manual · Sem atualização registrada";
  }
  if (metaSyncedAt === undefined) return null;
  return metaSyncedAt ? `Meta · Sincronizado em ${formatShortDateTime(metaSyncedAt)}` : "Meta · Sem sincronização registrada";
}

/** Uma linha de `sprint_planned_allocations` já buscada do banco — planejado
 * de um dia específico de uma sprint específica. */
export interface PlannedAllocationRow {
  date: string;
  sprintId: string;
  amount: number;
}

/**
 * Planejado de um cliente pertencente a um mês — soma direta das alocações
 * diárias (`sprint_planned_allocations`) cujo `date` cai no mês, independente
 * de qual sprint elas pertencem. Substitui a soma antiga de
 * `sprint.planned_spend` filtrando sprints por `start_date` no mês, que
 * atribuía 100% de uma sprint ao mês em que ela começou — o bug central que
 * a Etapa 50 corrige (o mesmo bug se repetiria hoje se uma sprint pudesse
 * cruzar a virada do mês; a correção final da Etapa 50 garante que nenhuma
 * sprint atravessa mês, mas a soma por interseção de data continua sendo a
 * fonte de verdade em vez de `sprint.planned_spend` filtrado por sprint).
 */
export function sumPlannedForMonth(
  plannedAllocations: PlannedAllocationRow[],
  monthRange: { firstDay: string; lastDay: string },
): number {
  return plannedAllocations
    .filter((a) => a.date >= monthRange.firstDay && a.date <= monthRange.lastDay)
    .reduce((sum, a) => sum + a.amount, 0);
}

/**
 * Gasto realizado de UMA sprint, pertencente a um mês — mesma decisão
 * manual×meta_api de `resolveSprintActualSpend`, recortada pelo mês: sprint
 * sincronizada soma só os dias de `daily_spend` dentro da interseção
 * sprint×mês (já granular por dia); sprint manual usa o valor único de
 * sempre (`manual_actual_spend`) — desde a correção da Etapa 50, nenhuma
 * sprint atravessa mais a fronteira do mês, então toda sprint pertence a
 * exatamente um mês e esse valor único já é sempre suficiente.
 */
export function computeSprintMonthActualSpend(
  sprint: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  },
  monthRange: { firstDay: string; lastDay: string },
  dailySpend: { date: string; spend: number }[],
): number {
  const overlapStart = sprint.start_date > monthRange.firstDay ? sprint.start_date : monthRange.firstDay;
  const overlapEnd = sprint.end_date < monthRange.lastDay ? sprint.end_date : monthRange.lastDay;
  if (overlapStart > overlapEnd) return 0;

  if (sprint.spend_source === "manual") {
    return sprint.manual_actual_spend ?? 0;
  }

  return dailySpend
    .filter((d) => d.date >= overlapStart && d.date <= overlapEnd)
    .reduce((sum, d) => sum + d.spend, 0);
}

/** Soma o gasto realizado de várias sprints, pertencente a um mês — versão
 * mensal de `sumEffectiveSpend`. Recebe TODAS as sprints que se sobrepõem ao
 * mês (não só as que começam nele) — quem monta essa lista precisa filtrar
 * por sobreposição (`start_date <= lastDay && end_date >= firstDay`), nunca
 * por `start_date` dentro do mês. */
export function sumActualSpendForMonth(
  sprints: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[],
  monthRange: { firstDay: string; lastDay: string },
  dailySpend: { date: string; spend: number }[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintMonthActualSpend(sprint, monthRange, dailySpend), 0);
}

/** Intervalo (YYYY-MM-DD) do mês corrente, usado pra filtrar sprints e daily_spend. */
export function currentMonthRange(today: Date = todayUTC()): { firstDay: string; lastDay: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  return {
    firstDay: firstDay.toISOString().slice(0, 10),
    lastDay: lastDay.toISOString().slice(0, 10),
  };
}

/** Desloca um `{firstDay}` de mês por `deltaMonths` e devolve o parâmetro
 * `?month=YYYY-MM` correspondente — usado pela navegação de mês (Visão
 * Geral, tela Sprints no modo Mensal), pra nunca duplicar essa conta. */
export function shiftMonthParam(monthRange: { firstDay: string }, deltaMonths: number): string {
  const d = new Date(`${monthRange.firstDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lê o mês selecionado (`?month=YYYY-MM`) da URL, ou usa o mês corrente se
 * ausente/inválido — mesmo parsing reutilizado por Operação e pela Visão
 * Geral, pra nunca duplicar essa regra. */
export function monthRangeFromParam(
  monthParam: string | undefined,
  today: Date = todayUTC(),
): { firstDay: string; lastDay: string } {
  if (monthParam) {
    const [yearStr, monthStr] = monthParam.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
      const firstDay = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(year, month + 1, 0));
      return { firstDay: firstDay.toISOString().slice(0, 10), lastDay: lastDay.toISOString().slice(0, 10) };
    }
  }
  return currentMonthRange(today);
}
