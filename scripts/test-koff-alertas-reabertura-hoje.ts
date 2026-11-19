/**
 * Achado real do usuário ("os alertas estão se repetindo toda vez que são
 * atualizados, eles voltam pra precisa de atenção... já corrigi alguns e
 * eles voltaram") — investigado até a causa raiz: um alerta "Dado parcial"
 * (`period_kind: "in_progress"`, hoje) compara o gasto ACUMULADO de hoje
 * com uma referência fixa pro dia inteiro (`detectSpendPaceAlert`) — como
 * o acumulado só cresce ao longo do dia, uma vez "acima" ele permanece
 * "acima" até a virada do dia, por construção. Marcar um alerta
 * `in_progress` como "Em acompanhamento"/"Resolvido" nunca "pegava" de
 * verdade: a próxima avaliação automática (a cada ~30min,
 * `reduceAlertEvaluation`) encontrava a MESMA condição ainda presente e
 * reabria pra "precisa_atencao" (`reaberto`/`retomado_atencao`).
 *
 * Primeira correção (intermediária, já superada): esconder a ação manual
 * só pro `in_progress`, mantendo o monitor gerando o alerta. O usuário
 * pediu mais: "eu quero um alerta sempre sobre ontem então, já que hoje o
 * dia ainda está acontecendo" — o monitor "hoje em andamento" foi
 * DESATIVADO inteiramente (`evaluate-spend-pace.ts` não gera mais
 * `in_progress`; `alerts-data.ts` filtra `period_kind = "full_day"` em
 * toda leitura, inclusive o contador do nav, pra linhas antigas já
 * existentes no banco também sumirem sem precisar de uma migration de
 * limpeza). `actions.ts` mantém a rejeição de `in_progress` como defesa em
 * profundidade — nunca deveria ser alcançável pela UI, mas uma linha
 * antiga ainda existe no banco até alguém limpar.
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
console.log("\nA — spend-pace-detection.ts: a referência de 'in_progress' é FIXA pro dia inteiro (documenta por que a condição nunca 'desarmava' sozinha no mesmo dia)\n");
{
  const detectionSource = loadSource("src", "lib", "alerts", "spend-pace-detection.ts");
  ok(
    "dailyReference vem só de orçamento mensal ÷ dias do mês OU histórico — nunca ajustado por 'quanto do dia já passou'",
    detectionSource.includes("monthlyBudget / daysInMonth") && !detectionSource.includes("daysElapsed") && !detectionSource.includes("hoursElapsed"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — alert-persistence.ts: a máquina de estados reabre qualquer alerta cuja condição ainda esteja presente — confirma por que 'resolver' um in_progress nunca pegava\n");
{
  const persistenceSource = loadSource("src", "lib", "alerts", "alert-persistence.ts");
  ok(
    "'resolvido' + condição ainda presente -> reabre pra 'precisa_atencao' (evento 'reaberto')",
    persistenceSource.includes('existing.status === "resolvido"') && persistenceSource.includes('eventType: "reaberto"'),
  );
  ok("'acompanhamento' + condição ainda presente -> volta pra 'precisa_atencao' (evento 'retomado_atencao')", persistenceSource.includes('eventType: "retomado_atencao"'));
}

// ---------------------------------------------------------------------------
console.log("\nC — evaluate-spend-pace.ts: o monitor 'hoje em andamento' (in_progress) foi DESATIVADO, não só escondido\n");
{
  const genSource = loadSource("src", "lib", "alerts", "evaluate-spend-pace.ts");
  ok(
    "nenhuma avaliação com periodKind 'in_progress'/isPeriodInProgress true — só 'full_day' (ontem) é gerado",
    !genSource.includes('periodKind: "in_progress"') && !genSource.includes("isPeriodInProgress: true"),
  );
  ok("pedido do usuário documentado no comentário ('alerta sempre sobre ontem')", genSource.includes("sempre sobre ontem"));
}

// ---------------------------------------------------------------------------
console.log("\nD — alerts-data.ts: toda leitura (lista + contador do nav) filtra period_kind = 'full_day' — linhas antigas de in_progress somem sem precisar de migration\n");
{
  const dataSource = loadSource("src", "app", "alerts", "alerts-data.ts");
  ok("loadAlertList filtra full_day na query principal", dataSource.includes('.eq("period_kind", "full_day")'));
  ok(
    "o contador 'precisa de atenção' (usado no badge do nav e no cabeçalho da tela) também filtra full_day — nunca conta uma linha in_progress órfã",
    (dataSource.match(/\.eq\("period_kind", "full_day"\)/g) ?? []).length === 3,
  );
}

// ---------------------------------------------------------------------------
console.log("\nE — alert-card.tsx: sem badge 'Dado parcial', sem branch condicional — todo alerta exibido sempre tem as 2 ações manuais disponíveis\n");
{
  const cardSource = loadSource("src", "app", "alerts", "alert-card.tsx");
  ok(
    "'Dado parcial'/isToday removidos como badge/variável de código (nunca mais alcançáveis — todo alerta é full_day agora; o termo só sobrevive em comentário explicando a remoção)",
    !cardSource.includes("const isToday") && !/<span[^>]*>\s*Dado parcial\s*<\/span>/.test(cardSource),
  );
  ok("AlertActionButtons renderiza incondicionalmente (nunca mais atrás de um if periodKind)", /\n\s*<AlertActionButtons alertId=\{alert\.id\} status=\{alert\.status\} \/>\n\s*<\/div>/.test(cardSource));
}

// ---------------------------------------------------------------------------
console.log("\nF — actions.ts: a rejeição de in_progress continua como defesa em profundidade (linhas antigas ainda existem no banco)\n");
{
  const actionsSource = loadSource("src", "app", "alerts", "actions.ts");
  ok(
    "followUpAlertTomorrowAction/resolveAlertManuallyAction checam period_kind ANTES de qualquer escrita",
    actionsSource.includes("rejectInProgressAction(alert)") && (actionsSource.match(/rejectInProgressAction\(alert\)/g) ?? []).length === 2,
  );
}

console.log(`\n${passed} verificações OK.\n`);
