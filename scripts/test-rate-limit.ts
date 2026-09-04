/**
 * Etapa 2B (Hardening antes do link externo) — `lib/rate-limit.ts`.
 *
 * `checkRateLimit` aceita um `now` explícito (nunca depende de
 * `Date.now()`/`setTimeout` real) exatamente pra estes testes serem
 * determinísticos — nenhum `sleep`, nenhuma dependência de timing real.
 *
 * Rodar: npx tsx scripts/test-rate-limit.ts
 */
import assert from "node:assert/strict";
import { checkRateLimit, rateLimitedResponse, __resetRateLimitStateForTests } from "../src/lib/rate-limit";

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

console.log("\n1 — abaixo do limite → sempre autoriza\n");
{
  __resetRateLimitStateForTests();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) {
    const result = checkRateLimit({ bucket: "test-1", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
    ok(`chamada ${i + 1}/5 autorizada`, result.allowed);
  }
}

console.log("\n2 — acima do limite → nega com retryAfterSeconds > 0\n");
{
  __resetRateLimitStateForTests();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit({ bucket: "test-2", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const sixth = checkRateLimit({ bucket: "test-2", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("6ª chamada dentro da janela é negada", !sixth.allowed);
  ok("retryAfterSeconds > 0 quando negado", sixth.retryAfterSeconds > 0);
  check("remaining = 0 quando negado", sixth.remaining, 0);
}

console.log("\n3 — resposta 429 tem o header Retry-After correto, sem vazar detalhe interno\n");
{
  __resetRateLimitStateForTests();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRateLimit({ bucket: "test-3", key: "user-a", limit: 3, windowMs: 60_000, now: now + i });
  const blocked = checkRateLimit({ bucket: "test-3", key: "user-a", limit: 3, windowMs: 60_000, now: now + 3 });
  const response = rateLimitedResponse(blocked);
  check("status 429", response.status, 429);
  check("Retry-After presente e bate com o resultado", response.headers.get("Retry-After"), String(blocked.retryAfterSeconds));
  ok("Retry-After é um número positivo em texto", Number(response.headers.get("Retry-After")) > 0);
}

console.log("\n4 — identidades diferentes não compartilham bucket (bucket+key isolados)\n");
{
  __resetRateLimitStateForTests();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit({ bucket: "test-4", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const userA = checkRateLimit({ bucket: "test-4", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  const userB = checkRateLimit({ bucket: "test-4", key: "user-b", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("usuário A já no limite: negado", !userA.allowed);
  ok("usuário B, mesmo bucket, key diferente: autorizado normalmente", userB.allowed);
}

console.log("\n5 — mesma key, buckets diferentes (rotas diferentes) não compartilham contador\n");
{
  __resetRateLimitStateForTests();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit({ bucket: "route-a", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const routeA = checkRateLimit({ bucket: "route-a", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  const routeB = checkRateLimit({ bucket: "route-b", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("route-a já no limite: negado", !routeA.allowed);
  ok("route-b, mesma identidade, bucket diferente: autorizado", routeB.allowed);
}

console.log("\n6 — janela deslizante: fora da janela, o contador esvazia e volta a autorizar (sem sleep real)\n");
{
  __resetRateLimitStateForTests();
  const windowMs = 60_000;
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now });
  const stillBlocked = checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now: now + windowMs - 1 });
  ok("1ms antes de a janela abrir de novo: ainda negado", !stillBlocked.allowed);
  const afterWindow = checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now: now + windowMs + 1 });
  ok("logo depois da janela expirar: autorizado de novo", afterWindow.allowed);
}

console.log(`\nTodos os ${passed} testes passaram.`);
