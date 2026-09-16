import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatPerformanceResult } from "@/lib/performance-goals";
import { formatCurrency, formatPercent } from "@/lib/format";
import { addDays } from "@/lib/achievement-dates";
import { evaluateSubEntityEvolution, findSubEntityDestaque, summarizeSubEntities, type SubEntityDailyRow } from "@/lib/achievement-sub-entity";
import { EVOLUTION_CPA_IMPROVEMENT_PCT } from "@/lib/achievement-thresholds";
import type { AchievementCandidate, AchievementLevel } from "@/lib/achievement-types";

/**
 * Regras de Campanha/Público/Criativo (Etapa "Conquistas por Granularidade")
 * — duas famílias, cada uma parametrizada por nível e chamada 3x pelo motor
 * (`achievement-engine.ts`), nunca triplicada em 3 arquivos quase idênticos:
 * campanha/público/criativo compartilham exatamente a mesma forma de dado
 * (`SubEntityDailyRow`) e a mesma lógica de comparação
 * (`achievement-sub-entity.ts`). Escala/"novo criativo"/"criativo
 * responsável por X% dos resultados" NÃO têm regra aqui — auditoria concluiu
 * que os dados atuais não sustentam essas afirmações com confiança (sem
 * data de primeira aparição, sem atribuição de resultado por criativo
 * isolado de forma confiável) — ver relatório final.
 *
 * Mesma disciplina de anti-spam do nível conta (`achievement-client-rules.ts`):
 * cada regra só emite quando a condição passa a valer HOJE mas não valia
 * ONTEM — nunca floodando um patamar sustentado por semanas. Por isso
 * `SubEntityAchievementContext.rows` sempre cobre 15 dias fechados
 * terminando ontem (7 dias atuais + 7 anteriores + 1 dia extra pra recalcular
 * a mesma checagem "como estava ontem").
 */

export interface SubEntityAchievementContext {
  clientId: string;
  clientName: string;
  yesterday: string;
  performanceGoal: PerformanceGoal | null;
  level: Exclude<AchievementLevel, "account">;
  /** 15 dias fechados terminando ontem (`addDays(yesterday, -14)` até
   * `yesterday`) — nunca mais que isso, nunca menos (ver doc do arquivo). */
  rows: SubEntityDailyRow[];
}

function resultNoun(count: number, goal: PerformanceGoal | null): string {
  return goal ? formatPerformanceResult(count, goal) : `${count} resultados`;
}

function rowsBetween(rows: SubEntityDailyRow[], from: string, to: string): SubEntityDailyRow[] {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

/**
 * DESTAQUE — a entidade (campanha/público/criativo) com uma vantagem
 * MATERIAL de CPA/CPL sobre o CONJUNTO das demais entidades comparáveis nos
 * últimos 7 dias (`SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT`), entre
 * concorrentes com amostra válida (`SUB_ENTITY_MIN_COMPARABLE_ENTITIES`,
 * `achievement-thresholds.ts`).
 *
 * Revisão pós-aprovação: mudar de líder (menor CPA hoje vs. ontem) nunca é
 * suficiente sozinho — diferenças de ranking podem ser irrelevantes.
 * `findSubEntityDestaque` já embute o piso de vantagem material (contra o
 * agregado das demais, nunca só a 2ª colocada isolada); esta regra só
 * precisa comparar se a entidade com vantagem material HOJE é a MESMA que
 * já tinha vantagem material ONTEM — anti-spam por CRUZAMENTO da condição
 * (mesmo espírito das regras de Evolução/Escala do nível conta), nunca só
 * "a liderança mudou".
 */
export function ruleSubEntityDestaque(ctx: SubEntityAchievementContext): AchievementCandidate | null {
  const todayCurrent = rowsBetween(ctx.rows, addDays(ctx.yesterday, -6), ctx.yesterday);
  const todayResult = findSubEntityDestaque(summarizeSubEntities(todayCurrent, ctx.performanceGoal));
  if (!todayResult) return null;

  const yesterdayCurrent = rowsBetween(ctx.rows, addDays(ctx.yesterday, -7), addDays(ctx.yesterday, -1));
  const yesterdayResult = findSubEntityDestaque(summarizeSubEntities(yesterdayCurrent, ctx.performanceGoal));
  // Só emite quando ESTA entidade passa a ter vantagem MATERIAL hoje — se
  // ontem ela já era a destaque com vantagem material, não é novidade
  // (`yesterdayResult` só existe quando já passou no piso de
  // `SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT`, então esta comparação nunca
  // suprime uma virada de líder que ainda não tinha vantagem material).
  if (yesterdayResult && yesterdayResult.winner.key === todayResult.winner.key) return null;

  const { winner, rest, advantagePct } = todayResult;
  const cpa = winner.agg.cpa as number;

  return {
    type: `${ctx.level}_destaque_best_cpa`,
    scope: "client",
    family: "destaque",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `sub_destaque:${ctx.level}:${winner.key}:${ctx.yesterday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    level: ctx.level,
    entityName: winner.name,
    metric: {
      metric: "cpa",
      actual: cpa,
      unit: "currency",
      comparisonActual: rest.cpa,
      windowStart: addDays(ctx.yesterday, -6),
      windowEnd: ctx.yesterday,
      windowLabel: "7 dias",
      sampleSpend: winner.agg.spend,
      sampleResultCount: winner.agg.resultCount,
      sampleRevenue: winner.agg.revenue,
      comparisonSpend: rest.spend,
      comparisonResultCount: rest.resultCount,
      comparisonRevenue: rest.revenue,
    },
    headline: `"${winner.name}" tem o melhor CPA da conta nos últimos 7 dias`,
    detail: `${resultNoun(winner.agg.resultCount, ctx.performanceGoal)} · CPA ${formatCurrency(cpa)} · ${formatPercent(advantagePct * 100)} abaixo dos demais`,
  };
}

/**
 * EVOLUÇÃO — CPA/CPL de UMA entidade melhorou ≥20% (mesmo limiar do nível
 * conta, `EVOLUTION_CPA_IMPROVEMENT_PCT` — reaproveitado, nunca um segundo
 * número inventado sem evidência de que precise ser diferente) vs. os 7
 * dias anteriores. Quando mais de uma entidade cruza no mesmo dia, emite só
 * a de MAIOR melhora (uma regra nunca gera mais de 1 candidato — o motor já
 * tem seu próprio teto por cliente/dia, `MAX_CLIENT_ACHIEVEMENTS_PER_DAY`,
 * mas cada função de regra individual continua devolvendo no máximo 1,
 * mesmo contrato de toda regra do motor).
 */
export function ruleSubEntityEvolution(ctx: SubEntityAchievementContext): AchievementCandidate | null {
  const todayCurrent = rowsBetween(ctx.rows, addDays(ctx.yesterday, -6), ctx.yesterday);
  const todayPrevious = rowsBetween(ctx.rows, addDays(ctx.yesterday, -13), addDays(ctx.yesterday, -7));
  const todayResults = evaluateSubEntityEvolution(
    summarizeSubEntities(todayCurrent, ctx.performanceGoal),
    summarizeSubEntities(todayPrevious, ctx.performanceGoal),
    EVOLUTION_CPA_IMPROVEMENT_PCT,
  );
  if (todayResults.length === 0) return null;

  const yesterdayCurrent = rowsBetween(ctx.rows, addDays(ctx.yesterday, -7), addDays(ctx.yesterday, -1));
  const yesterdayPrevious = rowsBetween(ctx.rows, addDays(ctx.yesterday, -14), addDays(ctx.yesterday, -8));
  const yesterdayResults = evaluateSubEntityEvolution(
    summarizeSubEntities(yesterdayCurrent, ctx.performanceGoal),
    summarizeSubEntities(yesterdayPrevious, ctx.performanceGoal),
    EVOLUTION_CPA_IMPROVEMENT_PCT,
  );
  const alreadyCrossedKeys = new Set(yesterdayResults.map((r) => r.current.key));
  const newlyCrossed = todayResults.filter((r) => !alreadyCrossedKeys.has(r.current.key));
  if (newlyCrossed.length === 0) return null;

  const best = newlyCrossed.reduce((top, r) => (r.improvementPct > top.improvementPct ? r : top));
  const currentCpa = best.current.agg.cpa as number;
  const previousCpa = best.previous.agg.cpa as number;

  return {
    type: `${ctx.level}_evolution_cpa_improved`,
    scope: "client",
    family: "evolucao",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `sub_evolution:${ctx.level}:${best.current.key}:${ctx.yesterday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    level: ctx.level,
    entityName: best.current.name,
    metric: {
      metric: "cpa",
      actual: currentCpa,
      unit: "currency",
      comparisonActual: previousCpa,
      windowStart: addDays(ctx.yesterday, -6),
      windowEnd: ctx.yesterday,
      comparisonWindowStart: addDays(ctx.yesterday, -13),
      comparisonWindowEnd: addDays(ctx.yesterday, -7),
      sampleSpend: best.current.agg.spend,
      sampleResultCount: best.current.agg.resultCount,
      sampleRevenue: best.current.agg.revenue,
      comparisonSpend: best.previous.agg.spend,
      comparisonResultCount: best.previous.agg.resultCount,
      comparisonRevenue: best.previous.agg.revenue,
    },
    headline: `"${best.current.name}" melhorou ${formatPercent(best.improvementPct * 100)} em relação ao período anterior`,
    detail: `CPA ${formatCurrency(currentCpa)} vs. ${formatCurrency(previousCpa)} no período anterior`,
  };
}

export const SUB_ENTITY_RULES: ((ctx: SubEntityAchievementContext) => AchievementCandidate | null)[] = [ruleSubEntityDestaque, ruleSubEntityEvolution];
