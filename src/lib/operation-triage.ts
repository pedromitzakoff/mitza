import { formatAgencyDateTime } from "@/lib/format";
import { APP_TIMEZONE } from "@/lib/today";
import type { HealthStatus } from "@/lib/account-health-engine";
import type { ClientOperationalState } from "@/lib/client-operational-state";

/**
 * Suporte da tela Operação (fila de triagem, ordenação/contagem/navegação
 * de mês) — conceito NOVO, não uma evolução da Sprint. Nenhuma função aqui
 * importa de `lib/sprint-financials.ts`, `app/sprints/` ou
 * `app/operation/operation-data.ts` (o motor/a interface da Sprint), pra a
 * Operação poder evoluir sem carregar a Sprint junto. Independência da
 * Operação não significa ignorar onde o dado oficial mora, porém: o
 * investimento efetivo (`operation-triage-data.ts`) é resolvido chamando
 * `sumEffectiveSpendForMonth` (`lib/effective-spend.ts`, módulo de domínio
 * NEUTRO — nem da Sprint, nem da Operação) sobre uma query própria de
 * `sprints`, exatamente como a página do Cliente faz — nenhuma fórmula
 * duplicada em lugar nenhum, uma única implementação pras duas telas.
 *
 * A Operação não é um dashboard — é uma FILA DE TRABALHO. Um dashboard
 * tenta mostrar tudo; uma fila inteligente mostra primeiro o que exige
 * ação e só depois contexto. Ordenação e tipo do card foram promovidos
 * (Etapa "Consolidação da Arquitetura — Fase A") pra `lib/client-operational-state.ts`
 * — domínio neutro, não mais exclusivo da Operação, pronto pra a Visão
 * Geral/Relatórios migrarem numa PR futura. Este arquivo continua com o que
 * é genuinamente específico da Operação: a tradução pra "banda" (vocabulário
 * da tela), os contadores do cabeçalho e a navegação de mês.
 */

export type OperationTriageBand = "precisa_atencao" | "em_risco" | "em_acompanhamento" | "saudavel";

const BAND_BY_HEALTH_STATUS: Record<HealthStatus, OperationTriageBand> = {
  acao_necessaria: "precisa_atencao",
  em_risco: "em_risco",
  em_acompanhamento: "em_acompanhamento",
  saudavel: "saudavel",
};

/** `healthStatus` (vocabulário do motor) → banda (vocabulário da tela) —
 * único lugar que faz essa tradução; a chave interna `precisa_atencao`
 * nunca muda mesmo que o rótulo exibido vire "Ação necessária"
 * (`status-registry.ts`), preservando compatibilidade de quem já persiste/
 * lê esse valor (filtro na URL, por exemplo). */
export function bandFromHealthStatus(status: HealthStatus): OperationTriageBand {
  return BAND_BY_HEALTH_STATUS[status];
}

/** Um cliente conta como "precisa de revisão" quando a cadência está ativa
 * (`enabled`) e já ultrapassou o prazo (`status !== "nenhum"`) — mesmo
 * critério que já decidia a severidade da dimensão de revisão no motor,
 * nunca recalculado aqui. */
function needsReview(card: ClientOperationalState): boolean {
  const review = card.evaluation.dimensions.review;
  return review.enabled && review.status !== "nenhum";
}

export interface OperationTriageSummary {
  totalClients: number;
  /** Clientes com ao menos 1 tarefa pendente/atrasada. */
  withPendingTasks: number;
  /** Clientes com revisão de conta em atraso. */
  needingReview: number;
  /** Clientes sem nenhum dado de investimento sincronizado neste mês. */
  withoutSync: number;
  /** Clientes cujo relatório mensal ainda não foi finalizado (Etapa "MITZA
   * 2.0 — Fase G"). Um relatório pendente é, por definição, algo que exige
   * atenção do gestor — a mesma pergunta que a Operação já responde pras
   * outras 3 contagens, nunca uma tela própria (a lista de Relatórios saiu
   * da navegação principal nesta fase). */
  withPendingReport: number;
}

/**
 * Contadores operacionais do cabeçalho da Operação (Etapa "Fila de
 * Prioridades 1.0") — substitui os antigos contadores por banda de saúde/
 * dimensão de desvio, que exigiam entender o vocabulário do Motor de Saúde
 * pra fazer sentido. Estes só respondem perguntas operacionais diretas
 * ("quantos clientes têm pendência?"), sem nenhuma banda/severidade
 * envolvida.
 *
 * `pendingReportClientIds` (Etapa "MITZA 2.0 — Fase G") vem de fora — status
 * de relatório mensal não é uma dimensão do Motor de Saúde, é um dado
 * próprio de `monthly_reports`, resolvido por quem chama (`operation/page.tsx`),
 * nunca recalculado aqui.
 */
export function summarizeOperationTriage(
  cards: ClientOperationalState[],
  pendingReportClientIds: ReadonlySet<string>,
): OperationTriageSummary {
  let withPendingTasks = 0;
  let needingReview = 0;
  let withoutSync = 0;
  let withPendingReport = 0;
  for (const card of cards) {
    if (card.overdueTasksCount > 0) withPendingTasks++;
    if (needsReview(card)) needingReview++;
    if (!card.evaluation.dimensions.investment.hasSyncedData) withoutSync++;
    if (pendingReportClientIds.has(card.clientId)) withPendingReport++;
  }
  return { totalClients: cards.length, withPendingTasks, needingReview, withoutSync, withPendingReport };
}

const freshnessDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE });

function daysBetweenDateStrings(earlier: string, later: string): number {
  const a = new Date(`${earlier}T00:00:00Z`);
  const b = new Date(`${later}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * "Atualizado hoje às 09:32" / "Atualizado ontem às 18:04" / "Sem
 * atualização há N dias" — indicador de confiança nos números exibidos
 * (aumenta a confiança do gestor de que o card reflete a realidade, não um
 * cache velho). A partir do `lastDataSyncAt` (`daily_spend.synced_at` mais
 * recente do cliente). O horário só aparece pra hoje/ontem (onde é preciso
 * o bastante pra ser útil); atualizações mais antigas mostram só a
 * contagem de dias. Datas comparadas no fuso da agência (`APP_TIMEZONE`),
 * nunca UTC cru — mesma régua de `todayDateString`.
 */
export function formatDataFreshnessLabel(lastSyncedAt: string | null, todayStr: string): string {
  if (!lastSyncedAt) return "Sem dados sincronizados";
  const syncedDate = new Date(lastSyncedAt);
  const syncedDateStr = freshnessDayFormatter.format(syncedDate);
  const daysAgo = daysBetweenDateStrings(syncedDateStr, todayStr);
  const time = formatAgencyDateTime(syncedDate).time;
  if (daysAgo <= 0) return `Atualizado hoje às ${time}`;
  if (daysAgo === 1) return `Atualizado ontem às ${time}`;
  return `Sem atualização há ${daysAgo} dias`;
}

/** Desloca um parâmetro de mês (`YYYY-MM-01`) em N meses — helper local e
 * mínimo (não importa de `lib/sprint-financials.ts`, que é código da
 * Sprint) só pra navegação do seletor de período desta tela. */
export function shiftOperationMonth(monthParam: string, deltaMonths: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** `{firstDay, lastDay}` do mês do parâmetro da Operação — helper local e
 * mínimo (mesma razão de `shiftOperationMonth`: nunca importar de
 * `lib/sprint-financials.ts`) só pra alimentar `computeMonthlyExpectedPct`/
 * `resolveMonthlyPlanSnapshot` com o intervalo real do mês (nunca o
 * "-31" fixo usado pelos filtros de `daily_spend`/`performance_records`,
 * que só precisam de um limite superior generoso, não do último dia real). */
export function monthRangeFromOperationParam(monthParam: string): { firstDay: string; lastDay: string } {
  const [year, month] = monthParam.split("-").map(Number);
  const lastDay = daysInMonth(year, month);
  return { firstDay: monthParam, lastDay: `${monthParam.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

