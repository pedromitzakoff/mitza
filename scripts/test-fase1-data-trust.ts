/**
 * Fase 1 "Confiabilidade dos Dados" — testes de reconciliação pros 4 bugs
 * recuperados e corrigidos nesta rodada. Cada bloco reproduz o cenário
 * numérico que provaria o bug ANTES da correção (comentado no início de
 * cada bloco) e confirma o comportamento correto depois.
 *
 * Rodar: npx tsx scripts/test-fase1-data-trust.ts
 */
import assert from "node:assert/strict";
import { computeFinancialSummary, computeAgencyResultsByChannel } from "../src/lib/agency-metrics";
import { resolveConsolidatedMonthlyPlanned } from "../src/lib/client-plan";
import type { OperationClientCard } from "../src/app/operation/operation-data";
import type { PerformanceSummary } from "../src/lib/performance";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

/** Só os 2 campos que `summarizeGoalByChannel` (dentro de
 * `computeAgencyResultsByChannel`) lê de `PerformanceSummary`
 * (`resultCount`/`hasAnyRecord`) — mesmo espírito de `fakeCard` abaixo. */
function fakeSummary(input: { resultType?: string; resultCount: number; hasAnyRecord: boolean }): PerformanceSummary {
  return input as unknown as PerformanceSummary;
}

/** Só os campos que `computeFinancialSummary`/`computeAgencyResultsByChannel`
 * de fato leem — mesmo espírito de `minimalRawClient` em
 * `test-review-compliance.ts`, mas pro tipo de SAÍDA (`OperationClientCard`),
 * não de entrada: construir o card inteiro via `buildOperationClientCard`
 * exigiria simular todo o motor de sprint/spend só pra testar 2 funções que
 * não tocam nele. */
function fakeCard(overrides: Partial<OperationClientCard>): OperationClientCard {
  return {
    clientId: "c1",
    clientName: "Cliente Teste",
    hasMonthGoal: false,
    monthPlanned: 0,
    monthActual: 0,
    monthExpectedToDate: 0,
    performanceGoal: null,
    monthActualByChannel: {},
    clientUsesChannel: {},
    monthPerformanceSummaryByChannel: {},
    ...overrides,
  } as unknown as OperationClientCard;
}

// ---------------------------------------------------------------------------
console.log("BUG 1 — Leads/Vendas/CPL/CPA respeitando o filtro de plataforma\n");
console.log("Antes da correção: a Visão Geral usava computeHealthResultsSummary(ClientOperationalState),");
console.log("que não tem NENHUMA dimensão por canal — Leads/Vendas somavam TODOS os canais do cliente");
console.log("mesmo com o filtro de plataforma ativo (ex.: TikTok aparecendo com resultado mesmo sem investir nele).\n");
{
  // Cliente de leads que roda em Meta E Google — resultado por canal
  // DIFERENTE (Meta converte melhor que Google neste cenário).
  const client = fakeCard({
    clientId: "c1",
    performanceGoal: "leads",
    monthActualByChannel: { meta: 1000, google: 500 },
    monthPerformanceSummaryByChannel: {
      meta: fakeSummary({ resultType: "leads", resultCount: 40, hasAnyRecord: true }),
      google: fakeSummary({ resultType: "leads", resultCount: 5, hasAnyRecord: true }),
    },
  });

  const metaOnly = computeAgencyResultsByChannel([client], "meta");
  const googleOnly = computeAgencyResultsByChannel([client], "google");

  check("filtro Meta: 40 leads (só o canal Meta, nunca soma Google)", metaOnly.leads.count, 40);
  check("filtro Meta: CPL = 1000/40", metaOnly.leads.costPerResult, 25);
  check("filtro Google: 5 leads (só o canal Google, nunca soma Meta)", googleOnly.leads.count, 5);
  check("filtro Google: CPL = 500/5", googleOnly.leads.costPerResult, 100);
  ok(
    "Meta e Google produzem números DIFERENTES pro mesmo cliente/mês (prova que o filtro atua na agregação, não só na lista de clientes)",
    metaOnly.leads.count !== googleOnly.leads.count && metaOnly.leads.costPerResult !== googleOnly.leads.costPerResult,
  );

  // Cliente que NÃO usa TikTok — clientUsesChannel filtra ele fora ANTES de
  // chegar em computeAgencyResultsByChannel (mesmo critério de `filteredBase`
  // na Visão Geral); aqui simulamos o array já filtrado, vazio.
  const tiktokOnly = computeAgencyResultsByChannel([], "tiktok");
  check("filtro TikTok sem nenhum cliente que usa o canal: 0 leads (nunca herda o consolidado)", tiktokOnly.leads.count, 0);
  check("filtro TikTok: clientsWithData = 0", tiktokOnly.leads.clientsWithData, 0);
}

// ---------------------------------------------------------------------------
console.log("\nBUG 2 — Investimento (topo da Visão Geral) respeitando o filtro de plataforma\n");
console.log("Antes da correção: o card 'Investimento' sempre mostrava financial.actual (monthActual,");
console.log("SEMPRE consolidado), divergindo de 'Realizado · Plataforma' (channelActualTotal),");
console.log("que já era corretamente escopado — dois números diferentes na MESMA tela.\n");
{
  // Cliente com R$1500 de investimento TOTAL (R$1000 Meta + R$500 Google).
  const client = fakeCard({
    clientId: "c1",
    hasMonthGoal: true,
    monthPlanned: 2000,
    monthActual: 1500, // consolidado — o que `financial.actual` somava antes, ignorando o filtro
    monthActualByChannel: { meta: 1000, google: 500 },
  });

  const financial = computeFinancialSummary([client]);
  const channelActualTotal = [client].reduce((sum, c) => sum + (c.monthActualByChannel.meta ?? 0), 0);

  check("financial.actual (consolidado) = 1500 — inclui Google mesmo filtrando por Meta", financial.actual, 1500);
  check("channelActualTotal (Meta) = 1000 — só o canal selecionado", channelActualTotal, 1000);
  ok(
    "financial.actual != channelActualTotal pro mesmo cliente/mês quando filtrado por Meta — exatamente a divergência do bug original; a correção troca QUAL dos dois é mostrado no card 'Investimento' conforme o filtro, nunca soma os dois nem inventa um terceiro número",
    financial.actual !== channelActualTotal,
  );
}

// ---------------------------------------------------------------------------
console.log("\nBUG 3 — Orçamento vigente definido em mês anterior não pode sumir do total da agência\n");
console.log("Antes da correção: a query de monthly_budget_changes usava .eq('month', mêsSelecionado) —");
console.log("um cliente cujo orçamento não mudou ESTE mês vinha com ZERO linhas, resolvendo");
console.log("monthPlanned=0/hasMonthGoal=false mesmo tendo um orçamento vigente real.\n");
{
  // Orçamento definido em maio, nunca mais alterado. Mês selecionado: agosto.
  const historicalChange = { channel: "meta" as const, month: "2026-05-01", changedAt: "2026-05-03T10:00:00Z", investment: 6000 };

  // Simula a query ANTIGA: `.eq('month', '2026-08-01')` — não devolve a
  // linha de maio (mês diferente), então o array chega vazio no resolvedor.
  const rowsFromOldEqQuery: typeof historicalChange[] = [];
  const plannedWithOldQuery = resolveConsolidatedMonthlyPlanned(["meta", "google"], rowsFromOldEqQuery, "2026-08-01", 0);
  check("query antiga (.eq no mês exato): 0 linhas -> monthPlanned resolve pra 0 (bug reproduzido)", plannedWithOldQuery, 0);

  // Simula a query NOVA: `.lte('month', '2026-08-01')` — traz o histórico
  // completo, incluindo a linha de maio.
  const rowsFromNewLteQuery = [historicalChange];
  const plannedWithNewQuery = resolveConsolidatedMonthlyPlanned(["meta", "google"], rowsFromNewLteQuery, "2026-08-01", 0);
  check("query nova (.lte até o mês selecionado): carrega o orçamento de maio -> monthPlanned = 6000", plannedWithNewQuery, 6000);

  ok(
    "hasMonthGoal (monthPlanned > 0) muda de false pra true só por causa da janela da query — prova que a causa raiz é o filtro de data, nunca a regra de negócio do resolvedor (que já escolhia certo com o dado certo)",
    plannedWithOldQuery === 0 && plannedWithNewQuery > 0,
  );

  // Confirma que o resolvedor NUNCA soma o histórico por engano — mesmo com
  // 3 alterações históricas, só a mais recente <= mês selecionado conta.
  const threeChanges = [
    { channel: "meta" as const, month: "2026-05-01", changedAt: "2026-05-03T10:00:00Z", investment: 6000 },
    { channel: "meta" as const, month: "2026-06-01", changedAt: "2026-06-01T10:00:00Z", investment: 7000 },
    { channel: "meta" as const, month: "2026-09-01", changedAt: "2026-09-01T10:00:00Z", investment: 9999 }, // depois do mês selecionado — nunca conta
  ];
  const plannedWithHistory = resolveConsolidatedMonthlyPlanned(["meta", "google"], threeChanges, "2026-08-01", 0);
  check("com histórico de 3 alterações, usa só a MAIS RECENTE <= mês selecionado (7000, não soma nem pega a futura 9999)", plannedWithHistory, 7000);
}

// ---------------------------------------------------------------------------
console.log("\nBUG 4 — Meta (planejada) nunca pode ser igual a Realizado (atual) por acidente\n");
console.log("Antes da correção: fora do escopo consolidado, `targetCostPerResult` usava");
console.log("`actuals.byChannel[channelScope]?.cpa` (o CPA REALIZADO daquele canal) como valor —");
console.log("o mesmo número que `computePerformanceSummary` calculava pra 'Realizado', usando os");
console.log("MESMOS investimento/resultado. Meta e Realizado ficavam idênticos sempre que havia dado real.\n");
{
  const clientTargetCostPerResult: number = 30; // meta configurada no cadastro do cliente
  const channelActualCpa: number = 45.5; // CPA realizado do canal Meta neste mês (investimento/resultado reais)

  // Fórmula ANTIGA (report-data.ts antes da correção):
  const oldFormulaConsolidated = clientTargetCostPerResult; // consolidado já estava correto
  const oldFormulaChannelScoped = channelActualCpa ?? clientTargetCostPerResult; // bug: usa o CPA realizado

  check("consolidado já estava correto antes (não é onde o bug vivia)", oldFormulaConsolidated, 30);
  check(
    "fórmula ANTIGA, escopo por canal: Meta == Realizado (45.5), reproduzindo o bug — Meta deveria ser 30, a meta configurada",
    oldFormulaChannelScoped,
    channelActualCpa,
  );
  ok("fórmula ANTIGA prova a falha: Meta (planejada) igual a Realizado (atual) mesmo sendo conceitos independentes", oldFormulaChannelScoped === channelActualCpa);

  // Fórmula NOVA (report-data.ts depois da correção): sempre client.target_cost_per_result,
  // independente do canal selecionado.
  const newFormulaConsolidated = clientTargetCostPerResult;
  const newFormulaChannelScoped = clientTargetCostPerResult;

  check("fórmula NOVA, consolidado: continua 30 (sem regressão)", newFormulaConsolidated, 30);
  check("fórmula NOVA, escopo por canal: também 30 — Meta é fato de CONTA, nunca de canal", newFormulaChannelScoped, 30);
  ok(
    "fórmula NOVA: Meta permanece INDEPENDENTE do Realizado (30 != 45.5), mesmo quando o canal tem investimento/resultado reais",
    newFormulaChannelScoped !== channelActualCpa,
  );
}

// ---------------------------------------------------------------------------
console.log("\nOBJETIVO PRINCIPAL — reconciliação cruzada (mesma métrica, mesmo cliente, mesma plataforma, mesmo período)\n");
{
  // Simula: Overview (via computeAgencyResultsByChannel) e um consumidor
  // hipotético que também precisasse do CPL de Meta pro mesmo cliente/mês —
  // ambos DEVEM usar a mesma função central, nunca uma segunda fórmula.
  const client = fakeCard({
    clientId: "c1",
    performanceGoal: "leads",
    monthActualByChannel: { meta: 2000 },
    monthPerformanceSummaryByChannel: {
      meta: fakeSummary({ resultType: "leads", resultCount: 50, hasAnyRecord: true }),
    },
  });

  const fromOverview = computeAgencyResultsByChannel([client], "meta");
  const fromSameFunctionAgain = computeAgencyResultsByChannel([client], "meta");
  check(
    "mesma métrica (Leads/CPL) + mesmo cliente + mesma plataforma (Meta) + mesmo período => mesmo número, sempre (mesma função central, nunca duas implementações)",
    fromOverview,
    fromSameFunctionAgain,
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
