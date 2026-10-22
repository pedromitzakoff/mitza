/**
 * Testes do saldo da conta Meta no cabeçalho do Cockpit (pedido explícito
 * do usuário: "puxe o saldo e quero que tenha um indicador no topo da
 * tela... Pode trazer somente para as contas de pré-pago. As que não
 * forem coloca tipo PÓS-PAGO no lugar do saldo"). Cobre:
 *  - `mapMetaAccountBalanceResponse` (`lib/meta-api-fetch.ts`): núcleo puro
 *    que converte a resposta bruta do nó da conta — conta pré-paga nunca
 *    perde o saldo (convertido de centavos pra unidade principal da
 *    moeda); conta pós-paga NUNCA carrega `balance` (pedido explícito:
 *    `balance` da Graph API, pra conta pós-paga, é valor A FATURAR, não
 *    saldo disponível — mostrar isso como "saldo" seria enganoso).
 *  - `formatCurrencyInCurrency` (`lib/format.ts`): formata na moeda da
 *    PRÓPRIA conta, nunca assume BRL (distinto de `formatCurrency`).
 *  - Checagem estrutural do componente do cabeçalho
 *    (`cockpit-ad-account-balance.tsx`): nunca mostra número pra conta
 *    pós-paga, nunca mostra nada quando indisponível (silencioso, mesmo
 *    critério do antigo link externo "Saldo").
 *
 * Rodar: npx tsx scripts/test-meta-account-balance.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapMetaAccountBalanceResponse } from "../src/lib/meta-api-fetch";
import { formatCurrencyInCurrency, formatCurrency } from "../src/lib/format";

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
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

console.log("1 — mapMetaAccountBalanceResponse: conta pré-paga preserva saldo (convertido de centavos)\n");

check(
  "conta pré-paga BRL: balance '123456' (centavos) vira 1234.56",
  mapMetaAccountBalanceResponse({ balance: "123456", is_prepay_account: true, currency: "BRL" }),
  { isPrepay: true, balance: 1234.56, currency: "BRL" },
);
check(
  "conta pré-paga com saldo zerado: 0, nunca null (zero real é dado, não ausência)",
  mapMetaAccountBalanceResponse({ balance: "0", is_prepay_account: true, currency: "BRL" }),
  { isPrepay: true, balance: 0, currency: "BRL" },
);

console.log("\n2 — conta PÓS-PAGA: balance SEMPRE null — nunca mostra o 'valor a faturar' como se fosse saldo\n");

check(
  "conta pós-paga: balance null mesmo que a resposta bruta traga um número",
  mapMetaAccountBalanceResponse({ balance: "999900", is_prepay_account: false, currency: "USD" }),
  { isPrepay: false, balance: null, currency: "USD" },
);

console.log("\n3 — resposta incompleta: null, nunca um valor fabricado\n");

check("sem is_prepay_account: null", mapMetaAccountBalanceResponse({ balance: "100", currency: "BRL" }), null);
check("sem currency: null", mapMetaAccountBalanceResponse({ balance: "100", is_prepay_account: true }), null);

console.log("\n4 — formatCurrencyInCurrency: usa a moeda da PRÓPRIA conta, nunca assume BRL\n");

ok("BRL mostra R$", formatCurrencyInCurrency(1234.56, "BRL").includes("R$"));
ok("USD mostra US$ (nunca R$)", formatCurrencyInCurrency(1234.56, "USD").includes("US$") && !formatCurrencyInCurrency(1234.56, "USD").includes("R$"));
ok("formatCurrency (uso geral da MITZA) continua sempre BRL, intocado", formatCurrency(1234.56).includes("R$"));

console.log("\n5 — Checagem estrutural do indicador no cabeçalho (cockpit-ad-account-balance.tsx)\n");

const balanceComponentSource = loadSource("src", "app", "clients", "cockpit-ad-account-balance.tsx");
const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

ok("status !== 'ok' retorna null — nenhum indicador de erro no cabeçalho (silencioso, mesmo critério do antigo link 'Saldo')", balanceComponentSource.includes('if (snapshot.status !== "ok") return null;'));
ok("conta pós-paga mostra o rótulo 'Pós-pago', nunca um número", balanceComponentSource.includes("Pós-pago") && balanceComponentSource.includes("!snapshot.isPrepay"));
ok("conta pré-paga usa formatCurrencyInCurrency (moeda da própria conta), nunca formatCurrency (sempre BRL)", balanceComponentSource.includes("formatCurrencyInCurrency(snapshot.balance, snapshot.currency)"));
ok("page.tsx renderiza o indicador no cabeçalho, ao lado do DataFreshnessTimer (pedido: 'no topo da tela')", /<CockpitAdAccountBalance[\s\S]{0,120}<DataFreshnessTimer/.test(pageSource));
ok("saldo buscado em paralelo com o alcance de período — nenhuma chamada sequencial desnecessária", pageSource.includes("fetchAccountBalanceSnapshot(metaAdAccountId)") && /Promise\.all\(\[[\s\S]{0,120}fetchAccountBalanceSnapshot/.test(pageSource));

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
