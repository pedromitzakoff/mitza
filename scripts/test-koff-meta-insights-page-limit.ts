/**
 * Teste da Etapa "Diagnóstico de sincronização" — otimização de desempenho
 * (11/2026): `fetchMetaApiInsightsForAccount` não pedia um tamanho de
 * página explícito, caindo no padrão pequeno da própria Graph API — pra
 * uma conta grande/ativa (nível de anúncio + 2 dimensões de breakdown),
 * isso significava centenas de viagens de rede sequenciais só pra montar o
 * mesmo total de linhas, contribuindo pro timeout de 300s da Vercel visto
 * em produção (Helping Hand, 2.853 linhas em 3 dias). `limit=500` reduz
 * drasticamente o número de páginas pro MESMO dado — este teste confirma
 * que o parâmetro está presente, sem precisar de rede real (mock de
 * `fetch`, uma página só, resposta vazia).
 *
 * Rodar: npx tsx scripts/test-koff-meta-insights-page-limit.ts
 */
import assert from "node:assert/strict";
import { fetchMetaApiInsightsForAccount } from "../src/lib/meta-api-fetch";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

async function main() {
  console.log("\nA — fetchMetaApiInsightsForAccount pede um lote grande por página\n");
  {
    process.env.META_API_ACCESS_TOKEN = "token-de-teste";
    const originalFetch = globalThis.fetch;
    const capturedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrls.push(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      await fetchMetaApiInsightsForAccount("act_123", "2026-10-23", "2026-10-25");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const finalUrl = capturedUrls[0] ?? "";
    ok("a URL chamada inclui limit=500 (nunca o padrão pequeno da própria Graph API)", finalUrl.includes("limit=500"));
    ok(
      "mesmos breakdowns/fields de sempre — a otimização nunca muda O QUE é buscado, só o tamanho da página",
      finalUrl.includes("publisher_platform%2Cplatform_position") && finalUrl.includes("level=ad"),
    );
  }

  console.log(`\n${passed} verificações OK.\n`);
}

main();
