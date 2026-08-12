/**
 * Testes de equivalência do Horizonte de Planejamento (Etapa "Horizonte de
 * Planejamento") — `resolvePlanningHorizon` (lib/monthly-budget.ts) e como
 * ele se propaga pras funções temporais já existentes
 * (`computeMonthlyExpectedToDateByCalendar`, `resolveBudgetEffectiveDate`,
 * `getMonthTemporalStatus`). Cobre os 8 cenários pedidos explicitamente:
 * cliente normal idêntico ao legado, evento no meio do mês, período
 * encerrado depois do evento, mesmo horizonte pra Meta/Google, mudança de
 * data, remoção de data, mês passado com evento, e evento no último dia do
 * mês (equivalente a cliente normal).
 *
 * Rodar: npx tsx scripts/test-planning-horizon.ts
 */
import assert from "node:assert/strict";
import {
  resolvePlanningHorizon,
  resolveBudgetEffectiveDate,
  computeMonthlyExpectedToDateByCalendar,
  computeMonthlyBudgetPlan,
  getMonthTemporalStatus,
} from "../src/lib/monthly-budget";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const AGOSTO_2026 = { firstDay: "2026-08-01", lastDay: "2026-08-31" };

console.log("resolvePlanningHorizon\n");

// 1. Cliente normal sem horizonte -> comportamento legado idêntico.
check("sem planning_end_date -> devolve monthRange inalterado (byte a byte)", resolvePlanningHorizon(AGOSTO_2026, null), AGOSTO_2026);

// 2 (parte 1). Evento em 21/08 -> horizonte vira 01-21/08.
check(
  "evento em 21/08 -> lastDay vira 21/08, firstDay inalterado",
  resolvePlanningHorizon(AGOSTO_2026, "2026-08-21"),
  { firstDay: "2026-08-01", lastDay: "2026-08-21" },
);

// 2 (parte 2). Esperado até hoje calculado sobre 21 dias, não 31.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const { expectedPct } = computeMonthlyExpectedToDateByCalendar(20000, horizon, "2026-08-11");
  // dia 11 de 21 (hoje incluso) = 11/21, nunca 11/31.
  check("evento 21/08, hoje 11/08 -> esperado% é 11/21 (~52.38%), não 11/31 (~35.48%)", Math.round(expectedPct * 100) / 100, 52.38);
}

// 3. Hoje depois do evento -> período encerrado, sem recomendar investimento pra 22-31.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  check("hoje 25/08 (depois do evento 21/08) -> mês fica encerrado pro horizonte, mesmo dentro do mês civil", resolveBudgetEffectiveDate(horizon, "2026-08-25"), {
    effectiveDate: null,
    isClosedMonth: true,
  });
  check("hoje 25/08 -> status do horizonte é 'passado' (não 'atual', mesmo faltando dias no calendário)", getMonthTemporalStatus(horizon, "2026-08-25"), "passado");
}

// 4. Meta + Google -> mesmo horizonte pros dois (determinístico, mesma entrada = mesma saída).
{
  const horizonForMeta = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const horizonForGoogle = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  check("Meta e Google resolvendo o mesmo (monthRange, planningEndDate) -> horizonte idêntico", horizonForMeta, horizonForGoogle);
}

// 5. Alteração da data 21 -> 25.
check(
  "muda a data de 21 pra 25 -> horizonte reflete o novo valor (25/08)",
  resolvePlanningHorizon(AGOSTO_2026, "2026-08-25"),
  { firstDay: "2026-08-01", lastDay: "2026-08-25" },
);

// 6. Remoção da data -> volta pra 31/08.
check("remove a data (volta pra null) -> horizonte volta a ser o mês inteiro", resolvePlanningHorizon(AGOSTO_2026, null), AGOSTO_2026);

// 7. Mês passado com evento -> histórico permanece consistente (nunca vira "atual"/"futuro" por engano).
{
  const julho = { firstDay: "2026-07-01", lastDay: "2026-07-31" };
  const horizonJulho = resolvePlanningHorizon(julho, "2026-07-15");
  check("mês passado (julho) com evento em 15/07, hoje 11/08 -> continua 'passado'", getMonthTemporalStatus(horizonJulho, "2026-08-11"), "passado");
  check(
    "mesmo mês passado, SEM horizonte -> também 'passado' (evento não muda a classificação de mês já encerrado)",
    getMonthTemporalStatus(julho, "2026-08-11"),
    "passado",
  );
}

// 8. Evento no último dia do mês -> matematicamente idêntico a cliente normal.
check("planning_end_date = 31/08 (último dia) -> idêntico a monthRange (nunca um caso especial)", resolvePlanningHorizon(AGOSTO_2026, "2026-08-31"), AGOSTO_2026);
check(
  "planning_end_date DEPOIS do fim do mês (nunca estica o horizonte) -> ainda idêntico a monthRange",
  resolvePlanningHorizon(AGOSTO_2026, "2026-09-15"),
  AGOSTO_2026,
);

console.log("\ncomputeMonthlyBudgetPlan sobre o horizonte resolvido (saldo/dias restantes/recomendação diária)\n");

// Caso D — perto do evento: hoje 19/08, evento 21/08. Saldo restante
// distribuído só pelos dias restantes ATÉ O HORIZONTE (19, 20, 21 = 3
// dias), nunca até 31/08.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const plan = computeMonthlyBudgetPlan({
    monthlyBudget: 12000,
    monthActual: 0,
    monthRange: horizon,
    effectiveDate: "2026-08-19",
    sprints: [],
  });
  check("hoje 19/08, evento 21/08 -> 3 dias elegíveis (19, 20, 21), não 13", plan.eligibleDaysCount, 3);
  check("saldo de R$12.000 em 3 dias -> R$4.000/dia, não R$12.000/13 dias", plan.recommendedDaily, 4000);
}

// Caso E — dia do evento: hoje = 21/08 (o próprio último dia do horizonte).
// Ainda existe 1 dia elegível (hoje sempre conta) — nunca divisão por zero,
// nunca NaN/Infinity, nunca recomendação absurda.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const plan = computeMonthlyBudgetPlan({
    monthlyBudget: 30000,
    monthActual: 28000,
    monthRange: horizon,
    effectiveDate: "2026-08-21",
    sprints: [],
  });
  check("hoje é o próprio dia do evento -> ainda 1 dia elegível (hoje sempre conta), nunca 0", plan.eligibleDaysCount, 1);
  check("recomendação do último dia é finita e positiva (nunca NaN/Infinity)", Number.isFinite(plan.recommendedDaily) && plan.recommendedDaily >= 0, true);
  check("recomendação do último dia = todo o saldo restante (R$2.000) num único dia", plan.recommendedDaily, 2000);
}

// Caso F — depois do evento: hoje 22/08+. `resolveBudgetEffectiveDate` já
// devolve `effectiveDate: null` (testado acima) — por construção,
// `computeMonthlyBudgetPlan` NUNCA é chamada nesse estado por nenhum
// consumidor real (`plan = effectiveDate ? computeMonthlyBudgetPlan(...) :
// null`, ver month-investment-summary.tsx/operation-data.ts) — não existe
// "R$0/dia" fabricado, a recomendação simplesmente deixa de existir.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const { effectiveDate } = resolveBudgetEffectiveDate(horizon, "2026-08-22");
  check("hoje 22/08 (depois do evento) -> effectiveDate null -> nenhum consumidor chama computeMonthlyBudgetPlan, nunca mostra R$0/dia", effectiveDate, null);
}

// Caso H — planejamento multicanal: Meta R$20.000, Google R$10.000,
// Consolidado R$30.000, evento 21/08. Os 3 escopos usam o MESMO horizonte
// resolvido (resolvePlanningHorizon não sabe o que é canal) — só o
// orçamento/saldo mudam entre eles, nunca os dias elegíveis.
{
  const horizon = resolvePlanningHorizon(AGOSTO_2026, "2026-08-21");
  const today = "2026-08-19";
  const meta = computeMonthlyBudgetPlan({ monthlyBudget: 20000, monthActual: 0, monthRange: horizon, effectiveDate: today, sprints: [] });
  const google = computeMonthlyBudgetPlan({ monthlyBudget: 10000, monthActual: 0, monthRange: horizon, effectiveDate: today, sprints: [] });
  const consolidado = computeMonthlyBudgetPlan({ monthlyBudget: 30000, monthActual: 0, monthRange: horizon, effectiveDate: today, sprints: [] });
  check("Meta, Google e Consolidado compartilham os mesmos dias elegíveis (mesmo horizonte 01→21)", [meta.eligibleDaysCount, google.eligibleDaysCount, consolidado.eligibleDaysCount], [3, 3, 3]);
  check("saldo consolidado (R$30.000) é a soma dos saldos por canal (R$20.000 + R$10.000)", consolidado.remainingBudget, meta.remainingBudget + google.remainingBudget);
}

console.log(`\n${passed} verificações passaram.`);
