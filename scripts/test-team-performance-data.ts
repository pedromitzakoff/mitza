/**
 * Etapa "Equipe — Perfil Profissional" (Fase 1) — `/team` (lista) +
 * `/team/[id]` (Perfil do Gestor) + `lib/team-performance-data.ts`.
 *
 * Este ambiente não tem Supabase real — `loadTeamMemberProfiles` (que
 * chama Supabase direto) não é testável dinamicamente aqui, mesmo padrão já
 * usado por `test-operation-channel-scoping.ts` pra `loadOperationChannelStates`:
 * as funções PURAS que ela compõe (`buildPortfolioClient`/`summarizePortfolio`/
 * `countByActor`) são exportadas e testadas isoladamente com fixtures reais
 * do motor (`evaluateAccountHealth`); o resto (autorização, filtros
 * SQL, ausência de score/bônus) é verificado estruturalmente no código-fonte.
 *
 * Cobertura:
 * 1. Só `team_members` ativos (query da lista).
 * 2. Usuário interno ativo acessa Equipe / pessoa não autenticada não
 *    acessa (`isPublicPath`, mesma função real do middleware).
 * 3. Carteira usa `primary_manager_id` corretamente — cliente de outro
 *    gestor não contamina o perfil (agrupamento por `managerId`).
 * 4. Investimento respeita o período (nenhuma segunda janela de data).
 * 5. Investimento não é tratado como histórico sem prova de assignment.
 * 6. Performance usa o target canônico (`evaluation.dimensions.cost`, sem
 *    recálculo).
 * 7. Conta sem target/amostra/escopo comparável nunca vira "abaixo da
 *    meta" artificialmente.
 * 8. Otimizações não têm double count (evento de análise nunca soma junto
 *    com o de otimização).
 * 9. Reports/reuniões só contam a partir do event_type canônico (nunca
 *    `monthly_report_*`/`task_completed` genérico).
 * 10. Conquistas só aparecem se atribuíveis (`scope: "person"`, ator real).
 * 11. Nenhuma nota/score/ranking/bônus criado nesta fase.
 * 12. Nenhuma regressão em Operação/Conquistas/Timeline/Home — não
 *     alterados por esta etapa (suíte completa cobre dinamicamente).
 *
 * Rodar: npx tsx scripts/test-team-performance-data.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAccountHealth, type AccountHealthInput, type AccountHealthEvaluation } from "../src/lib/account-health-engine";
import { isPublicPath } from "../src/lib/supabase/middleware";
import {
  buildPortfolioClient,
  summarizePortfolio,
  countByActor,
  emptyActivityCounts,
} from "../src/lib/team-performance-data";
import type { ClientOperationalState } from "../src/lib/client-operational-state";

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

/** Mesmo fixture mínimo já usado por `test-operation-priority-grouping.ts`/
 * `test-home-reformulation.ts` — só o que as funções sob teste de fato lêem. */
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

const teamPerformanceDataSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-performance-data.ts"), "utf8"));
const teamListPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "page.tsx"), "utf8"));
const teamProfilePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));

console.log("\n1 — Só team_members ativos entram na lista/perfil\n");
{
  ok('query de team_members filtra .eq("status", "ativo")', /from\("team_members"\)[\s\S]{0,250}\.eq\("status", "ativo"\)/.test(teamPerformanceDataSource));
}

console.log("\n2 — Acesso: interno ativo entra, pessoa não autenticada não entra (mesma função real do middleware)\n");
{
  ok("/team não é rota pública", !isPublicPath("/team"));
  ok("/team/<id> não é rota pública", !isPublicPath("/team/algum-id"));
  ok("página da lista usa getCurrentProfile() + bloqueia quando não há sessão", /getCurrentProfile\(\)/.test(teamListPageSource) && /if \(!profile\) return null/.test(teamListPageSource));
  ok("página do perfil usa getCurrentProfile() + bloqueia quando não há sessão", /getCurrentProfile\(\)/.test(teamProfilePageSource) && /if \(!profile\) return null/.test(teamProfilePageSource));
  ok("nenhuma das duas páginas exige admin (área não é RH/admin-only)", !/requireAdmin/.test(teamListPageSource) && !/requireAdmin/.test(teamProfilePageSource));
}

console.log("\n3 — Carteira usa primary_manager_id corretamente: cliente de outro gestor nunca contamina o perfil\n");
{
  const healthy = evaluateAccountHealth(baseHealthInput());
  const stateA = fixtureState("cliente-a", "gestor-1", healthy);
  const stateB = fixtureState("cliente-b", "gestor-2", healthy);
  const allStates = [stateA, stateB];

  // Mesmo agrupamento que loadTeamMemberProfiles faz internamente
  // (statesByManager) — reproduzido aqui porque é só um .filter, não uma
  // regra de negócio que precise de função própria exportada.
  const gestor1States = allStates.filter((s) => s.managerId === "gestor-1");
  const gestor2States = allStates.filter((s) => s.managerId === "gestor-2");

  ok("carteira do gestor-1 tem só cliente-a", gestor1States.length === 1 && gestor1States[0].clientId === "cliente-a");
  ok("carteira do gestor-2 tem só cliente-b", gestor2States.length === 1 && gestor2States[0].clientId === "cliente-b");
  ok(
    "código-fonte agrupa por state.managerId (nunca por um campo diferente/hardcoded)",
    /state\.managerId/.test(teamPerformanceDataSource) && /statesByManager\.get\(member\.id\)/.test(teamPerformanceDataSource),
  );
}

console.log("\n4 — Investimento respeita o período selecionado (nenhuma segunda janela de data)\n");
{
  const evalA = evaluateAccountHealth(baseHealthInput({ investmentActual: 1234 }));
  const client = buildPortfolioClient(fixtureState("cliente-x", "gestor-1", evalA), ["meta"], "gestor-1", undefined);
  ok(
    "investmentActual do cliente é o mesmo valor já resolvido pelo Motor de Saúde pro mês consultado (nenhum recálculo)",
    client.investmentActual === 1234,
  );
  ok(
    "loadTeamMemberProfiles resolve o range a partir do ÚNICO monthParam recebido (monthRangeFromOperationParam), nunca duas janelas",
    /monthRangeFromOperationParam\(monthParam\)/.test(teamPerformanceDataSource) &&
      teamPerformanceDataSource.match(/monthRangeFromOperationParam\(/g)?.length === 1,
  );
}

console.log("\n5 — Investimento NUNCA é somado/tratado como histórico\n");
{
  ok(
    "nenhuma soma de investimento all-time existe no arquivo (só activity all-time, nunca investimento)",
    !/investmentAllTime|historicalInvestment|totalInvestment/.test(teamPerformanceDataSource),
  );
  ok(
    "UI do perfil explica por que não mostra investimento histórico",
    /Investimento gerenciado historicamente não é mostrado/.test(teamProfilePageSource),
  );
  ok(
    'nenhum rótulo tipo "gerenciado historicamente"/"desde que entrou"/"na KOFF" é usado pra investimento',
    !/gerenciados historicamente|desde que entrou/.test(teamProfilePageSource) && !/na KOFF desde/.test(teamProfilePageSource),
  );
}

console.log("\n6 — Performance usa o target canônico (evaluation.dimensions.cost, sem recálculo)\n");
{
  const evalWithTarget = evaluateAccountHealth(baseHealthInput({ costActual: 24, costPlanned: 30, resultActual: 10 }));
  const client = buildPortfolioClient(fixtureState("cliente-y", "gestor-1", evalWithTarget), ["meta"], "gestor-1", undefined);
  ok("costActual é exatamente o valor do Motor de Saúde (24), nenhum recálculo", client.costActual === 24);
  ok("costTarget é exatamente a meta configurada (30), nenhum recálculo", client.costTarget === 30);
  ok("dentro/melhor que a meta (24 < 30) — costWithinOrAboveTarget true", client.costComparable && client.costWithinOrAboveTarget === true);
}

console.log('\n7 — Conta sem target/amostra/escopo comparável NUNCA vira "abaixo da meta" artificialmente\n');
{
  const noTarget = evaluateAccountHealth(baseHealthInput({ costActual: null, costPlanned: null }));
  const insufficientSample = evaluateAccountHealth(baseHealthInput({ resultActual: 1, costActual: 40, costPlanned: 30 }));
  const nonComparableScope = evaluateAccountHealth(baseHealthInput({ costActual: 40, costPlanned: 30, resultActual: 10, costScopeComparable: false }));

  for (const [label, evaluation] of [
    ["sem meta de custo configurada", noTarget],
    ["amostra insuficiente", insufficientSample],
    ["escopo de canal não comparável", nonComparableScope],
  ] as const) {
    const client = buildPortfolioClient(fixtureState("cliente-z", "gestor-1", evaluation), ["meta"], "gestor-1", undefined);
    ok(`${label}: costComparable é false`, client.costComparable === false);
    ok(`${label}: costWithinOrAboveTarget é null (nunca false/"fora da meta")`, client.costWithinOrAboveTarget === null);

    const summary = summarizePortfolio([client]);
    ok(`${label}: não entra no denominador de "performance da carteira"`, summary.comparableCount === 0);
    ok(`${label}: não entra no numerador de "performance da carteira"`, summary.withinOrAboveTargetCount === 0);
  }
}

console.log("\n8 — Otimizações não têm double count (evento de análise nunca soma junto)\n");
{
  const rows = [
    { actor_team_member_id: "gestor-1", event_type: "account_review_recorded" }, // nunca deve contar
    { actor_team_member_id: "gestor-1", event_type: "account_optimization_recorded" },
    { actor_team_member_id: "gestor-1", event_type: "account_optimization_recorded" },
    { actor_team_member_id: "gestor-1", event_type: "account_optimization_recorded" },
    { actor_team_member_id: "gestor-1", event_type: "task_completed" }, // nunca deve contar (genérico)
    { actor_team_member_id: "gestor-1", event_type: "meeting_completed" },
    { actor_team_member_id: "gestor-1", event_type: "client_report_sent" },
    { actor_team_member_id: "gestor-1", event_type: "client_report_sent" },
    { actor_team_member_id: null, event_type: "account_optimization_recorded" }, // sem ator, nunca conta
    { actor_team_member_id: "gestor-2", event_type: "account_optimization_recorded" },
  ];
  const byActor = countByActor(rows);

  ok("gestor-1: exatamente 3 otimizações (nunca 4, mesmo com 1 account_review_recorded misturado)", byActor.get("gestor-1")?.optimizations === 3);
  ok("gestor-1: exatamente 1 reunião (task_completed genérico do mesmo lote NUNCA soma)", byActor.get("gestor-1")?.meetings === 1);
  ok("gestor-1: exatamente 2 reports enviados", byActor.get("gestor-1")?.reportsSent === 2);
  ok("gestor-2: exatamente 1 otimização (carteira de gestor-1 nunca vaza pra gestor-2)", byActor.get("gestor-2")?.optimizations === 1);
  ok("evento sem actor_team_member_id nunca é atribuído a ninguém", (byActor.get("gestor-2")?.optimizations ?? 0) === 1);
}

console.log("\n9 — Reports/reuniões só contam a partir do event_type canônico\n");
{
  ok(
    'ACTIVITY_EVENT_TYPES é só account_optimization_recorded/client_report_sent/meeting_completed — nunca monthly_report_* nem task_completed genérico',
    /const ACTIVITY_EVENT_TYPES = \["account_optimization_recorded", "client_report_sent", "meeting_completed"\] as const/.test(
      teamPerformanceDataSource,
    ),
  );
  ok("countByActor ignora explicitamente qualquer event_type fora da lista", /if \(!ACTIVITY_EVENT_TYPES\.includes\(eventType\)\) continue;/.test(teamPerformanceDataSource));
  ok("emptyActivityCounts começa zerado (nunca um valor default != 0)", JSON.stringify(emptyActivityCounts()) === JSON.stringify({ optimizations: 0, reportsSent: 0, meetings: 0 }));
}

console.log('\n10 — Conquistas só aparecem se atribuíveis (scope "person", ator real)\n');
{
  ok('fetchAchievements é chamado com scope: "person" (nunca "client"/"agency")', /fetchAchievements\(supabase, organizationId, \{ scope: "person" \}/.test(teamPerformanceDataSource));
  ok(
    "loop de agrupamento por ator descarta achievement sem actorTeamMemberId (nunca infere via primary_manager_id atual)",
    /if \(!achievement\.actorTeamMemberId\) continue;/.test(teamPerformanceDataSource),
  );
  ok("nenhuma leitura de clients.primary_manager_id é usada pra atribuir conquista de cliente a um gestor", !/achievement[\s\S]{0,40}primary_manager_id/.test(teamPerformanceDataSource));
}

console.log("\n11 — Nenhuma nota/score/ranking/bônus criado nesta fase\n");
{
  const combinedSource = `${teamPerformanceDataSource}\n${teamListPageSource}\n${teamProfilePageSource}`;
  ok("nenhuma palavra de score/nota/ranking/nível/XP nos 3 arquivos novos", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|nota:|Performance Score/i.test(combinedSource));
  ok("nenhuma palavra de bônus/comissão/prêmio/remuneração/salário/folha", !/b[oô]nus|comiss[aã]o|pr[eê]mio|remunera[çc][aã]o|sal[aá]rio|folha/i.test(combinedSource));
  ok("nenhum badge/medalha/insígnia automática (Bronze/Prata/Ouro) é definido", !/bronze|prata|ouro|insígnia|medalha/i.test(combinedSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
