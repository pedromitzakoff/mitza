/**
 * Testes de `resolveOperationPriorityGroup`/`groupClientsByOperationPriority`
 * (lib/operation-triage.ts) — Etapa "Central de Decisão Diária" da Operação.
 * Usa `evaluateAccountHealth` de verdade (o motor real, não um fixture à
 * mão) pra garantir que o agrupamento reage exatamente ao que o motor
 * decide, sem nenhuma severidade nova. Foco especial no caso que motivou a
 * mudança: uma conta sem configuração mínima é a MAIS grave pro motor
 * ("sem dado confiável não existe operação"), mas deve aparecer por ÚLTIMO
 * na fila da Operação, nunca competindo com um problema real de
 * performance/investimento.
 *
 * Rodar: npx tsx scripts/test-operation-priority-grouping.ts
 */
import assert from "node:assert/strict";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import { resolveOperationPriorityGroup, groupClientsByOperationPriority } from "../src/lib/operation-triage";
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

console.log("resolveOperationPriorityGroup\n");

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
  const atencaoRelevante = evaluateAccountHealth(baseInput({ investmentActual: 655 })); // deviation 0.31 -> relevante
  check("desvio relevante (em_risco) -> 'atencao' (leve e relevante caem no mesmo balde)", resolveOperationPriorityGroup(atencaoRelevante), "atencao");
}
{
  // O caso central desta etapa: falta de configuração é "acao_necessaria"
  // pro motor (a mais grave de todas — dataQuality sempre vence o
  // desempate, ver account-health-engine.ts), mas aqui deve virar
  // 'sem_dados', NUNCA 'critico'.
  const semPlano = evaluateAccountHealth(baseInput({ investmentPlanned: null }));
  check("healthStatus do motor pra falta de plano é o mais grave que existe", semPlano.healthStatus, "acao_necessaria");
  check("mas o balde da Operação é 'sem_dados', nunca 'critico' (não é problema de performance)", resolveOperationPriorityGroup(semPlano), "sem_dados");
}
{
  // Mesmo quando o motivo de dataQuality é mais ameno (ex.: meta de custo
  // ausente) — qualquer issue de dataQuality sempre vira 'sem_dados' aqui,
  // nunca dilui pra 'atencao'.
  const semMetaCusto = evaluateAccountHealth(baseInput({ costPlanned: null }));
  check("meta de custo não definida -> 'sem_dados'", resolveOperationPriorityGroup(semMetaCusto), "sem_dados");
}
{
  // O caso sutil já coberto em test-account-health-engine.ts: healthStatus
  // 'saudavel' com primaryReason de amostra insuficiente (primaryDimension
  // 'cost', não 'dataQuality') -> continua 'saudavel' aqui, nunca 'sem_dados'
  // (amostra insuficiente não é config ausente).
  const amostraInsuficiente = evaluateAccountHealth(
    baseInput({ resultPlanned: 2, resultActual: 2, costPlanned: 40, costActual: 50, reviewMaxBusinessDays: null }),
  );
  check("healthStatus continua 'saudavel' nesse caso sutil", amostraInsuficiente.healthStatus, "saudavel");
  check("primaryDimension é 'cost', não 'dataQuality'", amostraInsuficiente.primaryDimension, "cost");
  check("balde da Operação é 'saudavel' (amostra insuficiente não é falta de configuração)", resolveOperationPriorityGroup(amostraInsuficiente), "saudavel");
}

console.log("\ngroupClientsByOperationPriority\n");

{
  const cards = [
    fixtureCard("Saudável A", evaluateAccountHealth(baseInput())),
    fixtureCard("Sem dados A", evaluateAccountHealth(baseInput({ investmentPlanned: null }))),
    fixtureCard("Crítico A", evaluateAccountHealth(baseInput({ investmentActual: 755 }))),
    fixtureCard("Atenção A", evaluateAccountHealth(baseInput({ investmentActual: 580 }))),
    fixtureCard("Crítico B", evaluateAccountHealth(baseInput({ investmentActual: 760 }))),
  ];
  const grouped = groupClientsByOperationPriority(cards);
  check("ordem final: Crítico(s) -> Atenção -> Saudável -> Sem dados, nunca dataQuality no topo", grouped.map((c) => c.clientName), [
    "Crítico A",
    "Crítico B",
    "Atenção A",
    "Saudável A",
    "Sem dados A",
  ]);
}
{
  // Dentro do mesmo balde, a ordem relativa de entrada é preservada
  // (partição estável) — nenhum critério de desempate novo inventado aqui.
  const cards = [
    fixtureCard("Crítico B (entrou primeiro)", evaluateAccountHealth(baseInput({ investmentActual: 760 }))),
    fixtureCard("Crítico A (entrou depois)", evaluateAccountHealth(baseInput({ investmentActual: 755 }))),
  ];
  const grouped = groupClientsByOperationPriority(cards);
  check("mesmo balde ('critico' os dois) -> mantém a ordem de entrada, sort estável", grouped.map((c) => c.clientName), [
    "Crítico B (entrou primeiro)",
    "Crítico A (entrou depois)",
  ]);
}

console.log(`\n${passed} verificações passaram.`);
