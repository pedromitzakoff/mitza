/**
 * Etapa "Equipe — Fase 3: Evolução Profissional e Performance da Carteira
 * Sob Responsabilidade" — `src/lib/team-portfolio-performance.ts` +
 * integração em `team-performance-data.ts` + UI em `/team/[id]`.
 *
 * Mesmo padrão de sempre neste ambiente (sem Supabase real, ver
 * `test-team-performance-data.ts`/`test-client-manager-assignments.ts`): as
 * funções PURAS (`evaluatePortfolioClient`/`summarizePortfolioPerformance`/
 * `periodCoversFullMonth`/`resolveFullMonthCoverageClientIds`/
 * `resolveEvolutionMonthParams`) são testadas dinamicamente com fixtures
 * reais do Motor de Saúde (`evaluateAccountHealth`); a parte que toca
 * Supabase (`loadManagerPortfolioEvolution`) e a ausência de score/gamificação
 * são verificadas estruturalmente no código-fonte (sem comentários).
 *
 * Cobertura (pedido do usuário, Fase 3):
 * 1. Cliente dentro da meta / 2. fora da meta / 3. ausência de meta /
 * 4. amostra insuficiente / 5. escopo não comparável / 6. Followers excluído
 * do denominador / 7. responsabilidade pelo mês inteiro / 8. parcial no
 * início / 9. parcial no fim / 10. troca de gestor no meio do mês / 11. mês
 * anterior ao início de client_manager_assignments / 12. mês sem cliente
 * elegível / 13. meta histórica mensal correta / 14. ausência de uso
 * retroativo do target_cost_per_result legado / 15. distância relativa
 * positiva e negativa / 16. ausência de score/ranking/XP/bônus.
 *
 * Rodar: npx tsx scripts/test-team-portfolio-performance.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAccountHealth, type AccountHealthInput, type AccountHealthEvaluation } from "../src/lib/account-health-engine";
import type { ClientOperationalState } from "../src/lib/client-operational-state";
import type { ClientManagerAssignmentPeriod } from "../src/lib/client-manager-assignments";
import {
  evaluatePortfolioClient,
  summarizePortfolioPerformance,
  periodCoversFullMonth,
  resolveFullMonthCoverageClientIds,
  resolveEvolutionMonthParams,
  describePortfolioUnavailableReason,
} from "../src/lib/team-portfolio-performance";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

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

/** Mesmo fixture mínimo já usado por `test-team-performance-data.ts`. */
function fixtureState(
  clientId: string,
  managerId: string | null,
  evaluation: AccountHealthEvaluation,
  performanceGoal: ClientOperationalState["performanceGoal"] = "sales",
): ClientOperationalState {
  return {
    clientId,
    clientName: clientId,
    managerId,
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

function period(clientId: string, managerId: string, startedAt: string, endedAt: string | null, id = `${clientId}-${startedAt}`): ClientManagerAssignmentPeriod {
  return { id, clientId, managerId, startedAt, endedAt };
}

const SEPTEMBER = { firstDay: "2026-09-01", lastDay: "2026-09-30" };

const portfolioPerformanceSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-portfolio-performance.ts"), "utf8"));
const teamPerformanceDataSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-performance-data.ts"), "utf8"));
const teamProfilePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));
const teamListPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "page.tsx"), "utf8"));

console.log("\n1 — Cliente dentro da meta\n");
{
  const evaluation = evaluateAccountHealth(baseHealthInput({ costActual: 24, costPlanned: 30, resultActual: 10 }));
  const result = evaluatePortfolioClient(fixtureState("cliente-a", "gestor-1", evaluation, "sales"));
  ok("evaluable é true", result.evaluable === true);
  ok("withinTarget é true (24 < 30)", result.withinTarget === true);
  ok("unavailableReason é null", result.unavailableReason === null);
  ok("costActual/costTarget refletem exatamente o Motor de Saúde", result.costActual === 24 && result.costTarget === 30);
}

console.log("\n2 — Cliente fora da meta\n");
{
  const evaluation = evaluateAccountHealth(baseHealthInput({ costActual: 40, costPlanned: 30, resultActual: 10 }));
  const result = evaluatePortfolioClient(fixtureState("cliente-b", "gestor-1", evaluation, "leads"));
  ok("evaluable é true", result.evaluable === true);
  ok("withinTarget é false (40 > 30)", result.withinTarget === false);
  ok("ainda assim entra no denominador de avaliáveis (nunca vira 'sem avaliação')", result.unavailableReason === null);

  const summary = summarizePortfolioPerformance([result]);
  ok("conta pro denominador (evaluableCount = 1)", summary.evaluableCount === 1);
  ok("conta como fora da meta (outsideTargetCount = 1, withinTargetCount = 0)", summary.outsideTargetCount === 1 && summary.withinTargetCount === 0);
}

console.log("\n3 — Ausência de meta (cost.planned === null)\n");
{
  const evaluation = evaluateAccountHealth(baseHealthInput({ costActual: null, costPlanned: null }));
  const result = evaluatePortfolioClient(fixtureState("cliente-c", "gestor-1", evaluation, "leads"));
  ok("evaluable é false", result.evaluable === false);
  ok("withinTarget é null (nunca false)", result.withinTarget === null);
  ok('motivo é "sem_meta"', result.unavailableReason === "sem_meta");
  ok("texto do motivo é semanticamente correto", describePortfolioUnavailableReason("sem_meta") === "Meta de custo não definida");
}

console.log("\n4 — Amostra insuficiente\n");
{
  const evaluation = evaluateAccountHealth(baseHealthInput({ resultActual: 1, costActual: 40, costPlanned: 30 }));
  const result = evaluatePortfolioClient(fixtureState("cliente-d", "gestor-1", evaluation, "sales"));
  ok("evaluable é false", result.evaluable === false);
  ok('motivo é "amostra_insuficiente" (nunca confundido com "sem_meta")', result.unavailableReason === "amostra_insuficiente");
  ok("relativeDeviation é null mesmo com actual/target presentes", result.relativeDeviation === null);
}

console.log("\n5 — Escopo não comparável\n");
{
  const evaluation = evaluateAccountHealth(baseHealthInput({ costActual: 40, costPlanned: 30, resultActual: 10, costScopeComparable: false }));
  const result = evaluatePortfolioClient(fixtureState("cliente-e", "gestor-1", evaluation, "leads"));
  ok("evaluable é false", result.evaluable === false);
  ok('motivo é "escopo_nao_comparavel"', result.unavailableReason === "escopo_nao_comparavel");
  ok("nunca conta como fora da meta só por divergência de escopo", result.withinTarget === null);
}

console.log("\n6 — Followers excluído do denominador (mesmo com dado tecnicamente completo)\n");
{
  // Amostra suficiente, escopo comparável, meta definida — um cliente de
  // leads/vendas nesta mesma condição SERIA avaliável (ver testes 1/2).
  // Followers precisa ficar de fora mesmo assim (decisão de produto, Fase 3).
  const evaluation = evaluateAccountHealth(baseHealthInput({ costActual: 5, costPlanned: 8, resultActual: 20 }));
  const result = evaluatePortfolioClient(fixtureState("cliente-f", "gestor-1", evaluation, "followers"));
  ok("evaluable é false", result.evaluable === false);
  ok('motivo é "objetivo_nao_suportado" (nunca "sem_meta"/"amostra_insuficiente")', result.unavailableReason === "objetivo_nao_suportado");
  ok("relativeDeviation é null (nunca herda o desvio calculado internamente pelo motor)", result.relativeDeviation === null);

  const summary = summarizePortfolioPerformance([result]);
  ok("nunca entra no denominador de avaliáveis", summary.evaluableCount === 0);
  ok("nunca conta como dentro OU fora da meta", summary.withinTargetCount === 0 && summary.outsideTargetCount === 0);
  ok("conta só como sem avaliação confiável", summary.unavailableCount === 1);

  ok(
    "código-fonte: lista de objetivos avaliáveis é só leads/sales, followers explicitamente fora",
    /const EVALUABLE_PERFORMANCE_GOALS: readonly PerformanceGoal\[\] = \["leads", "sales"\];/.test(portfolioPerformanceSource),
  );
}

console.log("\n7 — Responsabilidade pelo mês inteiro (started antes, sem fim)\n");
{
  const p = period("cliente-x", "gestor-1", "2026-08-15T00:00:00.000Z", null);
  ok("cobre setembro inteiro", periodCoversFullMonth(p, SEPTEMBER) === true);
  ok("entra na lista de cobertura integral", resolveFullMonthCoverageClientIds([p], SEPTEMBER).includes("cliente-x"));
}

console.log("\n8 — Responsabilidade parcial no INÍCIO do mês (começou depois do dia 1)\n");
{
  const p = period("cliente-y", "gestor-1", "2026-09-10T00:00:00.000Z", null);
  ok("NÃO cobre o mês inteiro", periodCoversFullMonth(p, SEPTEMBER) === false);
  ok("não entra na lista de cobertura integral", !resolveFullMonthCoverageClientIds([p], SEPTEMBER).includes("cliente-y"));
}

console.log("\n9 — Responsabilidade parcial no FIM do mês (terminou antes do último dia)\n");
{
  const p = period("cliente-z", "gestor-1", "2026-08-01T00:00:00.000Z", "2026-09-20T00:00:00.000Z");
  ok("NÃO cobre o mês inteiro", periodCoversFullMonth(p, SEPTEMBER) === false);
}

console.log("\n10 — Troca de gestor no meio do mês: NENHUM dos dois cobre o mês inteiro\n");
{
  const periodA = period("cliente-w", "gestor-1", "2026-08-01T00:00:00.000Z", "2026-09-15T00:00:00.000Z");
  const periodB = period("cliente-w", "gestor-2", "2026-09-15T00:00:00.000Z", null);

  ok("período do gestor-1 não cobre o mês inteiro (terminou no meio)", periodCoversFullMonth(periodA, SEPTEMBER) === false);
  ok("período do gestor-2 não cobre o mês inteiro (começou no meio)", periodCoversFullMonth(periodB, SEPTEMBER) === false);
  ok("gestor-1 não tem cliente-w na cobertura integral de setembro", resolveFullMonthCoverageClientIds([periodA], SEPTEMBER).length === 0);
  ok("gestor-2 não tem cliente-w na cobertura integral de setembro", resolveFullMonthCoverageClientIds([periodB], SEPTEMBER).length === 0);
}

console.log("\n11 — Mês anterior ao início de client_manager_assignments (deploy 17/09/2026)\n");
{
  const p = period("cliente-v", "gestor-1", "2026-09-17T14:00:00.000Z", null);
  const august = { firstDay: "2026-08-01", lastDay: "2026-08-31" };
  ok("agosto/2026 (antes do deploy) nunca é coberto — nenhum dado antes do deploy existe", periodCoversFullMonth(p, august) === false);
  ok("resolveFullMonthCoverageClientIds pra agosto é vazio", resolveFullMonthCoverageClientIds([p], august).length === 0);
}

console.log("\n12 — Mês sem nenhum cliente elegível: loadManagerPortfolioEvolution pula o mês (nunca 0/0)\n");
{
  ok(
    "código-fonte: loadManagerPortfolioMonthSummary devolve hasCoverage:false/summary:null quando nenhum cliente tem cobertura integral (nunca um resumo fabricado)",
    /if \(coverageClientIds\.length === 0\) return \{ monthParam, hasCoverage: false, summary: null \};/.test(portfolioPerformanceSource),
  );
  ok(
    "código-fonte: loadManagerPortfolioEvolution pula (continue) o mês sem cobertura, nunca vira um ponto na lista",
    /if \(!monthSummary\.hasCoverage \|\| !monthSummary\.summary\) continue;/.test(portfolioPerformanceSource),
  );
  ok(
    "código-fonte: UI só renderiza a seção Evolução quando há pelo menos 1 ponto (portfolioEvolution.length > 0)",
    /portfolioEvolution\.length > 0/.test(teamProfilePageSource),
  );
}

console.log("\n13 — Meta histórica mensal correta (reaproveita resolveClientMonthlyPlan por mês, nunca recalculada aqui)\n");
{
  ok(
    "team-portfolio-performance.ts nunca lê monthly_budget_changes diretamente (a vigência por mês é resolvida só por loadClientOperationalStates)",
    !/monthly_budget_changes/.test(portfolioPerformanceSource),
  );
  ok(
    "team-portfolio-performance.ts nunca calcula custo/meta sozinho — cost.planned/cost.actual vêm sempre de state.evaluation.dimensions.cost",
    /const cost = state\.evaluation\.dimensions\.cost;/.test(portfolioPerformanceSource),
  );
  ok(
    "loadManagerPortfolioEvolution chama loadClientOperationalStates(supabase, monthParam) — o mesmo mês do ponto, nunca o mês corrente fixo",
    /loadClientOperationalStates\(supabase, monthParam\)/.test(portfolioPerformanceSource),
  );
}

console.log("\n14 — Ausência de uso retroativo do target_cost_per_result legado\n");
{
  ok(
    "team-portfolio-performance.ts nunca referencia target_cost_per_result (nunca um fallback próprio, sempre o já resolvido pelo motor)",
    !/target_cost_per_result/.test(portfolioPerformanceSource),
  );
  ok(
    "team-portfolio-performance.ts nunca chama resolveTargetCostPerResult diretamente (não reimplementa a precedência de meta)",
    !/resolveTargetCostPerResult/.test(portfolioPerformanceSource),
  );
}

console.log("\n15 — Distância relativa positiva e negativa (nunca uma média entre clientes)\n");
{
  const better = evaluateAccountHealth(baseHealthInput({ costActual: 24, costPlanned: 30, resultActual: 10 }));
  const worse = evaluateAccountHealth(baseHealthInput({ costActual: 120, costPlanned: 100, resultActual: 10 }));

  const betterResult = evaluatePortfolioClient(fixtureState("cliente-melhor", "gestor-1", better, "sales"));
  const worseResult = evaluatePortfolioClient(fixtureState("cliente-pior", "gestor-1", worse, "sales"));

  ok("cliente melhor que a meta: relativeDeviation negativo (20% abaixo)", betterResult.relativeDeviation !== null && betterResult.relativeDeviation < 0);
  ok("cliente pior que a meta: relativeDeviation positivo (20% acima)", worseResult.relativeDeviation !== null && worseResult.relativeDeviation > 0);
  ok(
    "magnitude é exatamente 20% nos dois casos (nenhuma fórmula nova — (actual-target)/target)",
    Math.abs(betterResult.relativeDeviation! - -0.2) < 1e-9 && Math.abs(worseResult.relativeDeviation! - 0.2) < 1e-9,
  );
  ok(
    "código-fonte da UI nunca faz média entre clientes pra compor um número de gestor (só formata o desvio de CADA cliente)",
    !/reduce\(.*relativeDeviation/.test(teamProfilePageSource) && !/average.*[Dd]eviation/.test(teamProfilePageSource),
  );
}

console.log("\n16 — Ausência de score/ranking/XP/bônus\n");
{
  const combinedSource = `${portfolioPerformanceSource}\n${teamPerformanceDataSource}\n${teamProfilePageSource}\n${teamListPageSource}`;
  ok("nenhuma palavra de score/ranking/nível/XP nos arquivos da Fase 3", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|leaderboard|Performance Score/i.test(combinedSource));
  ok("nenhuma palavra de bônus/comissão/prêmio/remuneração/salário/folha", !/b[oô]nus|comiss[aã]o|pr[eê]mio|remunera[çc][aã]o|sal[aá]rio|folha/i.test(combinedSource));
  // "Insígnia" deixou de ser proibida na Etapa "Equipe — Fase 4" (aprovada
  // como taxonomia oficial) — o que continua proibido é bronze/prata/ouro/
  // medalha (estética de jogo/premiação), nunca o nome do conceito.
  ok("nenhum badge/medalha automática nova (Bronze/Prata/Ouro)", !/bronze|prata|ouro|medalha/i.test(combinedSource));
  ok('/team (lista) não foi alterado por esta etapa (nenhuma referência a "portfolioPerformance"/"Evolução")', !/portfolioPerformance/.test(teamListPageSource) && !/Evolução/.test(teamListPageSource));
  ok("nenhuma ordenação de team_members por performance (a query de membros continua .order(\"name\"))", /from\("team_members"\)[\s\S]{0,250}\.order\("name"\)/.test(teamPerformanceDataSource));
}

console.log("\n17 — resolveEvolutionMonthParams: lista de meses do mais antigo ao mais recente\n");
{
  const params = resolveEvolutionMonthParams("2026-09-01", 2);
  ok("3 meses (2 pra trás + o mês de referência)", params.length === 3);
  ok("ordem: mais antigo primeiro, mês de referência por último", params[0] === "2026-07-01" && params[1] === "2026-08-01" && params[2] === "2026-09-01");
}

console.log(`\nTodos os ${passed} testes passaram.`);
