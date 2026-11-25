/**
 * Testes do alerta "Saldo esgotando" (aba Alertas, pedido explícito do
 * usuário: "Coloque como alerta quando estivermos 3 dias antes do saldo
 * esgotar se manter o mesmo investimento do dia anterior").
 *
 * Cobre:
 *  A. Núcleo puro `detectBalanceDepletionAlert` — limiar de 3 dias,
 *     crítico vs atenção, sem ritmo de gasto nunca fabrica alerta.
 *  B. Wiring estrutural: enum do banco estendido, tipo marcado como
 *     implementado, rótulo existe, Server Action/avaliador usam a MESMA
 *     persistência compartilhada de `spend_pace` (nenhuma lógica
 *     duplicada), cron chama o novo avaliador, card tem bloco próprio
 *     (nunca reaproveita a frase "gastos/previstos").
 *  C. Só contas pré-pagas entram na avaliação (pós-pago nunca tem saldo
 *     pra projetar — achado real do usuário, 4 contas marcadas
 *     erroneamente como pós-pago no Meta).
 *
 * Rodar: npx tsx scripts/test-koff-alertas-saldo-esgotando.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectBalanceDepletionAlert } from "../src/lib/alerts/balance-depletion-detection";
import { DEFAULT_BALANCE_DEPLETION_THRESHOLDS } from "../src/lib/alerts/balance-depletion-thresholds";
import { IMPLEMENTED_ALERT_TYPES } from "../src/lib/alerts/alert-types";
import { ALERT_TYPE_LABEL } from "../src/lib/alerts/alert-labels";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

// ---------------------------------------------------------------------------
console.log("\nA — detectBalanceDepletionAlert: limiar de 5 dias, crítico (2 dias) vs atenção\n");
{
  const farFromDepletion = detectBalanceDepletionAlert({ balance: 1000, currency: "BRL", dailySpendYesterday: 50, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("saldo dura 20 dias no ritmo de ontem -> sem alerta (bem acima dos 5 dias)", farFromDepletion === null);

  const exactlyThree = detectBalanceDepletionAlert({ balance: 500, currency: "BRL", dailySpendYesterday: 100, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("exatamente 5 dias restantes -> dispara (pedido: '5 dias de acabar')", exactlyThree !== null);
  ok("5 dias restantes -> gravidade 'atencao' (acima do limiar crítico de 2 dias)", exactlyThree?.severity === "atencao");

  const oneDay = detectBalanceDepletionAlert({ balance: 90, currency: "BRL", dailySpendYesterday: 100, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("menos de 1 dia restante -> gravidade 'critico'", oneDay?.severity === "critico");

  const justOverThreshold = detectBalanceDepletionAlert({ balance: 501, currency: "BRL", dailySpendYesterday: 100, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("5,01 dias restantes (passou de 5) -> sem alerta ainda", justOverThreshold === null);

  ok("observedValue = saldo atual (nunca o gasto)", exactlyThree?.observedValue === 500);
  ok("referenceValue = gasto de ontem (pedido explícito: 'o mesmo investimento do dia anterior')", exactlyThree?.referenceValue === 100);
  ok("detail.daysRemaining guarda os dias restantes calculados", exactlyThree?.detail.daysRemaining === 5);
  ok("detail.currency propaga a moeda da conta", exactlyThree?.detail.currency === "BRL");
}

console.log("\nB — sem ritmo de gasto -> nunca divide por zero/fabrica projeção\n");
{
  const noYesterdaySpend = detectBalanceDepletionAlert({ balance: 50, currency: "BRL", dailySpendYesterday: 0, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("gasto de ontem = 0 -> null (nunca Infinity/NaN de dividir por zero)", noYesterdaySpend === null);

  const negativeSpend = detectBalanceDepletionAlert({ balance: 50, currency: "BRL", dailySpendYesterday: -10, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("gasto negativo (dado inconsistente) -> null, nunca um alerta fabricado", negativeSpend === null);
}

console.log("\nC — já esgotado (saldo zerado) -> ainda dispara, como 'crítico', nunca ignorado\n");
{
  const alreadyZero = detectBalanceDepletionAlert({ balance: 0, currency: "BRL", dailySpendYesterday: 50, periodStart: "2026-11-19", periodEnd: "2026-11-19" });
  ok("saldo já em R$0 -> dispara (0 dias restantes, bem abaixo do limiar)", alreadyZero !== null);
  ok("saldo zerado -> gravidade 'critico'", alreadyZero?.severity === "critico");
}

console.log("\nD — thresholds configuráveis (mesmo padrão de SpendPaceThresholds)\n");
{
  ok("limiar de atenção padrão é 5 dias (pedido: 'quando tiver a 5 dias de acabar')", DEFAULT_BALANCE_DEPLETION_THRESHOLDS.attentionDaysRemaining === 5);
  const customThresholds = { attentionDaysRemaining: 5, criticalDaysRemaining: 2 };
  const withCustom = detectBalanceDepletionAlert({ balance: 400, currency: "BRL", dailySpendYesterday: 100, periodStart: "2026-11-19", periodEnd: "2026-11-19", thresholds: customThresholds });
  ok("limiar customizado de 5 dias -> 4 dias restantes já dispara (não dispararia no padrão de 3)", withCustom !== null);
}

// ---------------------------------------------------------------------------
console.log("\nE — Wiring estrutural: enum, rótulo, tipo implementado\n");
{
  ok("'balance_depletion' está em IMPLEMENTED_ALERT_TYPES (aparece no filtro da tela)", IMPLEMENTED_ALERT_TYPES.includes("balance_depletion"));
  ok("tem rótulo em ALERT_TYPE_LABEL", typeof ALERT_TYPE_LABEL.balance_depletion === "string" && ALERT_TYPE_LABEL.balance_depletion.length > 0);

  const dbTypesSource = loadSource("src", "lib", "supabase", "database.types.ts");
  ok("AlertTypeDb inclui 'balance_depletion'", /AlertTypeDb\s*=[\s\S]{0,300}"balance_depletion"/.test(dbTypesSource));

  const migrationSource = loadSource("supabase", "alerts-balance-depletion.sql");
  ok("migração estende o CHECK constraint existente (drop + add), nunca recria a tabela", migrationSource.includes("drop constraint if exists alerts_alert_type_check") && migrationSource.includes("add constraint alerts_alert_type_check"));
  ok("migração preserva todos os valores antigos do enum (nenhum removido)", ["spend_pace", "no_delivery", "cost_per_result_increase", "spend_without_result", "sync_issue", "opportunity"].every((v) => migrationSource.includes(`'${v}'`)));
}

console.log("\nF — Avaliador reaproveita a MESMA persistência compartilhada de spend_pace/sync_issue (nenhuma lógica duplicada)\n");
{
  // `persist-alert-evaluation.ts` — módulo compartilhado já estabelecido
  // em produção pelo alerta "sync_issue" (Problema de sincronização,
  // mesclado nesta branch depois do alerta de saldo já ter sido
  // construído); `evaluate-balance-depletion.ts` foi atualizado pra usar
  // a MESMA fonte, em vez de manter uma cópia divergente.
  const persistenceSource = loadSource("src", "lib", "alerts", "persist-alert-evaluation.ts");
  ok("persistAlertEvaluation (parte impura) é compartilhada entre avaliadores", persistenceSource.includes("export async function persistAlertEvaluation("));

  const spendPaceSource = loadSource("src", "lib", "alerts", "evaluate-spend-pace.ts");
  ok("evaluate-spend-pace.ts importa a versão compartilhada (não tem mais sua própria cópia)", spendPaceSource.includes('import { persistAlertEvaluation } from "@/lib/alerts/persist-alert-evaluation";') && !spendPaceSource.includes("async function persistAlertEvaluation("));

  const balanceEvalSource = loadSource("src", "lib", "alerts", "evaluate-balance-depletion.ts");
  ok("evaluate-balance-depletion.ts usa a MESMA função compartilhada", balanceEvalSource.includes('import { persistAlertEvaluation } from "@/lib/alerts/persist-alert-evaluation";'));
  ok(
    "só avalia conta PRÉ-PAGA (nunca pós-paga — achado real do usuário: Meta reporta algumas contas PIX como pós-pago)",
    balanceEvalSource.includes("!snapshot.isPrepay"),
  );
  ok(
    "pula clientes já avaliados HOJE (evita re-chamar a Graph API a cada tick do cron de 30min)",
    balanceEvalSource.includes("skippedAlreadyEvaluatedToday") && balanceEvalSource.includes("lastEvaluatedTodayByClientId.has(clientId)"),
  );
  ok("usa o gasto de ONTEM como ritmo (pedido explícito: 'investimento do dia anterior')", balanceEvalSource.includes('.eq("date", yesterday)'));

  const cronSource = loadSource("src", "app", "api", "cron", "evaluate-alerts", "route.ts");
  ok("cron de avaliação chama o novo avaliador", cronSource.includes("evaluateBalanceDepletionAlerts()"));
}

console.log("\nG — Card: bloco de exibição próprio (nunca reaproveita a frase 'gastos/previstos' de spend_pace)\n");
{
  const cardSource = loadSource("src", "app", "alerts", "alert-card.tsx");
  ok("hasBalanceDepletion é calculado separadamente de hasAmounts", cardSource.includes("hasBalanceDepletion") && cardSource.includes('alert.alertType === "balance_depletion"'));
  ok("hasAmounts (bloco genérico 'gastos/previstos') exclui explicitamente balance_depletion", /hasAmounts\s*=\s*alert\.alertType !== "balance_depletion"/.test(cardSource));
  ok("bloco próprio mostra Saldo/Ritmo/dias restantes", cardSource.includes("Saldo:") && cardSource.includes("Ritmo:") && cardSource.includes("dia(s) restantes"));
}

console.log(`\n${passed} verificações OK.\n`);
