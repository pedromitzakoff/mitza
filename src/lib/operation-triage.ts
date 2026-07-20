import {
  DIMENSION_PRIORITY_ORDER,
  DIMENSION_SEVERITY_RANK,
  type AccountHealthEvaluation,
  type DimensionSeverity,
  type HealthStatus,
} from "@/lib/account-health-engine";
import { formatAgencyDateTime } from "@/lib/format";
import { APP_TIMEZONE } from "@/lib/today";
import type { PerformanceGoal } from "@/lib/performance-goals";

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
 * ação e só depois contexto. Por isso a ordenação (banda de saúde →
 * dimensão principal → nome) é sempre resolvida aqui, nunca recalculada na
 * UI, e por isso `OperationClientCard` carrega o `AccountHealthEvaluation`
 * inteiro (Etapa "Motor de Saúde da Conta") em vez de só um resumo — a
 * tela nunca reimplementa nenhuma classificação por conta própria.
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

/** Um cliente na fila da Operação — identidade mínima (nome, avatar,
 * gestor, objetivo de performance pro rótulo do termômetro de resultado) +
 * o `AccountHealthEvaluation` completo (Etapa "Motor de Saúde da Conta").
 * Substitui o antigo `OperationTriageClient` (formato resumido de
 * compatibilidade da primeira versão do redesenho) — nada fora dos
 * arquivos da própria Operação consumia aquele tipo. */
export interface OperationClientCard {
  clientId: string;
  clientName: string;
  managerName: string | null;
  avatarUrl: string | null;
  performanceGoal: PerformanceGoal | null;
  evaluation: AccountHealthEvaluation;
  overdueTasksCount: number;
  /** `daily_spend.synced_at` mais recente do cliente (qualquer canal) —
   * alimenta o indicador "Atualizado hoje/ontem/há N dias"
   * (`formatDataFreshnessLabel`). `null` = nunca sincronizado. */
  lastDataSyncAt: string | null;
}

const BAND_SEVERITY_RANK: Record<OperationTriageBand, number> = {
  precisa_atencao: 0,
  em_risco: 1,
  em_acompanhamento: 2,
  saudavel: 3,
};

const DIMENSION_PRIORITY_RANK: Record<keyof AccountHealthEvaluation["dimensions"], number> = Object.fromEntries(
  DIMENSION_PRIORITY_ORDER.map((key, index) => [key, index]),
) as Record<keyof AccountHealthEvaluation["dimensions"], number>;

function primaryDimensionSeverity(evaluation: AccountHealthEvaluation): DimensionSeverity {
  return evaluation.primaryDimension ? evaluation.dimensions[evaluation.primaryDimension].status : "nenhum";
}

/**
 * Ordenação da fila inteira (aprovada): banda (mais severa primeiro) →
 * dentro da banda, severidade da dimensão principal (hoje sempre empatada
 * dentro da banda, já que a banda É a pior severidade — mantido por
 * completude, sem custo) → prioridade do motivo definida pelo motor
 * (`DIMENSION_PRIORITY_ORDER`) → nome. Nenhum dos dois rankings é
 * recalculado aqui — ambos vêm de `account-health-engine.ts`, única fonte.
 */
export function sortOperationClientCards(cards: OperationClientCard[]): OperationClientCard[] {
  return [...cards].sort((a, b) => {
    const bandDiff =
      BAND_SEVERITY_RANK[bandFromHealthStatus(a.evaluation.healthStatus)] -
      BAND_SEVERITY_RANK[bandFromHealthStatus(b.evaluation.healthStatus)];
    if (bandDiff !== 0) return bandDiff;

    const severityDiff =
      DIMENSION_SEVERITY_RANK[primaryDimensionSeverity(b.evaluation)] -
      DIMENSION_SEVERITY_RANK[primaryDimensionSeverity(a.evaluation)];
    if (severityDiff !== 0) return severityDiff;

    const aPriority = a.evaluation.primaryDimension
      ? DIMENSION_PRIORITY_RANK[a.evaluation.primaryDimension]
      : DIMENSION_PRIORITY_ORDER.length;
    const bPriority = b.evaluation.primaryDimension
      ? DIMENSION_PRIORITY_RANK[b.evaluation.primaryDimension]
      : DIMENSION_PRIORITY_ORDER.length;
    const priorityDiff = aPriority - bPriority;
    if (priorityDiff !== 0) return priorityDiff;

    return a.clientName.localeCompare(b.clientName);
  });
}

/** Um cliente conta como "precisa de revisão" quando a cadência está ativa
 * (`enabled`) e já ultrapassou o prazo (`status !== "nenhum"`) — mesmo
 * critério que já decidia a severidade da dimensão de revisão no motor,
 * nunca recalculado aqui. */
function needsReview(card: OperationClientCard): boolean {
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
}

/**
 * Contadores operacionais do cabeçalho da Operação (Etapa "Fila de
 * Prioridades 1.0") — substitui os antigos contadores por banda de saúde/
 * dimensão de desvio, que exigiam entender o vocabulário do Motor de Saúde
 * pra fazer sentido. Estes quatro só respondem perguntas operacionais
 * diretas ("quantos clientes têm pendência?"), sem nenhuma banda/severidade
 * envolvida.
 */
export function summarizeOperationTriage(cards: OperationClientCard[]): OperationTriageSummary {
  let withPendingTasks = 0;
  let needingReview = 0;
  let withoutSync = 0;
  for (const card of cards) {
    if (card.overdueTasksCount > 0) withPendingTasks++;
    if (needsReview(card)) needingReview++;
    if (!card.evaluation.dimensions.investment.hasSyncedData) withoutSync++;
  }
  return { totalClients: cards.length, withPendingTasks, needingReview, withoutSync };
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

