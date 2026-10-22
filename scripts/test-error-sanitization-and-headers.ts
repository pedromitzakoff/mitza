/**
 * Etapa 2B (Hardening antes do link externo) — dois itens sem dependência
 * comum, agrupados num arquivo só por serem pequenos:
 *
 * 1. (Removida — a rota que auditava, `/api/admin/sync-stract`, foi excluída
 *    junto com a descontinuação do Stract, ver
 *    `docs/STRACT_INTEGRATION_ARCHITECTURE.md`. Nenhuma rota remanescente
 *    tem o mesmo formato try/catch-com-JSON-de-erro pra auditar no lugar —
 *    `cron/sync-meta-api` não captura erro nenhum, deixa propagar pro 500
 *    genérico do próprio Next.js, nunca um `err.message` cru em JSON.)
 * 2. Headers globais de `next.config.ts` — a verificação chama
 *    `nextConfig.headers()` de verdade (é só uma função assíncrona pura,
 *    sem runtime do Next.js envolvido) e confere o resultado.
 *
 * Rodar: npx tsx scripts/test-error-sanitization-and-headers.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function readRoute(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", "src", "app", "api", ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// (Seção 1 — "/api/admin/sync-stract" — removida: a rota foi excluída junto
// com a descontinuação do Stract, ver
// docs/STRACT_INTEGRATION_ARCHITECTURE.md.)
// ---------------------------------------------------------------------------
// (Seção 2 — "/api/cron/evaluate-achievements" — removida: a rota foi
// excluída na Etapa 1.4 da reestruturação KOFF Analytics, junto com o
// motor de Achievements.)
// ---------------------------------------------------------------------------

console.log("\n3 — as rotas de cron usam guardCronRequest (auth + rate limit centralizados)\n");
{
  const routes: [string[], string][] = [
    [["cron", "sync-meta", "route.ts"], "sync-meta"],
    [["cron", "sync-meta-api", "route.ts"], "sync-meta-api"],
    [["cron", "ensure-sprints", "route.ts"], "ensure-sprints"],
  ];
  for (const [segments, routeName] of routes) {
    const source = readRoute(...segments);
    ok(`${segments.join("/")}: importa guardCronRequest`, /import\s*\{\s*guardCronRequest\s*\}\s*from\s*"@\/lib\/cron-auth"/.test(source));
    ok(`${segments.join("/")}: chama guardCronRequest(request, "${routeName}")`, new RegExp(`guardCronRequest\\(request, "${routeName}"\\)`).test(source));
    ok(`${segments.join("/")}: nenhuma implementação de auth solta (isAuthorizedCronRequest direto)`, !/isAuthorizedCronRequest/.test(source));
  }
}

console.log("\n4 — next.config.ts expõe os headers básicos esperados, em toda rota\n");
(async () => {
  const config = nextConfig as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
  ok("headers() está definido", typeof config.headers === "function");
  const rules = await config.headers();
  ok("existe pelo menos uma regra de headers", rules.length > 0);
  const globalRule = rules.find((r) => r.source === "/:path*");
  ok("a regra cobre todas as rotas (/:path*)", globalRule !== undefined);

  const byKey = new Map((globalRule?.headers ?? []).map((h) => [h.key, h.value]));
  ok("X-Content-Type-Options: nosniff", byKey.get("X-Content-Type-Options") === "nosniff");
  ok("X-Frame-Options: DENY", byKey.get("X-Frame-Options") === "DENY");
  ok("Referrer-Policy: strict-origin-when-cross-origin", byKey.get("Referrer-Policy") === "strict-origin-when-cross-origin");
  ok("Permissions-Policy desliga camera/microphone/geolocation", (byKey.get("Permissions-Policy") ?? "").includes("camera=()") && (byKey.get("Permissions-Policy") ?? "").includes("microphone=()") && (byKey.get("Permissions-Policy") ?? "").includes("geolocation=()"));
  ok("Strict-Transport-Security definido, sem includeSubDomains/preload", (byKey.get("Strict-Transport-Security") ?? "").startsWith("max-age=") && !(byKey.get("Strict-Transport-Security") ?? "").includes("includeSubDomains") && !(byKey.get("Strict-Transport-Security") ?? "").includes("preload"));
  ok("Content-Security-Policy deliberadamente NÃO definido nesta etapa", !byKey.has("Content-Security-Policy"));

  console.log(`\nTodos os ${passed} testes passaram.`);
})();
