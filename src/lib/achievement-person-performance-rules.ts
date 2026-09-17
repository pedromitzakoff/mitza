import { PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS } from "@/lib/achievement-thresholds";
import { highestMilestoneCrossed } from "@/lib/achievement-person-rules";
import type { AchievementCandidate } from "@/lib/achievement-types";
import type { PortfolioPerformanceSummary } from "@/lib/team-portfolio-performance";

/**
 * Etapa "Equipe — Fase 4: Conquistas e Insígnias Profissionais" — V1
 * reduzida (aprovada), só 3 detectores. Reaproveita 100% a infraestrutura
 * de Conquistas já existente (`operational_events`/`achievement_unlocked`/
 * `record_achievement_event`) e 100% a Fase 3 (`team-portfolio-performance.ts`)
 * — nenhum segundo motor, nenhuma tabela nova, nenhuma segunda definição de
 * "dentro da meta".
 *
 * Princípio central (mantido da Fase 3): cada cliente comparado contra a
 * PRÓPRIA meta; nunca CPA absoluto, nunca volume de investimento, nunca
 * comparação entre gestores. `PersonPerformanceAchievementContext` só é
 * montado quando o mês FECHOU (`isLastDayOfMonth`, ver `achievement-metrics.ts`)
 * — qualquer outro dia recebe um contexto vazio, nenhum detector dispara.
 *
 * Responsabilidade temporal (Fase 2): `portfolioSummary`/`consecutiveMonthsStreak`
 * só existem quando `client_manager_assignments` prova cobertura INTEGRAL do
 * mês (`resolveFullMonthCoverageClientIds`, `team-portfolio-performance.ts`)
 * — antes do deploy da Fase 2 (17/09/2026), nenhum mês tem essa prova, então
 * `portfolioSummary` é sempre `null` e os 3 detectores abaixo nunca disparam.
 * Isso não é um caso especial tratado aqui: é uma consequência estrutural de
 * como o contexto é montado — nenhum detector precisa saber que dia é hoje.
 */

export interface PersonPerformanceAchievementContext {
  teamMemberId: string;
  teamMemberName: string;
  /** Dia em que o mês fechou (sempre o último dia civil de `monthParam`) —
   * vira `occurredOnDate` de qualquer candidato emitido. */
  evaluatedOnDate: string;
  monthParam: string;
  monthLabel: string;
  /** `null` = sem cobertura integral de NENHUM cliente neste mês (nunca
   * confundido com "avaliou e deu zero" — ver `ManagerPortfolioMonthSummary`). */
  portfolioSummary: PortfolioPerformanceSummary | null;
  /** Sequência de meses fechados consecutivos, terminando em `monthParam`,
   * em que 100% da carteira avaliável (≥1 conta) ficou dentro da meta. `0` =
   * este mês não qualificou (ou não teve cobertura). */
  consecutiveMonthsStreak: number;
}

/**
 * `person_first_client_within_target` — "conquista única" (aprovado):
 * primeira vez em que QUALQUER conta sob responsabilidade temporal
 * confiável do gestor fecha um mês avaliável dentro da própria meta.
 * `windowKey` fixo (nunca inclui mês/cliente) — o motor (idempotência via
 * `ON CONFLICT DO NOTHING`) garante que só a PRIMEIRA vez em que isto é
 * verdade produz um evento real; meses seguintes com a mesma condição
 * continuam gerando o mesmo candidato (mesmo padrão de
 * `rulePersonFirstMeetingCompleted`), só que descartado pela idempotência.
 */
export function rulePersonFirstClientWithinTarget(ctx: PersonPerformanceAchievementContext): AchievementCandidate | null {
  const summary = ctx.portfolioSummary;
  if (!summary) return null;
  const example = summary.clients.find((client) => client.evaluable && client.withinTarget);
  if (!example) return null;

  return {
    type: "person_first_client_within_target",
    scope: "person",
    level: "account",
    family: "performance",
    severity: "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: "first_client_within_target",
    actorTeamMemberId: ctx.teamMemberId,
    clientId: example.clientId,
    clientName: example.clientName,
    metric: {
      metric: "cpa",
      actual: example.costActual ?? 0,
      unit: "currency",
      target: example.costTarget ?? undefined,
      windowLabel: ctx.monthLabel,
    },
    headline: `${ctx.teamMemberName} teve sua primeira conta dentro da meta`,
    detail: `${example.clientName} fechou ${ctx.monthLabel.toLowerCase()} dentro da própria meta de custo`,
  };
}

/**
 * `person_portfolio_fully_within_target` — CONQUISTA recorrente (aprovado:
 * "pode ocorrer novamente em meses diferentes e deve manter evidência do
 * mês"), nunca uma insígnia de patamar único. Exige ≥1 conta avaliável
 * (nunca "100% de zero") — contas sem avaliação confiável ficam fora do
 * denominador, exatamente como a Fase 3 já garante em `summarizePortfolioPerformance`.
 * `windowKey` inclui o mês — cada mês em que isto acontece é um evento
 * distinto, nunca suprimido pela idempotência de um mês anterior.
 */
export function rulePersonPortfolioFullyWithinTarget(ctx: PersonPerformanceAchievementContext): AchievementCandidate | null {
  const summary = ctx.portfolioSummary;
  if (!summary || summary.evaluableCount === 0 || summary.outsideTargetCount > 0) return null;

  return {
    type: "person_portfolio_fully_within_target",
    scope: "person",
    level: "account",
    family: "performance",
    severity: "highlight",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `portfolio_fully_within_target:${ctx.monthParam}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: {
      metric: "count",
      actual: summary.withinTargetCount,
      unit: "count",
      target: summary.evaluableCount,
      windowLabel: ctx.monthLabel,
    },
    headline: `${ctx.teamMemberName} fechou ${ctx.monthLabel.toLowerCase()} com toda a carteira avaliável dentro da meta`,
    detail: `${summary.withinTargetCount} de ${summary.evaluableCount} conta${summary.evaluableCount !== 1 ? "s" : ""} avaliável${summary.evaluableCount !== 1 ? "eis" : ""} dentro da própria meta`,
  };
}

/**
 * `person_consecutive_months_fully_within_target` — INSÍGNIA persistente de
 * consistência (aprovado). Só o MAIOR patamar cruzado por esta sequência é
 * emitido (`highestMilestoneCrossed`, mesma regra das famílias de
 * Experiência) — nunca 3 E 6 juntos no mesmo mês de fechamento. `windowKey`
 * inclui patamar + mês de fechamento: se a sequência quebrar e um novo
 * ciclo de 3/6 meses se formar depois, é um marco genuinamente novo (mês de
 * fechamento diferente), nunca suprimido pela conquista anterior — reexecutar
 * a avaliação do MESMO mês de fechamento, porém, produz sempre a mesma
 * chave (idempotente).
 */
export function rulePersonConsecutiveMonthsFullyWithinTarget(ctx: PersonPerformanceAchievementContext): AchievementCandidate | null {
  const threshold = highestMilestoneCrossed(ctx.consecutiveMonthsStreak, PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS);
  if (!threshold) return null;

  return {
    type: "person_consecutive_months_fully_within_target",
    scope: "person",
    level: "account",
    family: "performance",
    severity: threshold >= 6 ? "record" : "milestone",
    occurredOnDate: ctx.evaluatedOnDate,
    windowKey: `consecutive_months_fully_within_target:${threshold}:${ctx.monthParam}`,
    actorTeamMemberId: ctx.teamMemberId,
    metric: {
      metric: "count",
      actual: ctx.consecutiveMonthsStreak,
      unit: "count",
      target: threshold,
      windowLabel: ctx.monthLabel,
    },
    headline: `${ctx.teamMemberName} completou ${threshold} meses consecutivos com toda a carteira avaliável dentro da meta`,
    detail: `Sequência encerrada em ${ctx.monthLabel.toLowerCase()}`,
  };
}

export const PERSON_PERFORMANCE_RULES: ((ctx: PersonPerformanceAchievementContext) => AchievementCandidate | null)[] = [
  rulePersonFirstClientWithinTarget,
  rulePersonPortfolioFullyWithinTarget,
  rulePersonConsecutiveMonthsFullyWithinTarget,
];
