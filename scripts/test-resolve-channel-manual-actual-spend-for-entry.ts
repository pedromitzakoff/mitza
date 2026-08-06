/**
 * Teste puro de `resolveChannelManualActualSpendForEntry`/`buildEditableInvestmentValues`
 * (lib/channel-spend.ts) — mesmo padrão sem framework de
 * scripts/test-resolve-manual-actual-spend.ts (roda via `tsx`). Cobre
 * especificamente a regra que garante que o primeiro lançamento multicanal
 * nunca apaga Meta silenciosamente: o campo Meta só nasce com o valor
 * legado quando NENHUM canal ainda tem override explícito.
 *
 * Rodar: npx tsx scripts/test-resolve-channel-manual-actual-spend-for-entry.ts
 */
import assert from "node:assert/strict";
import { resolveChannelManualActualSpendForEntry, buildEditableInvestmentValues } from "../src/lib/channel-spend";
import type { SprintChannelSpendOverrideRow } from "../src/lib/channel-spend";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function row(channel: "meta" | "google", manualActualSpend: number | null): SprintChannelSpendOverrideRow {
  return { sprintId: "sprint-1", channel, spend_source: "manual", manual_actual_spend: manualActualSpend };
}

console.log("resolveChannelManualActualSpendForEntry\n");

// --- Regressão: cliente Meta existente, nunca tocou sprint_channel_spend ---
check(
  "meta, sem nenhuma linha, legado presente -> pré-preenche com o legado (migração automática)",
  resolveChannelManualActualSpendForEntry("meta", 500, []),
  500,
);
check("meta, sem nenhuma linha, legado null -> null (nunca 0 fabricado)", resolveChannelManualActualSpendForEntry("meta", null, []), null);
check(
  "google, sem nenhuma linha -> sempre null (legado nunca pertenceu ao Google)",
  resolveChannelManualActualSpendForEntry("google", 500, []),
  null,
);

// --- Canal com override explícito próprio ---
check(
  "meta, já tem override explícito próprio -> usa o override, ignora o legado",
  resolveChannelManualActualSpendForEntry("meta", 999, [row("meta", 300)]),
  300,
);
check(
  "google, já tem override explícito próprio -> usa o override",
  resolveChannelManualActualSpendForEntry("google", null, [row("google", 150)]),
  150,
);

// --- Regra crítica (Stage 1 — resolveManualActualSpend): o legado só conta
// como fallback quando NENHUMA linha de canal existe pra sprint. Assim que
// QUALQUER canal ganha override explícito, o legado sai do jogo pro
// consolidado inteiro — por isso o formulário SEMPRE reenvia o campo Meta
// já preenchido no mesmo submit que introduz Google (`SprintPerformanceFormFields`
// + `MoneyInput`), migrando os dois juntos numa única escrita atômica em vez
// de depender deste fallback pra proteger Meta depois que Google já existe.
check(
  "google já ganhou override explícito, meta ainda sem override próprio -> meta nasce vazio (não mais o legado — a migração já devia ter acontecido no mesmo submit que criou o override do Google)",
  resolveChannelManualActualSpendForEntry("meta", 500, [row("google", 150)]),
  null,
);
check(
  "google ganhou override explícito -> google usa o próprio override",
  resolveChannelManualActualSpendForEntry("google", 500, [row("google", 150)]),
  150,
);

// --- Depois que Meta também ganha override explícito, o legado não conta mais ---
check(
  "meta e google já com override explícito -> meta usa o próprio override, nunca mais o legado",
  resolveChannelManualActualSpendForEntry("meta", 999, [row("meta", 700), row("google", 150)]),
  700,
);

// --- Linha existente com valor null não conta como "override explícito" ---
check(
  "meta, linha existe mas com manual_actual_spend null -> ainda cai pro legado (existência não basta)",
  resolveChannelManualActualSpendForEntry("meta", 500, [row("meta", null)]),
  500,
);
check(
  "google, só linha null existente -> null (nunca 0 fabricado pro canal sem lançamento)",
  resolveChannelManualActualSpendForEntry("google", 500, [row("google", null)]),
  null,
);

console.log("\nbuildEditableInvestmentValues\n");

check(
  "monta os dois canais de uma vez, mesma regra por canal",
  buildEditableInvestmentValues(["meta", "google"], 500, []),
  [
    { channel: "meta", currentAmount: 500 },
    { channel: "google", currentAmount: null },
  ],
);
check(
  "sem nenhum override, legado null -> os dois nascem vazios",
  buildEditableInvestmentValues(["meta", "google"], null, []),
  [
    { channel: "meta", currentAmount: null },
    { channel: "google", currentAmount: null },
  ],
);

console.log(`\n${passed} verificações passaram.`);
