/**
 * Testes do saldo da conta Meta no cabeçalho do Cockpit (pedido explícito
 * do usuário: "puxe o saldo e quero que tenha um indicador no topo da
 * tela... Pode trazer somente para as contas de pré-pago. As que não
 * forem coloca tipo PÓS-PAGO no lugar do saldo"). Reescrito 22/10/2026 —
 * achado real (cliente Helping Hand): o campo `balance` do nó da conta
 * NUNCA foi o saldo de verdade (a Graph API o documenta como "Bill amount
 * due" — valor a faturar — e na prática só reflete cupons/créditos
 * promocionais residuais). O "Fundos disponíveis" real (R$37.663,10, batendo
 * com o valor visto no Business Manager da Meta) só existe como texto em
 * `funding_source_details.display_string` — sem campo numérico equivalente.
 * Cobre:
 *  - `parseFundingSourceDisplayAmount` (`lib/meta-api-fetch.ts`): extrai o
 *    número de `display_string` em pt-BR e en-US, rejeita texto sem a moeda
 *    esperada, rejeita texto sem número reconhecível — nunca um valor
 *    fabricado.
 *  - `mapMetaAccountBalanceResponse`: conta pré-paga usa SEMPRE
 *    `funding_source_details`, nunca mais o antigo `balance`; conta
 *    pós-paga continua sem saldo nenhum (mesmo critério de sempre).
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
import { mapMetaAccountBalanceResponse, parseFundingSourceDisplayAmount } from "../src/lib/meta-api-fetch";
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

console.log("1 — parseFundingSourceDisplayAmount: extrai o número do texto formatado pela Meta\n");

check(
  "pt-BR real (Helping Hand, 22/10/2026): 'Saldo disponível (R$37.663,10 BRL)' -> 37663.10",
  parseFundingSourceDisplayAmount("Saldo disponível (R$37.663,10 BRL)", "BRL"),
  37663.1,
);
check("en-US: 'Available balance ($37,663.10 USD)' -> 37663.10", parseFundingSourceDisplayAmount("Available balance ($37,663.10 USD)", "USD"), 37663.1);
check("sem milhar: 'Saldo disponível (R$177,09 BRL)' -> 177.09", parseFundingSourceDisplayAmount("Saldo disponível (R$177,09 BRL)", "BRL"), 177.09);
check("zero real é dado, não ausência: 'Saldo disponível (R$0,00 BRL)' -> 0", parseFundingSourceDisplayAmount("Saldo disponível (R$0,00 BRL)", "BRL"), 0);
check("moeda esperada ausente no texto: null (nunca adivinha)", parseFundingSourceDisplayAmount("Saldo disponível (R$37.663,10 BRL)", "USD"), null);
check("texto indefinido: null", parseFundingSourceDisplayAmount(undefined, "BRL"), null);
check("texto sem número reconhecível: null", parseFundingSourceDisplayAmount("Saldo disponível (indisponível BRL)", "BRL"), null);

console.log("\n2 — mapMetaAccountBalanceResponse: conta pré-paga usa funding_source_details, nunca o antigo balance\n");

check(
  "conta pré-paga BRL: lê funding_source_details.display_string",
  mapMetaAccountBalanceResponse({
    is_prepay_account: true,
    currency: "BRL",
    funding_source_details: { display_string: "Saldo disponível (R$37.663,10 BRL)" },
  }),
  { isPrepay: true, balance: 37663.1, currency: "BRL" },
);
check(
  "conta pré-paga sem funding_source_details: balance null (nunca fabricado), mas isPrepay/currency preservados",
  mapMetaAccountBalanceResponse({ is_prepay_account: true, currency: "BRL" }),
  { isPrepay: true, balance: null, currency: "BRL" },
);

console.log("\n3 — conta PÓS-PAGA: balance SEMPRE null — nunca mostra o 'valor a faturar' como se fosse saldo\n");

check(
  "conta pós-paga: balance null mesmo com funding_source_details presente",
  mapMetaAccountBalanceResponse({
    is_prepay_account: false,
    currency: "USD",
    funding_source_details: { display_string: "Available balance ($9,999.00 USD)" },
  }),
  { isPrepay: false, balance: null, currency: "USD" },
);

console.log("\n4 — resposta incompleta: null, nunca um valor fabricado\n");

check("sem is_prepay_account: null", mapMetaAccountBalanceResponse({ currency: "BRL" }), null);
check("sem currency: null", mapMetaAccountBalanceResponse({ is_prepay_account: true }), null);

console.log("\n5 — formatCurrencyInCurrency: usa a moeda da PRÓPRIA conta, nunca assume BRL\n");

ok("BRL mostra R$", formatCurrencyInCurrency(1234.56, "BRL").includes("R$"));
ok("USD mostra US$ (nunca R$)", formatCurrencyInCurrency(1234.56, "USD").includes("US$") && !formatCurrencyInCurrency(1234.56, "USD").includes("R$"));
ok("formatCurrency (uso geral da MITZA) continua sempre BRL, intocado", formatCurrency(1234.56).includes("R$"));

console.log("\n6 — Checagem estrutural do indicador no cabeçalho (cockpit-ad-account-balance.tsx)\n");

const balanceComponentSource = loadSource("src", "app", "clients", "cockpit-ad-account-balance.tsx");
const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const dashboardDataSource = loadSource("src", "lib", "meta-ads-dashboard", "dashboard-data.ts");

ok("status !== 'ok' retorna null — nenhum indicador de erro no cabeçalho (silencioso, mesmo critério do antigo link 'Saldo')", balanceComponentSource.includes('if (snapshot.status !== "ok") return null;'));
ok("conta pós-paga mostra o rótulo 'Pós-pago', nunca um número", balanceComponentSource.includes("Pós-pago") && balanceComponentSource.includes("!snapshot.isPrepay"));
ok("conta pré-paga usa formatCurrencyInCurrency (moeda da própria conta), nunca formatCurrency (sempre BRL)", balanceComponentSource.includes("formatCurrencyInCurrency(snapshot.balance, snapshot.currency)"));
ok("page.tsx renderiza o indicador no cabeçalho, ao lado do DataFreshnessTimer (pedido: 'no topo da tela')", /<CockpitAdAccountBalance[\s\S]{0,120}<DataFreshnessTimer/.test(pageSource));
ok("saldo buscado em paralelo com o alcance de período — nenhuma chamada sequencial desnecessária", pageSource.includes("fetchAccountBalanceSnapshot(metaAdAccountId)") && /Promise\.all\(\[[\s\S]{0,120}fetchAccountBalanceSnapshot/.test(pageSource));
ok(
  "fetchAccountBalanceSnapshot trata balance null (display_string não interpretável) como indisponível — nunca 'R$ null'",
  dashboardDataSource.includes('if (row.balance === null) return { status: "unavailable", reason: "fetch_error" };'),
);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
