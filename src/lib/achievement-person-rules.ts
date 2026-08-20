import {
  PERSON_CLIENTS_SERVED_MILESTONES,
  PERSON_OPTIMIZATIONS_MILESTONES,
  PERSON_REPORTS_MILESTONES,
  PERSON_REVIEWS_MILESTONES,
  PERSON_TENURE_MONTHS_MILESTONES,
} from "@/lib/achievement-thresholds";
import type { AchievementCandidate } from "@/lib/achievement-types";

/**
 * Regras de Pessoa da V1 — trajetória e experiência individual, NUNCA
 * produtividade relativa (Auditoria, seções 19-20). Nenhuma regra aqui
 * compara um gestor com outro; todo candidato usa só a contagem do PRÓPRIO
 * gestor. Mesmo princípio de patamar único + idempotência das regras de
 * Agência.
 *
 * Todas as 7 regras são seguras pro backfill retroativo
 * (`scripts/backfill-achievements.ts`) sem exclusão nenhuma — diferente de
 * Agência, aqui toda contagem vem de `operational_events` (tem
 * `occurred_at` histórico real) ou de `team_members.created_at` (data real
 * de cadastro), nunca de um campo de estado atual sem histórico.
 */

export interface PersonAchievementContext {
  teamMemberId: string;
  teamMemberName: string;
  /** Dia fechado sendo avaliado — "ontem" no cron diário, uma data
   * histórica arbitrária no backfill. */
  evaluatedOnDate: string;
  reviewsCount: number;
  /** Mesma contagem com corte em `evaluatedOnDate - 1` — só pra detectar
   * cruzamento de patamar, nunca pra exibição (ver
   * `achievement-agency-rules.ts`, mesmo padrão, mesma razão: sem isso um
   * marco já atingido ANTES da janela de backfill "dispararia" de novo no
   * primeiro dia processado). */
  reviewsCountPreviousDay: number;
  /** `account_optimization_recorded` reais atribuídas a este gestor. */
  optimizationsCount: number;
  optimizationsCountPreviousDay: number;
  /** Clientes DISTINTOS em que este gestor já registrou pelo menos 1
   * revisão — proxy de "atendeu" (mesma fonte de dado da regra de
   * revisões, nunca uma segunda leitura). */
  distinctClientsServedCount: number;
  distinctClientsServedCountPreviousDay: number;
  reportsSentCount: number;
  reportsSentCountPreviousDay: number;
  /** Meses desde `team_members.created_at` — proxy de tempo de casa (data
   * de cadastro no sistema, não necessariamente a data formal de
   * contratação; documentado explicitamente porque é a única informação
   * disponível hoje). */
  tenureMonths: number;
  tenureMonthsPreviousDay: number;
  /** Já bounded por `evaluatedOnDate` por quem monta o contexto — o
   * cruzamento "só no dia certo" sai de graça aqui: `windowKey` é uma
   * constante fixa (`first_meeting`), então processar em ordem cronológica
   * + idempotência já garante que só o primeiro dia em que isso vira
   * `true` gera o evento (ver `achievement-metrics.ts`). */
  firstMeetingCompleted: boolean;
  firstCreativeDeliveryCompleted: boolean;
}

function highestMilestoneCrossed(current: number, milestones: number[]): number | undefined {
  return milestones.find((m) => current >= m);
}

function isSameMilestoneAsYesterday(current: number, previousDay: number, milestones: number[]): boolean {
  return highestMilestoneCrossed(current, milestones) === highestMilestoneCrossed(previousDay, milestones);
}

export function rulePersonReviewsMilestone(ctx: PersonAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.reviewsCount, PERSON_REVIEWS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.reviewsCount, ctx.reviewsCountPreviousDay, PERSON_REVIEWS_MILESTONES)) return null;

  return {
    type: "person_reviews_milestone",
    scope: "person",
    family: "revisoes",
    severity: milestone >= 500 ? "record" : milestone === 1 ? "milestone" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `reviews:${milestone}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: ctx.reviewsCount, unit: "count", target: milestone },
    headline: milestone === 1 ? `${ctx.teamMemberName} registrou sua primeira revisão` : `${ctx.teamMemberName} registrou sua ${milestone}ª revisão`,
    detail: `${milestone} revisões estruturadas registradas ao todo`,
  };
}

export function rulePersonOptimizationsMilestone(ctx: PersonAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.optimizationsCount, PERSON_OPTIMIZATIONS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.optimizationsCount, ctx.optimizationsCountPreviousDay, PERSON_OPTIMIZATIONS_MILESTONES)) return null;

  return {
    type: "person_optimizations_milestone",
    scope: "person",
    family: "otimizacoes",
    severity: milestone >= 500 ? "record" : milestone === 1 ? "milestone" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `optimizations:${milestone}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: ctx.optimizationsCount, unit: "count", target: milestone },
    headline: milestone === 1 ? `${ctx.teamMemberName} registrou sua primeira otimização` : `${ctx.teamMemberName} registrou sua ${milestone}ª otimização`,
    detail: `${milestone} otimizações reais registradas ao todo`,
  };
}

export function rulePersonClientsServedMilestone(ctx: PersonAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.distinctClientsServedCount, PERSON_CLIENTS_SERVED_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.distinctClientsServedCount, ctx.distinctClientsServedCountPreviousDay, PERSON_CLIENTS_SERVED_MILESTONES)) return null;

  return {
    type: "person_clients_served_milestone",
    scope: "person",
    family: "clientes_atendidos",
    severity: milestone >= 50 ? "record" : milestone === 1 ? "milestone" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `clients_served:${milestone}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: ctx.distinctClientsServedCount, unit: "count", target: milestone },
    headline: milestone === 1 ? `${ctx.teamMemberName} atendeu seu primeiro cliente` : `${ctx.teamMemberName} já atendeu ${milestone} clientes diferentes`,
    detail: `${milestone} clientes distintos atendidos ao todo`,
  };
}

export function rulePersonReportsMilestone(ctx: PersonAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.reportsSentCount, PERSON_REPORTS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.reportsSentCount, ctx.reportsSentCountPreviousDay, PERSON_REPORTS_MILESTONES)) return null;

  return {
    type: "person_reports_milestone",
    scope: "person",
    family: "reports",
    severity: milestone >= 100 ? "record" : milestone === 1 ? "milestone" : "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `reports:${milestone}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: ctx.reportsSentCount, unit: "count", target: milestone },
    headline: milestone === 1 ? `${ctx.teamMemberName} enviou seu primeiro report` : `${ctx.teamMemberName} já enviou ${milestone} reports`,
    detail: `${milestone} reports enviados a clientes ao todo`,
  };
}

export function rulePersonTenureMilestone(ctx: PersonAchievementContext): AchievementCandidate | null {
  const milestone = highestMilestoneCrossed(ctx.tenureMonths, PERSON_TENURE_MONTHS_MILESTONES);
  if (!milestone) return null;
  if (isSameMilestoneAsYesterday(ctx.tenureMonths, ctx.tenureMonthsPreviousDay, PERSON_TENURE_MONTHS_MILESTONES)) return null;

  const label = milestone >= 24 ? `${milestone / 12} anos` : milestone === 12 ? "1 ano" : `${milestone} meses`;

  return {
    type: "person_tenure_milestone",
    scope: "person",
    family: "tempo_de_casa",
    severity: "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `tenure:${milestone}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: ctx.tenureMonths, unit: "count", target: milestone },
    headline: `${ctx.teamMemberName} completou ${label} de casa`,
    detail: `Trajetória na agência: ${label}`,
  };
}

export function rulePersonFirstMeetingCompleted(ctx: PersonAchievementContext): AchievementCandidate | null {
  if (!ctx.firstMeetingCompleted) return null;

  return {
    type: "person_first_meeting_completed",
    scope: "person",
    family: "experiencia",
    severity: "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: "first_meeting",
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: 1, unit: "count" },
    headline: `${ctx.teamMemberName} concluiu sua primeira reunião`,
    detail: "Primeira reunião registrada",
  };
}

export function rulePersonFirstCreativeDeliveryCompleted(ctx: PersonAchievementContext): AchievementCandidate | null {
  if (!ctx.firstCreativeDeliveryCompleted) return null;

  return {
    type: "person_first_creative_delivery_completed",
    scope: "person",
    family: "experiencia",
    severity: "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: "first_creative_delivery",
    actorTeamMemberId: ctx.teamMemberId,
    metric: { metric: "count", actual: 1, unit: "count" },
    headline: `${ctx.teamMemberName} concluiu sua primeira entrega de criativo`,
    detail: "Primeira entrega de criativo registrada",
  };
}

export const PERSON_RULES: ((ctx: PersonAchievementContext) => AchievementCandidate | null)[] = [
  rulePersonReviewsMilestone,
  rulePersonOptimizationsMilestone,
  rulePersonClientsServedMilestone,
  rulePersonReportsMilestone,
  rulePersonTenureMilestone,
  rulePersonFirstMeetingCompleted,
  rulePersonFirstCreativeDeliveryCompleted,
];
