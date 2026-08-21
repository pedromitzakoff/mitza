import type { TrafficChannel } from "@/lib/traffic-channels";
import type { PerformanceGoal } from "@/lib/performance-goals";

/**
 * Núcleo puro de "gasto por objetivo" (Etapa "Múltiplos Objetivos") — sem
 * Supabase, sem saber de onde vêm as linhas. Princípio central da Auditoria
 * (seção 5/9/10, nunca violado): `goalSpend` só soma campanhas REALMENTE
 * classificadas àquele objetivo — nenhum rateio, nenhuma estimativa. Quando
 * a base não é 100% classificada, o custo por resultado do objetivo é
 * `null` — nunca um número calculado sobre uma base parcial disfarçada de
 * completa.
 */

export interface CampaignSpendRow {
  channel: TrafficChannel;
  /** `null` = campanha sem `campaign_id` capturado (fonte sem
   * `campaign_id_column` configurado) — nunca classificável, sempre conta
   * como "não classificada" na cobertura, nunca descartada da soma total. */
  campaignId: string | null;
  spend: number;
}

export interface CampaignAssignmentRow {
  channel: TrafficChannel;
  campaignId: string;
  resultType: PerformanceGoal;
}

/** Chave composta (canal + id) — mesma regra de identidade de
 * `client_campaign_goal_assignments` (auditoria seção 5: Meta e Google
 * podem ter o mesmo id/nome, nunca somados juntos). */
function campaignKey(channel: TrafficChannel, campaignId: string): string {
  return `${channel}:${campaignId}`;
}

/** Soma o spend das campanhas classificadas a UM `resultType` — nunca conta
 * campanha sem `campaignId` (nunca classificável) nem campanha classificada
 * a outro objetivo. */
export function computeGoalSpend(campaignSpend: CampaignSpendRow[], assignments: CampaignAssignmentRow[], resultType: PerformanceGoal): number {
  const assignedKeys = new Set(
    assignments.filter((a) => a.resultType === resultType).map((a) => campaignKey(a.channel, a.campaignId)),
  );
  return campaignSpend
    .filter((row) => row.campaignId !== null && assignedKeys.has(campaignKey(row.channel, row.campaignId)))
    .reduce((sum, row) => sum + row.spend, 0);
}

export interface AssignmentCoverage {
  totalCampaignSpend: number;
  /** Spend de campanhas classificadas a QUALQUER objetivo (não só o que
   * está sendo avaliado) — cobertura mede "quanto do universo já foi
   * decidido", não "quanto é meu". */
  assignedCampaignSpend: number;
  unassignedCampaignSpend: number;
  /** `null` quando `totalCampaignSpend` é `0` — "sem base" é um estado
   * diferente de "0% coberto" (nunca fabricar 0% quando não há nada pra
   * cobrir). */
  assignmentCoveragePct: number | null;
}

/**
 * Cobertura de classificação dentro de um ESCOPO já filtrado por quem chama
 * (normalmente os canais de UM objetivo — auditoria seção 9: a cobertura
 * que importa pro CPA de um objetivo é a do(s) canal(is) dele, nunca a da
 * conta inteira). Campanha sem `campaignId` conta como não classificada,
 * nunca é excluída do total (senão "cobertura" mentiria sobre spend real
 * que existe mas nunca pode ser classificado).
 */
export function computeAssignmentCoverage(campaignSpend: CampaignSpendRow[], assignments: CampaignAssignmentRow[]): AssignmentCoverage {
  const assignedKeys = new Set(assignments.map((a) => campaignKey(a.channel, a.campaignId)));
  const totalCampaignSpend = campaignSpend.reduce((sum, row) => sum + row.spend, 0);
  const assignedCampaignSpend = campaignSpend
    .filter((row) => row.campaignId !== null && assignedKeys.has(campaignKey(row.channel, row.campaignId)))
    .reduce((sum, row) => sum + row.spend, 0);
  const unassignedCampaignSpend = totalCampaignSpend - assignedCampaignSpend;
  const assignmentCoveragePct = totalCampaignSpend > 0 ? (assignedCampaignSpend / totalCampaignSpend) * 100 : null;
  return { totalCampaignSpend, assignedCampaignSpend, unassignedCampaignSpend, assignmentCoveragePct };
}

/** Regra central e ÚNICA de cobertura mínima (pedido explícito: "não
 * espalhar threshold") — 100% das campanhas com spend classificadas.
 * Qualquer tolerância futura por resíduo de arredondamento entra AQUI, e só
 * aqui — nenhum consumidor decide seu próprio número. */
export const FULL_COVERAGE_THRESHOLD_PCT = 100;

export function hasReliableCoverage(coverage: AssignmentCoverage): boolean {
  return coverage.assignmentCoveragePct !== null && coverage.assignmentCoveragePct >= FULL_COVERAGE_THRESHOLD_PCT;
}

export type GoalCostUnavailableReason =
  | "no_result"
  | "no_campaign_spend"
  | "incomplete_coverage"
  | "scope_not_comparable"
  | "available";

export interface GoalCostResult {
  costPerResult: number | null;
  reason: GoalCostUnavailableReason;
}

/**
 * Único lugar que decide se o custo por resultado de um objetivo pode ser
 * calculado — auditoria seção 9/40: "se o sistema não puder provar qual
 * spend pertence a um objetivo, não calcula custo". Nunca usa spend total
 * do canal como fallback — só `goalSpend` (soma real das campanhas
 * classificadas), e só quando a cobertura do escopo é confiável.
 */
export function resolveGoalCostPerResult(input: {
  resultCount: number;
  hasResult: boolean;
  goalSpend: number;
  coverage: AssignmentCoverage;
}): GoalCostResult {
  if (!input.hasResult) return { costPerResult: null, reason: "no_result" };
  if (!hasReliableCoverage(input.coverage)) return { costPerResult: null, reason: "incomplete_coverage" };
  if (input.goalSpend <= 0) return { costPerResult: null, reason: "no_campaign_spend" };
  if (input.resultCount === 0) return { costPerResult: null, reason: "no_result" };
  return { costPerResult: input.goalSpend / input.resultCount, reason: "available" };
}

/** Texto pronto pra UI (auditoria seção 9: "Custo indisponível" em vez de
 * número falso, sempre com motivo). */
export function describeGoalCostUnavailableReason(reason: GoalCostUnavailableReason): string | null {
  switch (reason) {
    case "no_result":
      return "Sem resultado registrado neste período";
    case "no_campaign_spend":
      return "Nenhuma campanha classificada teve investimento neste período";
    case "incomplete_coverage":
      return "Há campanhas sem objetivo definido";
    case "scope_not_comparable":
      return "Meta e realizado não cobrem os mesmos canais";
    case "available":
      return null;
  }
}
