/**
 * Testes de `resolveOperationPriorityGroup` (geral, Dashboard/Visão Geral do
 * cliente) e de `resolveOperationCpaPriorityGroup`/`groupClientsByOperationPriority`
 * (Operação, Etapa "Operação — CPA como régua única") — lib/operation-triage.ts.
 * Usa `evaluateAccountHealth` de verdade (o motor real, não um fixture à
 * mão) pra garantir que o agrupamento reage exatamente ao que o motor
 * decide, sem nenhuma severidade nova.
 *
 * `resolveOperationPriorityGroup` continua exatamente como antes (consumida
 * por `app/page.tsx`/Dashboard e `clients/[id]/page.tsx`/Visão Geral do
 * cliente — nenhuma das duas telas muda nesta etapa): a pior das 5
 * dimensões do motor decide o balde, e uma conta sem configuração mínima
 * vira 'sem_dados', nunca 'critico' (o caso que motivou essa distinção).
 *
 * `resolveOperationCpaPriorityGroup`/`groupClientsByOperationPriority` são
 * exclusivas da Operação a partir desta etapa: SÓ o custo por resultado
 * (contra a meta) decide o balde — investimento e resultado (volume) nunca
 * mais influenciam, mesmo com desvio grave. Cobre também os dois estados
 * "ainda não avaliável" que já existiam no motor (amostra insuficiente,
 * escopo não comparável) — agora promovidos a 'sem_dados' na Operação, em
 * vez de ficarem escondidos dentro de um 'saudavel' silencioso.
 *
 * Rodar: npx tsx scripts/test-operation-priority-grouping.ts
 */
import assert from "node:assert/strict";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import {
  resolveOperationPriorityGroup,
  resolveOperationCpaPriorityGroup,
  groupClientsByOperationPriority,
} from "../src/lib/operation-triage";
import type { ClientOperationalState } from "../src/lib/client-operational-state";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function baseInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
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

/** Fixture mínimo de `ClientOperationalState` — só o que
 * `groupClientsByOperationPriority` de fato lê (`evaluation`); os demais
 * campos existem só pra satisfazer o tipo. */
function fixtureCard(clientName: string, evaluation: ReturnType<typeof evaluateAccountHealth>): ClientOperationalState {
  return {
    clientId: clientName,
    clientName,
    managerId: null,
    managerName: null,
    avatarUrl: null,
    performanceGoal: "sales",
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

console.log("resolveOperationPriorityGroup (geral — Dashboard/Visão Geral do cliente, inalterada)\n");

{
  const clean = evaluateAccountHealth(baseInput());
  check("input totalmente limpo -> 'saudavel'", resolveOperationPriorityGroup(clean), "saudavel");
}
{
  const critico = evaluateAccountHealth(baseInput({ investmentActual: 755 })); // deviation 0.51 -> grave
  check("investimento 51% acima do esperado -> 'critico'", resolveOperationPriorityGroup(critico), "critico");
}
{
  const atencaoLeve = evaluateAccountHealth(baseInput({ investmentActual: 580 })); // deviation 0.16 -> leve
  check("desvio leve (em_acompanhamento) -> 'atencao'", resolveOperationPriorityGroup(atencaoLeve), "atencao");
}
{
  // O caso central que motivou o balde 'sem_dados': falta de configuração é
  // "acao_necessaria" pro motor (a mais grave de todas — dataQuality sempre
  // vence o desempate, ver account-health-engine.ts), mas aqui deve virar
  // 'sem_dados', NUNCA 'critico'.
  const semPlano = evaluateAccountHealth(baseInput({ investmentPlanned: null }));
  check("healthStatus do motor pra falta de plano é o mais grave que existe", semPlano.healthStatus, "acao_necessaria");
  check("mas o balde é 'sem_dados', nunca 'critico' (não é problema de performance)", resolveOperationPriorityGroup(semPlano), "sem_dados");
}

console.log("\nresolveOperationCpaPriorityGroup (exclusiva da Operação — só CPA decide)\n");

{
  const saudavel = evaluateAccountHealth(baseInput());
  check("CPA dentro da meta -> 'saudavel'", resolveOperationCpaPriorityGroup(saudavel), "saudavel");
}
{
  const cpaGrave = evaluateAccountHealth(baseInput({ costActual: 76 })); // 52% acima da meta (50) -> grave
  check("CPA 52% acima da meta -> 'critico'", resolveOperationCpaPriorityGroup(cpaGrave), "critico");
}
{
  const cpaLeve = evaluateAccountHealth(baseInput({ costActual: 56 })); // 12% acima -> leve
  const cpaRelevante = evaluateAccountHealth(baseInput({ costActual: 66 })); // 32% acima -> relevante
  check("CPA 12% acima da meta (leve) -> 'atencao'", resolveOperationCpaPriorityGroup(cpaLeve), "atencao");
  check("CPA 32% acima da meta (relevante) -> 'atencao' (leve e relevante caem no mesmo balde)", resolveOperationCpaPriorityGroup(cpaRelevante), "atencao");
}
{
  // O núcleo do pedido: investimento e resultado NUNCA mais decidem o
  // balde da Operação, mesmo com desvio grave — só o CPA importa.
  const investimentoGrave = evaluateAccountHealth(baseInput({ investmentActual: 900 })); // 80% acima -> grave no motor
  check("motor de verdade classifica investimento como 'grave'", investimentoGrave.dimensions.investment.status, "grave");
  check("mas a Operação (CPA-only) continua 'saudavel' — investimento não decide mais", resolveOperationCpaPriorityGroup(investimentoGrave), "saudavel");

  // `resultActual: 3`/`resultPlanned: 20` (em vez do padrão 10/10): mantém a
  // amostra >= 3 (MIN_RELIABLE_RESULT_COUNT) pra não acionar a trava de
  // "amostra insuficiente" do custo por engano — o ponto é um desvio de
  // RESULTADO real e grave, não amostra pequena.
  const resultadoGrave = evaluateAccountHealth(baseInput({ resultActual: 3, resultPlanned: 20 })); // 70% abaixo -> grave no motor
  check("motor de verdade classifica resultado como 'grave'", resultadoGrave.dimensions.results.status, "grave");
  check("mas a Operação (CPA-only) continua 'saudavel' — resultado não decide mais", resolveOperationCpaPriorityGroup(resultadoGrave), "saudavel");

  const revisaoAtrasada = evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 25 })); // 150% do prazo -> grave
  check("motor de verdade classifica revisão como 'grave'", revisaoAtrasada.dimensions.review.status, "grave");
  check("mas a Operação (CPA-only) continua 'saudavel' — revisão não decide mais", resolveOperationCpaPriorityGroup(revisaoAtrasada), "saudavel");
}
{
  // Qualidade de dado continua o balde de maior prioridade, idêntico ao
  // resolver geral — "sem dado confiável não existe operação" não mudou.
  const semPlano = evaluateAccountHealth(baseInput({ investmentPlanned: null }));
  check("falta de configuração -> 'sem_dados' também na Operação", resolveOperationCpaPriorityGroup(semPlano), "sem_dados");
}
{
  // Os dois estados "CPA ainda não avaliável" (amostra insuficiente, escopo
  // não comparável) — o motor já travava a severidade em 'nenhum' pra eles;
  // a Operação promove isso a 'sem_dados' explícito, nunca 'saudavel' (que
  // sugeriria uma avaliação real que ainda não aconteceu).
  const amostraInsuficiente = evaluateAccountHealth(baseInput({ resultActual: 2, resultPlanned: 2 }));
  check("amostra insuficiente (<3 resultados) -> cost.status 'nenhum' no motor", amostraInsuficiente.dimensions.cost.status, "nenhum");
  check("amostra insuficiente -> 'sem_dados' na Operação (ainda não dá pra avaliar)", resolveOperationCpaPriorityGroup(amostraInsuficiente), "sem_dados");

  const escopoNaoComparavel = evaluateAccountHealth(baseInput({ costScopeComparable: false }));
  check("escopo não comparável -> 'sem_dados' na Operação", resolveOperationCpaPriorityGroup(escopoNaoComparavel), "sem_dados");
}

console.log("\ngroupClientsByOperationPriority (Operação — usa resolveOperationCpaPriorityGroup)\n");

{
  const cards = [
    fixtureCard("Saudável A", evaluateAccountHealth(baseInput())),
    fixtureCard("Sem dados A", evaluateAccountHealth(baseInput({ investmentPlanned: null }))),
    fixtureCard("Crítico A", evaluateAccountHealth(baseInput({ costActual: 76 }))),
    fixtureCard("Atenção A", evaluateAccountHealth(baseInput({ costActual: 56 }))),
    fixtureCard("Crítico B", evaluateAccountHealth(baseInput({ costActual: 80 }))),
    // Investimento gravemente desviado, CPA saudável — precisa cair no
    // mesmo balde de "Saudável A", nunca competir com os críticos de CPA.
    fixtureCard("Saudável B (investimento grave, CPA ok)", evaluateAccountHealth(baseInput({ investmentActual: 900 }))),
  ];
  const grouped = groupClientsByOperationPriority(cards);
  check("ordem final: Crítico(s) -> Atenção -> Saudável(is) -> Sem dados, só por CPA", grouped.map((c) => c.clientName), [
    "Crítico A",
    "Crítico B",
    "Atenção A",
    "Saudável A",
    "Saudável B (investimento grave, CPA ok)",
    "Sem dados A",
  ]);
}
{
  // Dentro do mesmo balde, a ordem relativa de entrada é preservada
  // (partição estável) — nenhum critério de desempate novo inventado aqui.
  const cards = [
    fixtureCard("Crítico B (entrou primeiro)", evaluateAccountHealth(baseInput({ costActual: 80 }))),
    fixtureCard("Crítico A (entrou depois)", evaluateAccountHealth(baseInput({ costActual: 76 }))),
  ];
  const grouped = groupClientsByOperationPriority(cards);
  check("mesmo balde ('critico' os dois) -> mantém a ordem de entrada, sort estável", grouped.map((c) => c.clientName), [
    "Crítico B (entrou primeiro)",
    "Crítico A (entrou depois)",
  ]);
}

console.log(`\n${passed} verificações passaram.`);
