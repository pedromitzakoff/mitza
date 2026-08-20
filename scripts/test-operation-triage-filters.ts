/**
 * Testes de `filterOperationTriageClients`/`summarizeOperationTriage`
 * (lib/operation-triage.ts) — Etapa "Unificação da Leitura da Operação":
 * o topo da tela passou a filtrar por GRAVIDADE (mesma classificação que já
 * agrupa a lista, `resolveOperationPriorityGroup`), nunca mais por eixo de
 * diagnóstico (Planejamento/Investimento/CPA/Pendências). Cobre os 7
 * cenários pedidos (A-G): cada filtro isolado, a composição gestor+
 * gravidade, e a composição completa busca+gestor+gravidade. Usa
 * `evaluateAccountHealth` de verdade (o motor real), nunca um score
 * fabricado à mão.
 *
 * Rodar: npx tsx scripts/test-operation-triage-filters.ts
 */
import assert from "node:assert/strict";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import { filterOperationTriageClients, summarizeOperationTriage, resolveOperationPriorityGroup } from "../src/lib/operation-triage";
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
 * `filterOperationTriageClients`/`summarizeOperationTriage` de fato leem
 * (`evaluation`, `managerId`, `managerName`, `clientName`); os demais campos
 * existem só pra satisfazer o tipo. Mesmo padrão de
 * `scripts/test-operation-priority-grouping.ts`. */
function fixtureCard(
  clientName: string,
  evaluation: ReturnType<typeof evaluateAccountHealth>,
  overrides: Partial<Pick<ClientOperationalState, "managerId" | "managerName">> = {},
): ClientOperationalState {
  return {
    clientId: clientName,
    clientName,
    managerId: overrides.managerId ?? null,
    managerName: overrides.managerName ?? null,
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

const healthySaudavel = evaluateAccountHealth(baseInput());
const healthyCritico = evaluateAccountHealth(baseInput({ investmentActual: 755 })); // deviation 0.51 -> grave
const healthyAtencao = evaluateAccountHealth(baseInput({ investmentActual: 580 })); // deviation 0.16 -> leve
const healthySemDados = evaluateAccountHealth(baseInput({ investmentPlanned: null }));

check("fixture — Saudável realmente cai em 'saudavel'", resolveOperationPriorityGroup(healthySaudavel), "saudavel");
check("fixture — Crítico realmente cai em 'critico'", resolveOperationPriorityGroup(healthyCritico), "critico");
check("fixture — Atenção realmente cai em 'atencao'", resolveOperationPriorityGroup(healthyAtencao), "atencao");
check("fixture — Sem dados realmente cai em 'sem_dados'", resolveOperationPriorityGroup(healthySemDados), "sem_dados");

const cards: ClientOperationalState[] = [
  fixtureCard("Crítico A", healthyCritico, { managerId: "gestor-1", managerName: "Ana" }),
  fixtureCard("Crítico B", healthyCritico, { managerId: "gestor-2", managerName: "Bruno" }),
  fixtureCard("Atenção A", healthyAtencao, { managerId: "gestor-1", managerName: "Ana" }),
  fixtureCard("Saudável A", healthySaudavel, { managerId: "gestor-1", managerName: "Ana" }),
  fixtureCard("Saudável B", healthySaudavel, { managerId: "gestor-2", managerName: "Bruno" }),
  fixtureCard("Sem dados A", healthySemDados, { managerId: "gestor-2", managerName: "Bruno" }),
];

console.log("Cenário A — Todos retorna todas as contas\n");
{
  const result = filterOperationTriageClients(cards, { severity: "todos", managerId: "todos", query: "" });
  check("A — 6 contas, nenhuma excluída", result.length, 6);
}

console.log("\nCenário B — Críticas retorna só 'critical'\n");
{
  const result = filterOperationTriageClients(cards, { severity: "critico", managerId: "todos", query: "" });
  check("B — só as 2 críticas", result.map((c) => c.clientName).sort(), ["Crítico A", "Crítico B"]);
}

console.log("\nCenário C — Atenção retorna só atenção\n");
{
  const result = filterOperationTriageClients(cards, { severity: "atencao", managerId: "todos", query: "" });
  check("C — só a 1 em atenção", result.map((c) => c.clientName), ["Atenção A"]);
}

console.log("\nCenário D — Saudáveis retorna só saudáveis\n");
{
  const result = filterOperationTriageClients(cards, { severity: "saudavel", managerId: "todos", query: "" });
  check("D — só as 2 saudáveis", result.map((c) => c.clientName).sort(), ["Saudável A", "Saudável B"]);
}

console.log("\nCenário E — Sem dados retorna só não avaliáveis\n");
{
  const result = filterOperationTriageClients(cards, { severity: "sem_dados", managerId: "todos", query: "" });
  check("E — só a 1 sem dados", result.map((c) => c.clientName), ["Sem dados A"]);
}

console.log("\nCenário F — Gestor + severidade funcionam juntos\n");
{
  const result = filterOperationTriageClients(cards, { severity: "critico", managerId: "gestor-1", query: "" });
  check("F — crítico + gestor Ana -> só Crítico A", result.map((c) => c.clientName), ["Crítico A"]);

  const noMatch = filterOperationTriageClients(cards, { severity: "saudavel", managerId: "gestor-2", query: "" });
  check("F — saudável + gestor Bruno -> só Saudável B (nunca Saudável A, da Ana)", noMatch.map((c) => c.clientName), ["Saudável B"]);
}

console.log("\nCenário G — Busca + gestor + severidade compõem corretamente\n");
{
  // Busca por nome do CLIENTE, combinada com gestor e severidade — as três
  // condições precisam ser satisfeitas ao mesmo tempo (E lógico).
  const result = filterOperationTriageClients(cards, { severity: "critico", managerId: "gestor-1", query: "crítico a" });
  check("G — busca 'crítico a' + gestor Ana + crítico -> só Crítico A", result.map((c) => c.clientName), ["Crítico A"]);

  // Mesma busca, mas filtrando pro gestor errado -> composição derruba pra
  // zero, nunca ignora um dos três critérios.
  const wrongManager = filterOperationTriageClients(cards, { severity: "critico", managerId: "gestor-2", query: "crítico a" });
  check("G — mesma busca + gestor errado (Bruno) -> vazio (Crítico A é da Ana)", wrongManager.length, 0);

  // Busca por nome de GESTOR também funciona (não só nome de cliente).
  const byManagerName = filterOperationTriageClients(cards, { severity: "todos", managerId: "todos", query: "bruno" });
  check("G — busca por nome de gestor -> só contas do Bruno", byManagerName.map((c) => c.clientName).sort(), [
    "Crítico B",
    "Saudável B",
    "Sem dados A",
  ]);
}

console.log("\nsummarizeOperationTriage — contagens do topo batem exatamente com a lista real\n");
{
  const summary = summarizeOperationTriage(cards);
  check("total = 6", summary.totalClients, 6);
  check("críticas = 2", summary.critico, 2);
  check("atenção = 1", summary.atencao, 1);
  check("saudáveis = 2", summary.saudavel, 2);
  check("sem dados = 1", summary.semDados, 1);
  check(
    "soma dos 4 baldes == total (nenhuma conta perdida nem contada duas vezes)",
    summary.critico + summary.atencao + summary.saudavel + summary.semDados,
    summary.totalClients,
  );
}

console.log(`\n${passed} verificações passaram.`);
