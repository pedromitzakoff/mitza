/**
 * Testes da Etapa 2.4.1 (KOFF Analytics Fase 2 — Estabilização). Cobre:
 *  - `requireQueryToleratingMissingColumn` (`lib/require-query.ts`): a
 *    salvaguarda que permite o Dashboard Meta Ads (e o Relatório de
 *    Performance, que reaproveita as mesmas 3 funções de leitura) continuar
 *    funcionando mesmo ANTES de `supabase/meta-ads-link-clicks.sql` rodar —
 *    sem ela, selecionar `link_clicks` contra um banco sem essa coluna
 *    derrubaria a tela inteira (mesma causa raiz do incidente da Árvore
 *    Viva 1.0, documentado em `lib/require-query.ts`).
 *
 * Rodar: npx tsx scripts/test-meta-ads-stabilization.ts
 */
import assert from "node:assert/strict";
import { requireQueryToleratingMissingColumn } from "../src/lib/require-query";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
async function checkThrows(name: string, fn: () => Promise<unknown>, messageIncludes: string) {
  try {
    await fn();
    throw new Error(`FALHOU: ${name} — deveria ter lançado, não lançou`);
  } catch (err) {
    assert.ok(err instanceof Error && err.message.includes(messageIncludes), `FALHOU: ${name} — mensagem inesperada: ${(err as Error).message}`);
    passed++;
    console.log(`  ok — ${name}`);
  }
}

async function main() {
const missingColumnError = { message: 'column "campaign_daily_metrics.link_clicks" does not exist', code: "42703" };
const otherDbError = { message: "permission denied for table campaign_daily_metrics", code: "42501" };

console.log("1 — caminho feliz: coluna existe, nenhum fallback usado\n");

{
  const primary = Promise.resolve({ data: [{ date: "2026-10-01", link_clicks: 80 }], error: null });
  const fallback = () => Promise.resolve({ data: [{ date: "2026-10-01" }], error: null });
  const result = await requireQueryToleratingMissingColumn(primary, fallback, "link_clicks", "teste:feliz");
  check("usedFallback é false quando a consulta principal funciona", result.usedFallback, false);
  check("devolve as linhas da consulta principal, com link_clicks", result.rows, [{ date: "2026-10-01", link_clicks: 80 }]);
}

console.log("\n2 — coluna ainda não existe (migração pendente): usa fallback, nunca quebra\n");

{
  const primary = Promise.resolve({ data: null, error: missingColumnError });
  const fallback = () => Promise.resolve({ data: [{ date: "2026-10-01" }], error: null });
  const result = await requireQueryToleratingMissingColumn(primary, fallback, "link_clicks", "teste:fallback");
  check("usedFallback é true quando a coluna não existe", result.usedFallback, true);
  check("devolve as linhas da consulta de fallback (sem link_clicks)", result.rows, [{ date: "2026-10-01" }]);
}

console.log("\n3 — erro NÃO relacionado à coluna ausente: sempre lança, nunca mascara falha real\n");

await checkThrows(
  "erro de permissão (RLS) continua lançando, nunca tenta fallback silenciosamente",
  () =>
    requireQueryToleratingMissingColumn(Promise.resolve({ data: null, error: otherDbError }), () => Promise.resolve({ data: [], error: null }), "link_clicks", "teste:outro-erro"),
  "permission denied",
);

console.log("\n4 — fallback também falha: continua lançando (nunca finge sucesso)\n");

await checkThrows(
  "se até a consulta de fallback falhar, lança (não devolve dado fictício)",
  () =>
    requireQueryToleratingMissingColumn(
      Promise.resolve({ data: null, error: missingColumnError }),
      () => Promise.resolve({ data: null, error: { message: "timeout", code: "57014" } }),
      "link_clicks",
      "teste:fallback-falha",
    ),
  "timeout",
);

console.log("\n5 — mensagem de erro 42703 mas sobre OUTRA coluna: não confunde, continua lançando\n");

await checkThrows(
  "código 42703 mas a coluna citada não é a esperada: não ativa o fallback",
  () =>
    requireQueryToleratingMissingColumn(
      Promise.resolve({ data: null, error: { message: 'column "foo.other_column" does not exist', code: "42703" } }),
      () => Promise.resolve({ data: [], error: null }),
      "link_clicks",
      "teste:coluna-errada",
    ),
  "other_column",
);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
