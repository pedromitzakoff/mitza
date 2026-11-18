/**
 * Testes do núcleo puro do alerta "Gasto acima ou abaixo do previsto"
 * (aba Alertas, pedido do usuário, seção 2.1) — referência diária resolvida
 * (`resolveDailySpendReference`), detecção (`detectSpendPaceAlert`) e a
 * máquina de estados de persistência (`reduceAlertEvaluation`, seção 3/5 do
 * pedido). Cobre explicitamente os cenários exigidos (seção 6 do pedido):
 * gasto excessivo, normalização, persistência após acompanhamento, dados
 * incompletos, prevenção de alertas duplicados (uma linha reaproveitada).
 *
 * Rodar: npx tsx scripts/test-koff-alertas-gasto-previsto.ts
 */
import assert from "node:assert/strict";
import { resolveDailySpendReference, detectSpendPaceAlert } from "../src/lib/alerts/spend-pace-detection";
import { reduceAlertEvaluation } from "../src/lib/alerts/alert-persistence";
import { DEFAULT_SPEND_PACE_THRESHOLDS } from "../src/lib/alerts/spend-pace-thresholds";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// ---------------------------------------------------------------------------
console.log("\nA — resolveDailySpendReference: orçamento mensal > histórico > sem dados\n");
{
  const fromBudget = resolveDailySpendReference({ monthlyBudget: 3000, daysInMonth: 30, historicalDailySpends: [100, 100] });
  ok("orçamento mensal presente -> referência = orçamento ÷ dias do mês (nunca 30 fixo)", fromBudget.dailyReference === 100);
  ok("referência vinda de orçamento mensal é SEMPRE marcada como estimativa", fromBudget.isEstimate === true);
  ok("fonte identificada como 'monthly_budget'", fromBudget.source === "monthly_budget");

  const fromHistory = resolveDailySpendReference({ monthlyBudget: null, daysInMonth: 30, historicalDailySpends: [280, 320, 300] });
  ok("sem orçamento mensal -> cai pro histórico (média)", fromHistory.dailyReference === 300);
  ok("referência vinda do histórico também é marcada como estimativa", fromHistory.isEstimate === true);
  ok("fonte identificada como 'historical_average'", fromHistory.source === "historical_average");

  const budgetZero = resolveDailySpendReference({ monthlyBudget: 0, daysInMonth: 30, historicalDailySpends: [300] });
  ok("orçamento mensal = 0 não conta como 'configurado' -> cai pro histórico", budgetZero.source === "historical_average");

  const noData = resolveDailySpendReference({ monthlyBudget: null, daysInMonth: 30, historicalDailySpends: [] });
  ok("sem orçamento E sem histórico -> null (dados insuficientes, nunca inventa referência)", noData.dailyReference === null);

  const allZeroHistory = resolveDailySpendReference({ monthlyBudget: null, daysInMonth: 30, historicalDailySpends: [0, 0, 0] });
  ok("histórico só de dias com gasto zero -> null (conta nunca rodou de fato, não é referência utilizável)", allZeroHistory.dailyReference === null);
}

// ---------------------------------------------------------------------------
console.log("\nB — detectSpendPaceAlert: dia completo (ontem) — acima/abaixo/dentro\n");
{
  const reference = { dailyReference: 300, isEstimate: true, source: "monthly_budget" as const };

  const critical = detectSpendPaceAlert({ actualSpend: 700, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: reference, isPeriodInProgress: false });
  ok("R$700 vs referência R$300 (ratio 2.33) -> crítico (acima de 60%)", critical?.severity === "critico");
  ok("direção registrada como 'acima'", critical?.detail.direction === "acima");
  ok("diffPercent calculado corretamente (~133%)", Math.round(critical!.diffPercent) === 133);

  const attention = detectSpendPaceAlert({ actualSpend: 420, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: reference, isPeriodInProgress: false });
  ok("R$420 vs R$300 (ratio 1.40, entre 30% e 60%) -> atenção", attention?.severity === "atencao" && attention?.detail.direction === "acima");

  const within = detectSpendPaceAlert({ actualSpend: 350, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: reference, isPeriodInProgress: false });
  ok("R$350 vs R$300 (ratio 1.17, dentro da margem) -> nenhum alerta", within === null);

  const under = detectSpendPaceAlert({ actualSpend: 100, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: reference, isPeriodInProgress: false });
  ok("R$100 vs R$300 (ratio 0.33, abaixo de 40% do previsto) -> atenção, direção 'abaixo'", under?.severity === "atencao" && under?.detail.direction === "abaixo");

  const underButAboveFloor = detectSpendPaceAlert({ actualSpend: 150, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: reference, isPeriodInProgress: false });
  ok("R$150 vs R$300 (ratio 0.50, acima do piso de 40%) -> nenhum alerta", underButAboveFloor === null);
}

// ---------------------------------------------------------------------------
console.log("\nC — detectSpendPaceAlert: diferença mínima em reais evita ruído\n");
{
  const tinyReference = { dailyReference: 10, isEstimate: true, source: "monthly_budget" as const };
  const tinyOverspend = detectSpendPaceAlert({ actualSpend: 25, periodStart: "2026-11-09", periodEnd: "2026-11-09", dailyReference: tinyReference, isPeriodInProgress: false });
  ok(
    "150% acima do previsto, mas diferença de só R$15 (< mínimo configurável de R$50) -> nenhum alerta",
    tinyOverspend === null,
  );

  const customThresholds = { ...DEFAULT_SPEND_PACE_THRESHOLDS, minDiffReais: 10 };
  const sameCaseLowerFloor = detectSpendPaceAlert({
    actualSpend: 25,
    periodStart: "2026-11-09",
    periodEnd: "2026-11-09",
    dailyReference: tinyReference,
    isPeriodInProgress: false,
    thresholds: customThresholds,
  });
  ok("o mesmo caso com o piso configurado pra R$10 já dispara (thresholds são parâmetros, não hardcoded)", sameCaseLowerFloor !== null);
}

// ---------------------------------------------------------------------------
console.log("\nD — detectSpendPaceAlert: 'hoje em andamento' nunca emite alerta de 'abaixo'\n");
{
  const reference = { dailyReference: 300, isEstimate: true, source: "monthly_budget" as const };

  const partialDayLow = detectSpendPaceAlert({ actualSpend: 50, periodStart: "2026-11-17", periodEnd: "2026-11-17", dailyReference: reference, isPeriodInProgress: true });
  ok("gasto parcial baixo (10h da manhã, R$50 de R$300) num dia em andamento -> NUNCA 'abaixo' (dia incompleto)", partialDayLow === null);

  const partialDayOverspend = detectSpendPaceAlert({ actualSpend: 700, periodStart: "2026-11-17", periodEnd: "2026-11-17", dailyReference: reference, isPeriodInProgress: true });
  ok("mas excesso significativo num dia em andamento CONTINUA alertando (seção 4: 'já ultrapassou significativamente')", partialDayOverspend?.severity === "critico");
  ok("detalhe registra isPeriodInProgress = true", partialDayOverspend?.detail.isPeriodInProgress === true);
}

// ---------------------------------------------------------------------------
console.log("\nE — reduceAlertEvaluation: máquina de estados (seção 3/5 do pedido)\n");
{
  const noExistingNoCandidate = reduceAlertEvaluation(null, false);
  ok("sem alerta existente e sem candidato -> ignore (nunca cria linha pra uma condição que não existe)", noExistingNoCandidate.action === "ignore");

  const create = reduceAlertEvaluation(null, true);
  ok("sem alerta existente, candidato presente -> create, status 'precisa_atencao', evento 'criado'", create.action === "create" && create.nextStatus === "precisa_atencao" && create.eventType === "criado");
  ok("1ª detecção sempre reseta first_detected_at", create.action !== "ignore" && create.resetFirstDetected === true);

  const stillAttention = reduceAlertEvaluation({ status: "precisa_atencao" }, true);
  ok("'precisa_atencao' + condição ainda presente -> update, status continua 'precisa_atencao', evento 'avaliado'", stillAttention.action === "update" && stillAttention.nextStatus === "precisa_atencao" && stillAttention.eventType === "avaliado");
  ok("reavaliação de rotina NUNCA reseta first_detected_at (mesma ocorrência contínua)", stillAttention.action !== "ignore" && stillAttention.resetFirstDetected === false);

  const normalizedFromAttention = reduceAlertEvaluation({ status: "precisa_atencao" }, false);
  ok(
    "'precisa_atencao' + condição normalizou -> resolve automaticamente, evento 'resolvido_auto' (cenário: gasto normalizou)",
    normalizedFromAttention.action === "resolve" && normalizedFromAttention.nextStatus === "resolvido" && normalizedFromAttention.eventType === "resolvido_auto",
  );

  const normalizedFromFollowUp = reduceAlertEvaluation({ status: "acompanhamento" }, false);
  ok(
    "'acompanhamento' + condição normalizou -> resolve automaticamente, mesmo evento 'resolvido_auto' (cenário do pedido: 'se o gasto normalizar, resolver automaticamente')",
    normalizedFromFollowUp.action === "resolve" && normalizedFromFollowUp.eventType === "resolvido_auto",
  );

  const persistedFromFollowUp = reduceAlertEvaluation({ status: "acompanhamento" }, true);
  ok(
    "'acompanhamento' + condição PERSISTE -> volta pra 'precisa_atencao', evento 'retomado_atencao' (cenário INL: 'se continuar fora do padrão, devolver para precisa de atenção')",
    persistedFromFollowUp.action === "update" && persistedFromFollowUp.nextStatus === "precisa_atencao" && persistedFromFollowUp.eventType === "retomado_atencao",
  );
  ok("retomar atenção depois do acompanhamento NUNCA reseta first_detected_at (preserva a duração real do problema)", persistedFromFollowUp.action !== "ignore" && persistedFromFollowUp.resetFirstDetected === false);

  const alreadyResolvedNoCandidate = reduceAlertEvaluation({ status: "resolvido" }, false);
  ok("'resolvido' + sem candidato -> ignore (nada a fazer, já está resolvido)", alreadyResolvedNoCandidate.action === "ignore");

  const reopened = reduceAlertEvaluation({ status: "resolvido" }, true);
  ok(
    "'resolvido' + condição reapareceu -> reabre a MESMA linha (nunca uma 2ª linha pro mesmo client+channel+type+period_kind), evento 'reaberto'",
    reopened.action === "update" && reopened.nextStatus === "precisa_atencao" && reopened.eventType === "reaberto",
  );
  ok("reabertura reseta first_detected_at (nova ocorrência, mesmo reaproveitando a linha)", reopened.action !== "ignore" && reopened.resetFirstDetected === true);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} verificações OK.\n`);
