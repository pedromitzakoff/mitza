/**
 * Etapa "Equipe — Fase 4: Conquistas e Insígnias Profissionais" (V1
 * reduzida, aprovada) — `achievement-person-performance-rules.ts` (3
 * detectores) + extensão de `team-portfolio-performance.ts` (sequência de
 * meses) + `achievement-badges.ts` (seleção de Insígnias).
 *
 * Mesmo padrão de sempre neste ambiente (sem Supabase real): as funções
 * PURAS são testadas dinamicamente; a parte que toca Supabase
 * (`fetchPersonPerformanceMetrics`, `resolveManagerConsecutiveMonthsFullyWithinTarget`)
 * é verificada estruturalmente no código-fonte (sem comentários).
 *
 * Rodar: npx tsx scripts/test-achievement-person-performance.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAccountHealth, type AccountHealthInput, type AccountHealthEvaluation } from "../src/lib/account-health-engine";
import type { ClientOperationalState } from "../src/lib/client-operational-state";
import {
  evaluatePortfolioClient,
  summarizePortfolioPerformance,
  monthQualifiesFullyWithinTarget,
  countConsecutiveQualifyingMonths,
  type ManagerPortfolioMonthSummary,
  type PortfolioClientEvaluation,
  type PortfolioPerformanceSummary,
} from "../src/lib/team-portfolio-performance";
import {
  rulePersonFirstClientWithinTarget,
  rulePersonPortfolioFullyWithinTarget,
  rulePersonConsecutiveMonthsFullyWithinTarget,
  type PersonPerformanceAchievementContext,
} from "../src/lib/achievement-person-performance-rules";
import { buildIdempotencyKey } from "../src/lib/achievement-engine";
import { selectPersonBadges } from "../src/lib/achievement-badges";
import { highestMilestoneCrossed } from "../src/lib/achievement-person-rules";
import { PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS } from "../src/lib/achievement-thresholds";
import type { AchievementRow } from "../src/lib/achievements-data";
import type { AchievementCandidate } from "../src/lib/achievement-types";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseHealthInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    investmentActual: 500,
    investmentPlanned: 1000,
    investmentHasSyncedData: true,
    resultActual: 10,
    resultPlanned: 10,
    hasPerformanceData: true,
    performanceGoalConfigured: true,
    costActual: 50,
    costPlanned: 50,
    monthExpectedPct: 50,
    reviewBusinessDaysAgo: 5,
    reviewMaxBusinessDays: 10,
    ...overrides,
  };
}

function fixtureState(
  clientId: string,
  evaluation: AccountHealthEvaluation,
  performanceGoal: ClientOperationalState["performanceGoal"] = "sales",
): ClientOperationalState {
  return {
    clientId,
    clientName: clientId,
    managerId: "gestor-1",
    managerName: null,
    avatarUrl: null,
    performanceGoal,
    evaluation,
    overdueTasksCount: 0,
    openTasksCount: 0,
    lastDataSyncAt: null,
    performanceLatestSource: null,
    performanceLastUpdatedAt: null,
    diagnostics: {
      planejamento: { items: [], isIncomplete: false },
      cpa: null,
      investment: { value: 0, expected: null, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
      pendencias: { count: 0, items: [], hasPendencias: false },
      atividade: { lastActivityAt: null, hoursSinceLastActivity: null, isOverdue: false },
    },
  };
}

function fixtureClient(overrides: Partial<PortfolioClientEvaluation> = {}): PortfolioClientEvaluation {
  return {
    clientId: "cliente-x",
    clientName: "Cliente X",
    performanceGoal: "sales",
    costActual: 24,
    costTarget: 30,
    costMetricShortLabel: "CPA",
    relativeDeviation: -0.2,
    evaluable: true,
    withinTarget: true,
    unavailableReason: null,
    ...overrides,
  };
}

function fixtureSummary(clients: PortfolioClientEvaluation[]): PortfolioPerformanceSummary {
  return summarizePortfolioPerformance(clients);
}

function fixtureContext(overrides: Partial<PersonPerformanceAchievementContext> = {}): PersonPerformanceAchievementContext {
  return {
    teamMemberId: "gestor-1",
    teamMemberName: "Vini",
    evaluatedOnDate: "2026-10-31",
    monthParam: "2026-10-01",
    monthLabel: "Outubro de 2026",
    portfolioSummary: null,
    consecutiveMonthsStreak: 0,
    ...overrides,
  };
}

function fixtureAchievementRow(overrides: Partial<AchievementRow> = {}): AchievementRow {
  return {
    id: `id-${Math.random()}`,
    occurredAt: "2026-10-31T12:00:00-03:00",
    detectedAt: "2026-10-31T12:00:00-03:00",
    scope: "person",
    family: "otimizacoes",
    severity: "milestone",
    type: "person_optimizations_milestone",
    clientId: null,
    clientName: null,
    clientPerformanceGoal: null,
    actorTeamMemberId: "gestor-1",
    actorTeamMemberName: "Vini",
    level: "account",
    entityName: null,
    headline: "headline",
    detail: "detail",
    metric: { metric: "count", actual: 1, unit: "count", target: 1 },
    source: null,
    ...overrides,
  };
}

const teamPortfolioPerformanceSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-portfolio-performance.ts"), "utf8"));
const achievementMetricsSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "achievement-metrics.ts"), "utf8"));
const achievementEngineSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "achievement-engine.ts"), "utf8"));
const personPerformanceRulesSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "achievement-person-performance-rules.ts"), "utf8"));
const achievementBadgesSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "achievement-badges.ts"), "utf8"));
const teamProfilePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));
const achievementsSqlSource = readFileSync(join(__dirname, "..", "supabase", "achievements.sql"), "utf8");

console.log("\n1 — Insígnia: maior patamar selecionado corretamente\n");
{
  const rows = [
    fixtureAchievementRow({ id: "a1", type: "person_optimizations_milestone", metric: { metric: "count", actual: 1, unit: "count", target: 1 } }),
    fixtureAchievementRow({ id: "a2", type: "person_optimizations_milestone", metric: { metric: "count", actual: 50, unit: "count", target: 50 } }),
    fixtureAchievementRow({ id: "a3", type: "person_optimizations_milestone", metric: { metric: "count", actual: 100, unit: "count", target: 100 } }),
  ];
  const badges = selectPersonBadges(rows);
  const optimizationsBadge = badges.find((b) => b.type === "person_optimizations_milestone");
  ok("badge de otimizações presente", optimizationsBadge !== undefined);
  ok("badge selecionado é o de maior patamar (id a3, target 100)", optimizationsBadge?.id === "a3");
}

console.log("\n2 — Patamares inferiores não aparecem simultaneamente\n");
{
  const rows = [
    fixtureAchievementRow({ id: "a1", type: "person_optimizations_milestone", metric: { metric: "count", actual: 1, unit: "count", target: 1 } }),
    fixtureAchievementRow({ id: "a2", type: "person_optimizations_milestone", metric: { metric: "count", actual: 50, unit: "count", target: 50 } }),
    fixtureAchievementRow({ id: "a3", type: "person_optimizations_milestone", metric: { metric: "count", actual: 100, unit: "count", target: 100 } }),
  ];
  const badges = selectPersonBadges(rows);
  const optimizationsBadges = badges.filter((b) => b.type === "person_optimizations_milestone");
  ok("exatamente 1 badge de otimizações (nunca 3 juntos)", optimizationsBadges.length === 1);
}

console.log("\n3 — Famílias diferentes permanecem independentes\n");
{
  const rows = [
    fixtureAchievementRow({ id: "opt-1", type: "person_optimizations_milestone", family: "otimizacoes", metric: { metric: "count", actual: 1, unit: "count", target: 1 } }),
    fixtureAchievementRow({ id: "opt-50", type: "person_optimizations_milestone", family: "otimizacoes", metric: { metric: "count", actual: 50, unit: "count", target: 50 } }),
    fixtureAchievementRow({ id: "opt-100", type: "person_optimizations_milestone", family: "otimizacoes", metric: { metric: "count", actual: 100, unit: "count", target: 100 } }),
    fixtureAchievementRow({ id: "rev-1", type: "person_reviews_milestone", family: "revisoes", metric: { metric: "count", actual: 1, unit: "count", target: 1 } }),
    fixtureAchievementRow({ id: "rev-50", type: "person_reviews_milestone", family: "revisoes", metric: { metric: "count", actual: 50, unit: "count", target: 50 } }),
  ];
  const badges = selectPersonBadges(rows);
  const optimizationsBadge = badges.find((b) => b.type === "person_optimizations_milestone");
  const reviewsBadge = badges.find((b) => b.type === "person_reviews_milestone");
  ok("otimizações escolhe seu próprio máximo (100), independente de revisões", optimizationsBadge?.id === "opt-100");
  ok("revisões escolhe seu próprio máximo (50), independente de otimizações", reviewsBadge?.id === "rev-50");
  ok("exatamente 2 badges no total (1 por família/type)", badges.length === 2);
}

console.log('\n3b — "experiencia" e conquistas únicas/recorrentes de performance nunca viram insígnia\n');
{
  const rows = [
    fixtureAchievementRow({ id: "exp-1", type: "person_first_meeting_completed", family: "experiencia" }),
    fixtureAchievementRow({ id: "perf-first", type: "person_first_client_within_target", family: "performance" }),
    fixtureAchievementRow({ id: "perf-month", type: "person_portfolio_fully_within_target", family: "performance", metric: { metric: "count", actual: 3, unit: "count", target: 3 } }),
  ];
  const badges = selectPersonBadges(rows);
  ok('"experiencia" nunca vira insígnia (fica só cronológica)', !badges.some((b) => b.type === "person_first_meeting_completed"));
  ok('"conquista única" (primeira conta) nunca vira insígnia', !badges.some((b) => b.type === "person_first_client_within_target"));
  ok('"conquista recorrente por mês" (100% da carteira) nunca vira insígnia', !badges.some((b) => b.type === "person_portfolio_fully_within_target"));
}

console.log("\n4 — Primeira conta dentro da meta\n");
{
  const summary = fixtureSummary([fixtureClient({ clientId: "cliente-a", clientName: "Cliente A", withinTarget: true, costActual: 24, costTarget: 30 })]);
  const ctx = fixtureContext({ portfolioSummary: summary });
  const candidate = rulePersonFirstClientWithinTarget(ctx);
  ok("candidato gerado", candidate !== null);
  ok('type correto', candidate?.type === "person_first_client_within_target");
  ok('windowKey fixo (nunca inclui mês/cliente)', candidate?.windowKey === "first_client_within_target");
  ok("clientId/clientName referenciam o cliente exemplo", candidate?.clientId === "cliente-a" && candidate?.clientName === "Cliente A");
}

console.log("\n5 — Primeira conta é idempotente entre meses diferentes\n");
{
  const summaryOutubro = fixtureSummary([fixtureClient({ clientId: "cliente-a" })]);
  const summaryNovembro = fixtureSummary([fixtureClient({ clientId: "cliente-b" })]);
  const candidateOutubro = rulePersonFirstClientWithinTarget(fixtureContext({ monthParam: "2026-10-01", portfolioSummary: summaryOutubro }))!;
  const candidateNovembro = rulePersonFirstClientWithinTarget(fixtureContext({ monthParam: "2026-11-01", evaluatedOnDate: "2026-11-30", portfolioSummary: summaryNovembro }))!;
  const keyOutubro = buildIdempotencyKey(candidateOutubro, "org-1");
  const keyNovembro = buildIdempotencyKey(candidateNovembro, "org-1");
  ok("idempotency_key idêntica em meses diferentes (nunca dispara 2x)", keyOutubro === keyNovembro);
}

console.log("\n6 — 100% da carteira com pelo menos 1 avaliável\n");
{
  const summary = fixtureSummary([fixtureClient({ withinTarget: true })]);
  const candidate = rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summary }));
  ok("candidato gerado", candidate !== null);
  ok('type correto', candidate?.type === "person_portfolio_fully_within_target");
  ok("windowKey inclui o mês (conquista recorrente, não insígnia única)", candidate?.windowKey === "portfolio_fully_within_target:2026-10-01");
}

console.log("\n7 — 100% com conta não avaliável: fica fora do denominador\n");
{
  const summary = fixtureSummary([
    fixtureClient({ clientId: "avaliavel", withinTarget: true }),
    fixtureClient({ clientId: "sem-avaliacao", evaluable: false, withinTarget: null, unavailableReason: "amostra_insuficiente", costActual: null, costTarget: null, relativeDeviation: null }),
  ]);
  ok("evaluableCount conta só a conta avaliável (1, não 2)", summary.evaluableCount === 1);
  const candidate = rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summary }));
  ok("candidato ainda é gerado (a conta sem avaliação não impede)", candidate !== null);
}

console.log("\n8 — Uma conta avaliável fora da meta impede a conquista\n");
{
  const summary = fixtureSummary([
    fixtureClient({ clientId: "dentro", withinTarget: true }),
    fixtureClient({ clientId: "fora", withinTarget: false, costActual: 40, costTarget: 30, relativeDeviation: 0.33 }),
  ]);
  const candidate = rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summary }));
  ok("candidato NÃO é gerado (outsideTargetCount > 0)", candidate === null);
}

console.log("\n9 — Zero contas avaliáveis não gera conquista\n");
{
  const summary = fixtureSummary([]);
  ok("evaluableCount é 0", summary.evaluableCount === 0);
  ok("person_first_client_within_target não dispara", rulePersonFirstClientWithinTarget(fixtureContext({ portfolioSummary: summary })) === null);
  ok("person_portfolio_fully_within_target não dispara", rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summary })) === null);
}

console.log("\n10 — 3 meses consecutivos\n");
{
  const candidate = rulePersonConsecutiveMonthsFullyWithinTarget(fixtureContext({ consecutiveMonthsStreak: 3 }));
  ok("candidato gerado", candidate !== null);
  ok("patamar 3 (não 6)", candidate?.metric.target === 3);
  ok("severity milestone (abaixo de 6)", candidate?.severity === "milestone");
}

console.log("\n11 — Quebra da sequência\n");
{
  ok(
    "sequência com 1 falha no meio conta só até a falha (2, não 4)",
    countConsecutiveQualifyingMonths([true, true, false, true]) === 2,
  );
  ok("sequência sem nenhuma falha conta tudo", countConsecutiveQualifyingMonths([true, true, true]) === 3);
  ok("primeira falha já zera", countConsecutiveQualifyingMonths([false, true, true]) === 0);

  const noCoverage: ManagerPortfolioMonthSummary = { monthParam: "2026-08-01", hasCoverage: false, summary: null };
  ok("mês sem cobertura nunca qualifica (quebra a sequência, nunca é pulado)", monthQualifiesFullyWithinTarget(noCoverage) === false);
}

console.log("\n12 — 6 meses consecutivos\n");
{
  const candidate = rulePersonConsecutiveMonthsFullyWithinTarget(fixtureContext({ consecutiveMonthsStreak: 6 }));
  ok("candidato gerado", candidate !== null);
  ok("patamar 6 (o maior, nunca 3 junto)", candidate?.metric.target === 6);
  ok("severity record (patamar mais alto)", candidate?.severity === "record");
  ok(
    "thresholds em ordem decrescente (highestMilestoneCrossed pega o maior primeiro)",
    highestMilestoneCrossed(6, PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS) === 6 &&
      highestMilestoneCrossed(4, PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS) === 3,
  );
}

console.log("\n13 — Responsabilidade parcial impede uso daquele cliente/mês conforme Fase 3\n");
{
  ok(
    "loadManagerPortfolioMonthSummary usa resolveFullMonthCoverageClientIds (mesma regra da Fase 3, nunca uma segunda)",
    /resolveFullMonthCoverageClientIds\(periods, monthRange\)/.test(teamPortfolioPerformanceSource),
  );
  ok(
    "sem cliente com cobertura integral, hasCoverage é false e summary é null (nunca um resumo com 0 clientes fabricado)",
    /return \{ monthParam, hasCoverage: false, summary: null \};/.test(teamPortfolioPerformanceSource),
  );
  const partialCoverage: ManagerPortfolioMonthSummary = { monthParam: "2026-09-01", hasCoverage: false, summary: null };
  ok("mês com responsabilidade parcial (sem cobertura integral) nunca qualifica", monthQualifiesFullyWithinTarget(partialCoverage) === false);
}

console.log("\n14 — Período anterior à Fase 2 não gera performance profissional\n");
{
  const ctx = fixtureContext({ portfolioSummary: null, consecutiveMonthsStreak: 0 });
  ok("person_first_client_within_target não dispara sem portfolioSummary", rulePersonFirstClientWithinTarget(ctx) === null);
  ok("person_portfolio_fully_within_target não dispara sem portfolioSummary", rulePersonPortfolioFullyWithinTarget(ctx) === null);
  ok("person_consecutive_months_fully_within_target não dispara com streak 0", rulePersonConsecutiveMonthsFullyWithinTarget(ctx) === null);
  ok(
    "fetchPersonPerformanceMetrics: gestor sem NENHUM período em client_manager_assignments recebe contexto vazio, sem checar data nenhuma",
    /const periods = await fetchAssignmentPeriodsForManager\(supabase, member\.id\);\s*\n\s*if \(periods\.length === 0\) return empty;/.test(achievementMetricsSource),
  );
}

console.log("\n15 — Followers não gera performance profissional\n");
{
  const followersEvaluation = evaluateAccountHealth(baseHealthInput({ costActual: 5, costPlanned: 8, resultActual: 20 }));
  const followersState = fixtureState("cliente-followers", followersEvaluation, "followers");
  const followersEval = evaluatePortfolioClient(followersState);
  ok("cliente de seguidores nunca é evaluable (mesmo com amostra/escopo/meta tecnicamente válidos)", followersEval.evaluable === false);

  const summary = fixtureSummary([followersEval]);
  ok("evaluableCount é 0 (seguidores nunca entra no denominador)", summary.evaluableCount === 0);
  ok("person_first_client_within_target não dispara pra carteira só de seguidores", rulePersonFirstClientWithinTarget(fixtureContext({ portfolioSummary: summary })) === null);
  ok("person_portfolio_fully_within_target não dispara pra carteira só de seguidores", rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summary })) === null);
}

console.log("\n16 — Reexecução não duplica evento\n");
{
  const summary = fixtureSummary([fixtureClient({ withinTarget: true })]);
  const ctx = fixtureContext({ portfolioSummary: summary });
  const candidate1 = rulePersonPortfolioFullyWithinTarget(ctx)!;
  const candidate2 = rulePersonPortfolioFullyWithinTarget(ctx)!;
  ok("mesmo contexto reavaliado produz a MESMA idempotency_key", buildIdempotencyKey(candidate1, "org-1") === buildIdempotencyKey(candidate2, "org-1"));
  ok(
    "record_achievement_event grava com ON CONFLICT ... DO NOTHING (mesma RPC de todo o motor, nenhuma escrita nova)",
    /on conflict \(idempotency_key\) where idempotency_key is not null do nothing/.test(achievementsSqlSource),
  );
  ok(
    "achievement-engine.ts persiste os 3 detectores pela MESMA persistCandidate/RPC já usada por todo o motor",
    /for \(const rule of personPerformanceRules\)/.test(achievementEngineSource) && /await persistCandidate\(supabase, organizationId, candidate\)/.test(achievementEngineSource),
  );
}

console.log("\n17 — Snapshot contém evidência suficiente\n");
{
  const summaryFirst = fixtureSummary([fixtureClient({ clientId: "cliente-evidencia", clientName: "Cliente Evidência", costActual: 24, costTarget: 30 })]);
  const firstCandidate = rulePersonFirstClientWithinTarget(fixtureContext({ portfolioSummary: summaryFirst }))!;
  ok("first_client: metric.actual/target refletem o custo real/meta do cliente exemplo", firstCandidate.metric.actual === 24 && firstCandidate.metric.target === 30);
  ok("first_client: windowLabel (período) presente", firstCandidate.metric.windowLabel === "Outubro de 2026");
  ok("first_client: clientId/clientName presentes (evidência de QUAL cliente)", firstCandidate.clientId === "cliente-evidencia" && firstCandidate.clientName === "Cliente Evidência");

  const summaryPortfolio = fixtureSummary([fixtureClient({ withinTarget: true }), fixtureClient({ clientId: "cliente-2", withinTarget: true })]);
  const portfolioCandidate = rulePersonPortfolioFullyWithinTarget(fixtureContext({ portfolioSummary: summaryPortfolio }))!;
  ok("portfolio: quantidade dentro da meta e quantidade avaliável presentes", portfolioCandidate.metric.actual === 2 && portfolioCandidate.metric.target === 2);
  ok("portfolio: período (windowLabel) presente", portfolioCandidate.metric.windowLabel === "Outubro de 2026");

  const streakCandidate = rulePersonConsecutiveMonthsFullyWithinTarget(fixtureContext({ consecutiveMonthsStreak: 3 }))!;
  ok("consecutive: sequência atual (actual) e patamar (target) presentes", streakCandidate.metric.actual === 3 && streakCandidate.metric.target === 3);
  ok("consecutive: período (mês de fechamento) presente", streakCandidate.metric.windowLabel === "Outubro de 2026");

  function hasEnoughEvidence(candidate: AchievementCandidate): boolean {
    return candidate.metric.actual !== undefined && candidate.metric.target !== undefined && candidate.metric.target !== null;
  }
  ok("todos os 3 candidatos têm actual E target preenchidos (nunca uma evidência pela metade)", [firstCandidate, portfolioCandidate, streakCandidate].every(hasEnoughEvidence));
}

console.log("\n18 — Ausência de score/ranking/XP/bônus\n");
{
  const combinedSource = `${personPerformanceRulesSource}\n${achievementBadgesSource}\n${teamProfilePageSource}`;
  ok("nenhuma palavra de score/ranking/nível/XP/leaderboard", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|leaderboard|Performance Score/i.test(combinedSource));
  ok("nenhuma palavra de bônus/comissão/prêmio/remuneração/salário/folha", !/b[oô]nus|comiss[aã]o|pr[eê]mio|remunera[çc][aã]o|sal[aá]rio|folha/i.test(combinedSource));
  ok("nenhum badge/medalha/estrela/pódio (estética proibida pelo pedido)", !/medalha|estrela|p[oó]dio|troféu|trophy/i.test(combinedSource));
  ok("nenhuma tabela/migration nova criada (schema intocado)", !/create table|alter table/i.test(personPerformanceRulesSource));
  ok(
    "achievement-person-performance-rules.ts nunca compara um gestor com outro (só o próprio contexto)",
    !/\.sort\(|\bother[A-Z]\w*Manager\b/.test(personPerformanceRulesSource),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
