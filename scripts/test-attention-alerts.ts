/**
 * Testes do alerta de investimento em `buildAttentionAlerts`
 * (lib/attention-alerts.ts) — auditoria "comportamento após
 * planningEndDate" (Etapa "Horizonte de Planejamento"): um desvio
 * "abaixo"/"acima" do esperado num período JÁ ENCERRADO (mês civil ou
 * horizonte de evento) é resultado final, nunca um alerta "aja agora" —
 * `isPeriodClosed` (booleano genérico, nunca "isEvent") suprime o alerta de
 * investimento sem alterar nenhum outro alerta.
 *
 * Rodar: npx tsx scripts/test-attention-alerts.ts
 */
import assert from "node:assert/strict";
import { buildAttentionAlerts, type AttentionAlertsInput } from "../src/lib/attention-alerts";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const now = new Date("2026-08-25T12:00:00Z");

const BASE_INPUT: Omit<AttentionAlertsInput, "monthStatus" | "isPeriodClosed"> = {
  overdueTasksCount: 0,
  optimizationRecentlyDone: true,
  lastSyncedAt: now.toISOString(),
  currentSprintPlannedSpend: null,
  currentSprintTaskCount: 0,
  currentSprintUnassignedCount: 0,
  clientInactivityBusinessDays: 0,
  now,
};

function hasInvestmentAlert(input: AttentionAlertsInput): boolean {
  return buildAttentionAlerts(input).some((a) => a.kind === "investimento");
}

console.log("buildAttentionAlerts — alerta de investimento x período encerrado\n");

check(
  "período ABERTO, abaixo do esperado -> gera alerta (comportamento de sempre)",
  hasInvestmentAlert({ ...BASE_INPUT, monthStatus: "abaixo", isPeriodClosed: false }),
  true,
);

check(
  "período ABERTO, acima do esperado -> gera alerta (comportamento de sempre)",
  hasInvestmentAlert({ ...BASE_INPUT, monthStatus: "acima", isPeriodClosed: false }),
  true,
);

check(
  "período ENCERRADO (mês civil OU horizonte de evento), abaixo do esperado -> NUNCA gera alerta 'aja agora'",
  hasInvestmentAlert({ ...BASE_INPUT, monthStatus: "abaixo", isPeriodClosed: true }),
  false,
);

check(
  "período ENCERRADO, acima do esperado -> também nunca gera alerta",
  hasInvestmentAlert({ ...BASE_INPUT, monthStatus: "acima", isPeriodClosed: true }),
  false,
);

check(
  "período ENCERRADO, dentro do esperado -> nunca gerou alerta mesmo antes (sem mudança)",
  hasInvestmentAlert({ ...BASE_INPUT, monthStatus: "dentro", isPeriodClosed: true }),
  false,
);

check(
  "período encerrado NÃO afeta outros alertas (tarefa atrasada continua aparecendo)",
  buildAttentionAlerts({ ...BASE_INPUT, monthStatus: "abaixo", isPeriodClosed: true, overdueTasksCount: 2 }).some(
    (a) => a.kind === "tarefas_atrasadas",
  ),
  true,
);

console.log(`\n${passed} verificações passaram.`);
