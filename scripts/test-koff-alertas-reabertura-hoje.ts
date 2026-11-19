/**
 * Achado real do usuário ("os alertas estão se repetindo toda vez que são
 * atualizados, eles voltam pra precisa de atenção... já corrigi alguns e
 * eles voltaram"): um alerta "Dado parcial" (`period_kind: "in_progress"`,
 * hoje) compara o gasto ACUMULADO de hoje com uma referência fixa pro dia
 * inteiro (`detectSpendPaceAlert`) — como o acumulado só cresce ao longo
 * do dia, uma vez "acima" ele permanece "acima" até a virada do dia, por
 * construção. Isso significa que marcar um alerta `in_progress` como
 * "Em acompanhamento"/"Resolvido" nunca "pega" de verdade: a próxima
 * avaliação automática (a cada ~30min, `reduceAlertEvaluation`) encontra a
 * MESMA condição ainda presente e reabre pra "precisa_atencao"
 * (`reaberto`/`retomado_atencao`) — dando a falsa impressão de um bug,
 * quando na verdade é o comportamento JÁ DOCUMENTADO desde a Etapa Alertas
 * original pro monitor "hoje em andamento" ("nunca acumula estado
 * multi-dia, só reflete o instante atual"). A correção: a UI nunca oferece
 * ação manual pra um alerta `in_progress` (ela prometeria algo que o
 * sistema não entrega), e as Server Actions rejeitam a chamada também
 * (defesa em profundidade, não só escondido na UI).
 *
 * Rodar: npx tsx scripts/test-koff-alertas-reabertura-hoje.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
console.log("\nA — spend-pace-detection.ts: a referência de 'in_progress' é FIXA pro dia inteiro, nunca recalculada pela hora do dia\n");
{
  const detectionSource = loadSource("src", "lib", "alerts", "spend-pace-detection.ts");
  ok(
    "dailyReference vem só de orçamento mensal ÷ dias do mês OU histórico — nunca ajustado por 'quanto do dia já passou' (confirma por que o acumulado de hoje só CRESCE em relação à referência)",
    detectionSource.includes("monthlyBudget / daysInMonth") && !detectionSource.includes("daysElapsed") && !detectionSource.includes("hoursElapsed"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — alert-persistence.ts: a máquina de estados reabre qualquer alerta cuja condição ainda esteja presente — confirma por que 'resolver' um in_progress nunca pega\n");
{
  const persistenceSource = loadSource("src", "lib", "alerts", "alert-persistence.ts");
  ok(
    "'resolvido' + condição ainda presente -> reabre pra 'precisa_atencao' (evento 'reaberto')",
    persistenceSource.includes('existing.status === "resolvido"') && persistenceSource.includes('eventType: "reaberto"'),
  );
  ok(
    "'acompanhamento' + condição ainda presente -> volta pra 'precisa_atencao' (evento 'retomado_atencao')",
    persistenceSource.includes('eventType: "retomado_atencao"'),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — alert-card.tsx: nenhuma ação manual oferecida pra alerta 'Dado parcial' (in_progress) — nunca promete uma resolução que não acontece\n");
{
  const cardSource = loadSource("src", "app", "alerts", "alert-card.tsx");
  ok(
    "AlertActionButtons só renderiza quando NÃO é 'hoje' (isToday) — o card de hoje mostra uma explicação no lugar",
    /isToday \? \([\s\S]*?\) : \([\s\S]*?<AlertActionButtons/.test(cardSource),
  );
  ok("explica por que não há ação manual pro alerta de hoje (nunca um botão morto que parece funcionar e não funciona)", cardSource.includes("Não há ação manual pra ele enquanto o dia não termina"));
}

// ---------------------------------------------------------------------------
console.log("\nD — actions.ts: as Server Actions também rejeitam ação manual num alerta in_progress (defesa em profundidade, não só escondido na UI)\n");
{
  const actionsSource = loadSource("src", "app", "alerts", "actions.ts");
  ok(
    "followUpAlertTomorrowAction/resolveAlertManuallyAction checam period_kind ANTES de qualquer escrita",
    actionsSource.includes("rejectInProgressAction(alert)") && (actionsSource.match(/rejectInProgressAction\(alert\)/g) ?? []).length === 2,
  );
  ok("rejectInProgressAction só bloqueia 'in_progress' — 'full_day' (ontem) continua com as 2 ações normalmente", actionsSource.includes('if (alert.period_kind !== "in_progress") return null;'));
}

console.log(`\n${passed} verificações OK.\n`);
