/**
 * Teste puro de `resolveManualActualSpend` (lib/effective-spend.ts) — sem
 * framework de testes no projeto (nenhum vitest/jest configurado até esta
 * etapa), roda via `tsx` (já é devDependency, mesmo padrão de scripts/
 * sync-meta.ts) com asserts do Node. Cobre especificamente os casos de
 * regressão pedidos: cliente Meta existente (sem nenhuma linha de
 * `sprint_channel_spend`) precisa continuar exatamente como estava, e a
 * mera EXISTÊNCIA de linhas sem valor explícito nunca pode zerar o legado.
 *
 * Rodar: npx tsx scripts/test-resolve-manual-actual-spend.ts
 */
import assert from "node:assert/strict";
import { resolveManualActualSpend } from "../src/lib/effective-spend";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("resolveManualActualSpend\n");

// --- Regressão: cliente Meta existente, nunca tocou sprint_channel_spend ---
check("sem linhas de canal, legado presente -> retorna o legado (comportamento pré-existente)", resolveManualActualSpend(500, []), 500);
check("sem linhas de canal, legado null -> null (sem dado nenhum, nunca 0 fabricado)", resolveManualActualSpend(null, []), null);
check("sem linhas de canal, legado 0 -> 0 (zero explícito é um valor válido, não 'sem dado')", resolveManualActualSpend(0, []), 0);

// --- Regra pedida: existência de linha NÃO decide sozinha ---
check(
  "1 linha existe mas manual_actual_spend é null -> ainda usa o legado (não zera)",
  resolveManualActualSpend(500, [{ manual_actual_spend: null }]),
  500,
);
check(
  "várias linhas, todas com manual_actual_spend null -> ainda usa o legado",
  resolveManualActualSpend(500, [{ manual_actual_spend: null }, { manual_actual_spend: null }]),
  500,
);
check(
  "linhas todas null + legado também null -> null (nunca 0 fabricado)",
  resolveManualActualSpend(null, [{ manual_actual_spend: null }, { manual_actual_spend: null }]),
  null,
);

// --- Multicanal: pelo menos um valor explícito troca a fonte ---
check(
  "1 linha com valor explícito -> usa a soma dos canais, ignora o legado",
  resolveManualActualSpend(999, [{ manual_actual_spend: 300 }]),
  300,
);
check(
  "2 linhas (Meta + Google) com valor -> soma os dois, ignora o legado",
  resolveManualActualSpend(999, [{ manual_actual_spend: 300 }, { manual_actual_spend: 150 }]),
  450,
);
check(
  "mix: uma linha com valor, outra null -> soma só a explícita (null nunca vira 0 fabricado)",
  resolveManualActualSpend(999, [{ manual_actual_spend: 300 }, { manual_actual_spend: null }]),
  300,
);
check(
  "3 canais, um deles com valor 0 explícito -> soma inclui o 0 (0 é dado real, não ausência)",
  resolveManualActualSpend(999, [{ manual_actual_spend: 300 }, { manual_actual_spend: 0 }, { manual_actual_spend: null }]),
  300,
);

// --- Nunca soma legado + canais ---
check(
  "legado presente + canais com valor -> nunca soma os dois, só os canais valem",
  resolveManualActualSpend(1000, [{ manual_actual_spend: 50 }]),
  50,
);

console.log(`\n${passed} verificações passaram.`);
