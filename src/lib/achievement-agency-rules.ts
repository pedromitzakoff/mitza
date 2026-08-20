import { isLastDayOfMonth } from "@/lib/achievement-dates";
import {
  AGENCY_ACTIVE_CLIENTS_MILESTONES,
  AGENCY_HEALTHY_WALLET_MILESTONES,
  AGENCY_MEDIA_SCALE_MILESTONES,
  AGENCY_OPTIMIZATIONS_MILESTONES,
  AGENCY_REPORTS_MILESTONES,
  AGENCY_REVIEWS_MILESTONES,
} from "@/lib/achievement-thresholds";
import type { AchievementCandidate } from "@/lib/achievement-types";
import { formatCurrency, formatPercent } from "@/lib/format";

/**
 * Regras de Agência da V1 — marcos de escala/maturidade/qualidade de
 * carteira/volume operacional (Auditoria, seção 18), nunca performance de
 * mídia de um cliente individual. Todas puras (sem I/O), todas sem estado:
 * cada regra checa se a contagem ATUAL cruza algum patamar da escada
 * (`achievement-thresholds.ts`) e devolve só o MAIOR patamar satisfeito —
 * a idempotência (`achievement:agency:{orgId}:{type}:{threshold}`) garante
 * que um patamar já registrado nunca dispara de novo, mesmo que a regra
 * "tente" de novo todo dia em que a contagem continua acima dele (mesmo
 * padrão das regras de Cliente).
 *
 * "Performance agregada da agência" (seção 18) foi deliberadamente
 * excluída da V1 — misturaria clientes com metas/objetivos diferentes, o
 * próprio pedido de aprovação já reconhece isso como matematicamente
 * inválido.
 */

export interface AgencyAchievementContext {
  organizationId: string;
  /** Dia fechado sendo avaliado — "ontem" no cron diário, uma data
   * histórica arbitrária no backfill (Etapa "Backfill 30 dias"). */
  evaluatedOnDate: string;
  activeClientsCount: number;
  /** `null` = nenhum cliente ativo (nada a avaliar). */
  healthyWalletFraction: number | null;
  /** `true` quando nenhum cliente ativo está no pior nível de saúde
   * (`acao_necessaria`) — condição extra do patamar 100% (seção 18: "sem
   * clientes críticos"). */
  noCriticalWallet: boolean;
  totalReviewsCount: number;
  /** Mesma contagem, mas com corte em `evaluatedOnDate - 1` — usada só pra
   * detectar CRUZAMENTO (o patamar mudou entre ontem e hoje), nunca pra
   * exibição. Essencial pro backfill: sem isso, um patamar já atingido
   * ANTES da janela de 30 dias voltaria a "disparar" artificialmente no
   * primeiro dia processado (Etapa "Backfill 30 dias" — "não recriar
   * marco cumulativo já atingido antes da janela"). Pro cron diário isso é
   * redundante com a idempotência (nunca dispara duas vezes de qualquer
   * forma), mas é a MESMA regra nos dois contextos — nenhuma versão
   * paralela. */
  totalReviewsCountPreviousDay: number;
  /** `account_optimization_recorded` reais — nunca o indicador
   * "Otimizações no mês" (que conta revisões, não otimizações de verdade;
   * achado da Auditoria de Atividades Operacionais). */
  totalOptimizationsCount: number;
  totalOptimizationsCountPreviousDay: number;
  totalReportsSentCount: number;
  totalReportsSentCountPreviousDay: number;
  /** Soma de `daily_spend` de todos os clientes ativos no mês que ACABOU
   * de fechar — só presente quando `evaluatedOnDate` é o último dia do
   * mês (mesmo padrão do recorde de mês fechado do Cliente). */
  closedMonthTotalSpend: number | null;
}

function highestMilestoneCrossed(current: number, milestones: number[]): number | undefined {
  return milestones.find((m) => current >= m);
}

/** `true` quando o patamar de hoje já era o mesmo ontem — ou seja, NÃO é
 * um cruzamento novo (é sustentado, não recém-atingido). Usado pelas
 * regras cumulativas de Agência/Pessoa; ver comentário de
 * `totalReviewsCountPreviousDay`. */
function isSameMilestoneAsYesterday(current: number, previousDay: number, milestones: number[]): boolean {
  return highestMilestoneCrossed(current, milestones) === highestMilestoneCrossed(previousDay, milestones);
}

export function ruleAgencyActiveClientsMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.activeClientsCount, AGENCY_ACTIVE_CLIENTS_MILESTONES);
  if (!milestone) return null;

  return {
    type: "agency_active_clients_milestone",
    scope: "agency",
    family: "crescimento",
    severity: milestone >= 100 ? "record" : milestone >= 50 ? "highlight" : "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `active_clients:${milestone}`,
    metric: { metric: "count", actual: ctx.activeClientsCount, unit: "count", target: milestone },
    headline: `A agência atingiu ${milestone} clientes ativos`,
    detail: `Marco de crescimento: ${milestone} contas ativas ao mesmo tempo`,
  };
}

export function ruleAgencyHealthyWalletMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  if (ctx.healthyWalletFraction === null) return null;

  // O múltiplo 1.0 (100%) exige, além da fração, nenhum cliente crítico —
  // é um patamar qualitativamente diferente de 80%/90% (seção 18: "100%
  // sem clientes críticos"), nunca só o mesmo cálculo de fração levado ao
  // limite.
  const eligibleMilestones = AGENCY_HEALTHY_WALLET_MILESTONES.filter((m) => (m >= 1 ? ctx.noCriticalWallet : true));
  const milestone = eligibleMilestones.find((m) => ctx.healthyWalletFraction! >= m);
  if (!milestone) return null;

  return {
    type: "agency_healthy_wallet_milestone",
    scope: "agency",
    family: "carteira",
    severity: milestone >= 1 ? "record" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `healthy_wallet:${milestone}`,
    metric: { metric: "count", actual: ctx.healthyWalletFraction, unit: "ratio", target: milestone },
    headline:
      milestone >= 1
        ? "A agência atingiu 100% da carteira saudável, sem nenhum cliente crítico"
        : `A agência atingiu pela primeira vez ${formatPercent(milestone * 100)} da carteira saudável`,
    detail: `${formatPercent(ctx.healthyWalletFraction * 100)} dos clientes ativos estão com saúde de conta saudável`,
  };
}

export function ruleAgencyReviewsMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.totalReviewsCount, AGENCY_REVIEWS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.totalReviewsCount, ctx.totalReviewsCountPreviousDay, AGENCY_REVIEWS_MILESTONES)) return null;

  return {
    type: "agency_reviews_milestone",
    scope: "agency",
    family: "operacao",
    severity: milestone >= 1000 ? "record" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `reviews:${milestone}`,
    metric: { metric: "count", actual: ctx.totalReviewsCount, unit: "count", target: milestone },
    headline: `A agência completou ${milestone} revisões estruturadas`,
    detail: `${milestone} análises de conta registradas ao todo`,
  };
}

export function ruleAgencyOptimizationsMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.totalOptimizationsCount, AGENCY_OPTIMIZATIONS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.totalOptimizationsCount, ctx.totalOptimizationsCountPreviousDay, AGENCY_OPTIMIZATIONS_MILESTONES)) return null;

  return {
    type: "agency_optimizations_milestone",
    scope: "agency",
    family: "operacao",
    severity: milestone >= 1000 ? "record" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `optimizations:${milestone}`,
    metric: { metric: "count", actual: ctx.totalOptimizationsCount, unit: "count", target: milestone },
    headline: `A agência completou ${milestone} otimizações reais`,
    detail: `${milestone} alterações estruturadas (account_optimizations) registradas ao todo`,
  };
}

export function ruleAgencyReportsMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.totalReportsSentCount, AGENCY_REPORTS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.totalReportsSentCount, ctx.totalReportsSentCountPreviousDay, AGENCY_REPORTS_MILESTONES)) return null;

  return {
    type: "agency_reports_milestone",
    scope: "agency",
    family: "relacionamento",
    severity: milestone >= 1000 ? "record" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `reports:${milestone}`,
    metric: { metric: "count", actual: ctx.totalReportsSentCount, unit: "count", target: milestone },
    headline: `A agência enviou ${milestone} reports aos clientes`,
    detail: `${milestone} reports estruturados enviados ao todo`,
  };
}

export function ruleAgencyMediaScaleMilestone(ctx: AgencyAchievementContext): AchievementCandidate | null {
  if (!isLastDayOfMonth(ctx.evaluatedOnDate) || ctx.closedMonthTotalSpend === null) return null;

  const milestone = highestMilestoneCrossed(ctx.closedMonthTotalSpend, AGENCY_MEDIA_SCALE_MILESTONES);
  if (!milestone) return null;

  return {
    type: "agency_media_scale_milestone",
    scope: "agency",
    family: "escala_midia",
    severity: "record",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `media_scale:${milestone}`,
    metric: { metric: "investment", actual: ctx.closedMonthTotalSpend, unit: "currency", target: milestone },
    headline: `A agência geriu ${formatCurrency(milestone)} em investimento num único mês pela primeira vez`,
    detail: `${formatCurrency(ctx.closedMonthTotalSpend)} investidos no mês em toda a carteira`,
  };
}

export const AGENCY_RULES: ((ctx: AgencyAchievementContext) => AchievementCandidate | null)[] = [
  ruleAgencyActiveClientsMilestone,
  ruleAgencyHealthyWalletMilestone,
  ruleAgencyReviewsMilestone,
  ruleAgencyOptimizationsMilestone,
  ruleAgencyReportsMilestone,
  ruleAgencyMediaScaleMilestone,
];

/** Subconjunto seguro pra reexecução histórica (`scripts/backfill-achievements.ts`)
 * — exclui as duas regras que dependem de um snapshot que o banco não
 * versiona:
 *
 * - `ruleAgencyActiveClientsMilestone` lê `clients.status` (estado ATUAL,
 *   sem histórico — não existe "estava ativo em tal data"). Reconstruir
 *   isso pra uma data de 20 dias atrás seria inventar dado que não existe.
 * - `ruleAgencyMediaScaleMilestone` teria que comparar o mês fechado
 *   contra TODO mês fechado anterior (mesmo espírito do recorde de mês
 *   fechado do Cliente) pra não recriar artificialmente um patamar já
 *   superado por um mês fora da janela de 30 dias — fora do escopo desta
 *   etapa (ver relatório do backfill).
 *
 * Ambas continuam rodando normalmente no cron diário (`AGENCY_RULES`,
 * acima) — não são removidas do produto, só do backfill retroativo. */
export const AGENCY_BACKFILL_SAFE_RULES: ((ctx: AgencyAchievementContext) => AchievementCandidate | null)[] = [
  ruleAgencyReviewsMilestone,
  ruleAgencyOptimizationsMilestone,
  ruleAgencyReportsMilestone,
];
