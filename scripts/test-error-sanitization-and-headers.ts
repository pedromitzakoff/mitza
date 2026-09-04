/**
 * Etapa 2B (Hardening antes do link externo) — dois itens sem dependência
 * comum, agrupados num arquivo só por serem pequenos:
 *
 * 1. Sanitização de erro cru em `/api/admin/sync-stract` e
 *    `/api/cron/evaluate-achievements` — antes devolviam `err.message`/
 *    `String(err)` direto no corpo da resposta; agora usam
 *    `toUserFacingError` (mesmo padrão do resto do projeto): o erro
 *    completo continua logado (`console.error`) server-side, a resposta
 *    HTTP recebe só uma mensagem genérica, status preservado.
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

console.log("\n1 — /api/admin/sync-stract: nunca mais devolve err.message/String(err) cru\n");
{
  const source = readRoute("admin", "sync-stract", "route.ts");
  ok("usa toUserFacingError no catch", /toUserFacingError\(err,/.test(source));
  ok("não devolve mais `err instanceof Error ? err.message : String(err)` no JSON de resposta", !/error: err instanceof Error \? err\.message : String\(err\)/.test(source));
  ok("status 500 preservado no catch", /\{ status: 500 \}/.test(source));
  ok("importa toUserFacingError de lib/user-facing-error", /import\s*\{\s*toUserFacingError\s*\}\s*from\s*"@\/lib\/user-facing-error"/.test(source));
}

console.log("\n2 — /api/cron/evaluate-achievements: nunca mais devolve err.message cru\n");
{
  const source = readRoute("cron", "evaluate-achievements", "route.ts");
  ok("usa toUserFacingError no catch", /toUserFacingError\(err,/.test(source));
  ok("não devolve mais `err instanceof Error ? err.message : ...` no JSON de resposta", !/error: err instanceof Error \? err\.message :/.test(source));
  ok("status 500 preservado no catch", /\{ status: 500 \}/.test(source));
}

console.log("\n3 — as 5 rotas de cron/admin usam guardCronRequest (auth + rate limit centralizados)\n");
{
  const routes: [string[], string][] = [
    [["admin", "sync-stract", "route.ts"], "admin-sync-stract"],
    [["cron", "sync-meta", "route.ts"], "sync-meta"],
    [["cron", "sync-stract", "route.ts"], "sync-stract"],
    [["cron", "ensure-sprints", "route.ts"], "ensure-sprints"],
    [["cron", "evaluate-achievements", "route.ts"], "evaluate-achievements"],
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
