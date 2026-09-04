/**
 * Etapa 2C (Rate Limit Distribuído em Produção) — `lib/rate-limit.ts`.
 *
 * Nunca toca o Upstash real: injeta `InMemorySlidingWindowRateLimitBackend`
 * via `__setRateLimitBackendForTests` (mesma abstração `RateLimitBackend`
 * que o backend real de produção implementa) e passa `now` explícito em
 * cada chamada — determinístico, sem `sleep`, sem rede.
 *
 * Rodar: npx tsx scripts/test-rate-limit.ts
 */
import assert from "node:assert/strict";
import {
  checkRateLimit,
  enforceRateLimit,
  rateLimitedResponse,
  rateLimitUnavailableResponse,
  RateLimitUnavailableError,
  InMemorySlidingWindowRateLimitBackend,
  __setRateLimitBackendForTests,
  type RateLimitBackend,
} from "../src/lib/rate-limit";

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

function freshBackend() {
  const backend = new InMemorySlidingWindowRateLimitBackend();
  __setRateLimitBackendForTests(backend);
  return backend;
}

async function main() {

console.log("\n1 — abaixo do limite → sempre autoriza\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) {
    const result = await checkRateLimit({ bucket: "test-1", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
    ok(`chamada ${i + 1}/5 autorizada`, result.allowed);
  }
}

console.log("\n2 — acima do limite → nega com retryAfterSeconds > 0\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) await checkRateLimit({ bucket: "test-2", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const sixth = await checkRateLimit({ bucket: "test-2", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("6ª chamada dentro da janela é negada", !sixth.allowed);
  ok("retryAfterSeconds > 0 quando negado", sixth.retryAfterSeconds > 0);
  check("remaining = 0 quando negado", sixth.remaining, 0);
}

console.log("\n3 — resposta 429 tem o header Retry-After correto, sem vazar detalhe interno\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) await checkRateLimit({ bucket: "test-3", key: "user-a", limit: 3, windowMs: 60_000, now: now + i });
  const blocked = await checkRateLimit({ bucket: "test-3", key: "user-a", limit: 3, windowMs: 60_000, now: now + 3 });
  const response = rateLimitedResponse(blocked);
  check("status 429", response.status, 429);
  check("Retry-After presente e bate com o resultado", response.headers.get("Retry-After"), String(blocked.retryAfterSeconds));
  ok("Retry-After é um número positivo em texto", Number(response.headers.get("Retry-After")) > 0);
  const body = await response.clone().json();
  ok("body não menciona bucket/key/identidade interna", !JSON.stringify(body).includes("test-3") && !JSON.stringify(body).includes("user-a"));
}

console.log("\n4 — identidades diferentes não compartilham bucket (usuário A não consome a cota do usuário B)\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) await checkRateLimit({ bucket: "test-4", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const userA = await checkRateLimit({ bucket: "test-4", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  const userB = await checkRateLimit({ bucket: "test-4", key: "user-b", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("usuário A já no limite: negado", !userA.allowed);
  ok("usuário B, mesmo bucket, key diferente: autorizado normalmente", userB.allowed);
}

console.log("\n5 — mesma key, buckets diferentes (rotas diferentes) não compartilham contador\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) await checkRateLimit({ bucket: "route-a", key: "user-a", limit: 5, windowMs: 60_000, now: now + i });
  const routeA = await checkRateLimit({ bucket: "route-a", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  const routeB = await checkRateLimit({ bucket: "route-b", key: "user-a", limit: 5, windowMs: 60_000, now: now + 5 });
  ok("route-a já no limite: negado", !routeA.allowed);
  ok("route-b, mesma identidade, bucket diferente: autorizado", routeB.allowed);
}

console.log("\n6 — janela deslizante: fora da janela, o contador esvazia e volta a autorizar (sem sleep real)\n");
{
  freshBackend();
  const windowMs = 60_000;
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) await checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now });
  const stillBlocked = await checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now: now + windowMs - 1 });
  ok("1ms antes de a janela abrir de novo: ainda negado", !stillBlocked.allowed);
  const afterWindow = await checkRateLimit({ bucket: "test-6", key: "user-a", limit: 5, windowMs, now: now + windowMs + 1 });
  ok("logo depois da janela expirar: autorizado de novo", afterWindow.allowed);
}

console.log("\n7 — Performance Report: cliente A não consome o bucket de user-client do cliente B (mesmo usuário)\n");
{
  // Escopo exato usado por /api/clients/[id]/performance-report:
  // bucket "performance-report:user-client", key `${userId}:${clientId}`.
  freshBackend();
  const now = 1_000_000;
  const userId = "user-1";
  for (let i = 0; i < 6; i++) {
    await checkRateLimit({ bucket: "performance-report:user-client", key: `${userId}:client-A`, limit: 6, windowMs: 60_000, now: now + i });
  }
  const clientA = await checkRateLimit({ bucket: "performance-report:user-client", key: `${userId}:client-A`, limit: 6, windowMs: 60_000, now: now + 6 });
  const clientB = await checkRateLimit({ bucket: "performance-report:user-client", key: `${userId}:client-B`, limit: 6, windowMs: 60_000, now: now + 6 });
  ok("cliente A do mesmo usuário já no limite: negado", !clientA.allowed);
  ok("cliente B do MESMO usuário, bucket user-client diferente: autorizado", clientB.allowed);
}

console.log("\n8 — Performance Report: bucket global por usuário continua funcionando independente do bucket user-client\n");
{
  freshBackend();
  const now = 1_000_000;
  const userId = "user-2";
  // Esgota o bucket global do usuário (30/5min) sem nunca esgotar o
  // bucket user-client (6/60s) de nenhum cliente específico — troca de
  // cliente a cada chamada.
  for (let i = 0; i < 30; i++) {
    await checkRateLimit({ bucket: "performance-report:user-client", key: `${userId}:client-${i}`, limit: 6, windowMs: 60_000, now: now + i });
    await checkRateLimit({ bucket: "performance-report:user", key: userId, limit: 30, windowMs: 300_000, now: now + i });
  }
  const nextGlobal = await checkRateLimit({ bucket: "performance-report:user", key: userId, limit: 30, windowMs: 300_000, now: now + 30 });
  const nextClientScoped = await checkRateLimit({ bucket: "performance-report:user-client", key: `${userId}:client-novo`, limit: 6, windowMs: 60_000, now: now + 30 });
  ok("bucket global do usuário (30/5min) já esgotado: negado", !nextGlobal.allowed);
  ok("um cliente NUNCA visitado antes ainda tem seu próprio bucket user-client livre", nextClientScoped.allowed);
}

console.log("\n9 — enforceRateLimit: dentro do limite retorna null (pode prosseguir)\n");
{
  freshBackend();
  const rejection = await enforceRateLimit({ bucket: "test-9", key: "user-a", limit: 5, windowMs: 60_000, now: 1_000_000 });
  ok("null quando autorizado", rejection === null);
}

console.log("\n10 — enforceRateLimit: acima do limite retorna a Response 429\n");
{
  freshBackend();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) await enforceRateLimit({ bucket: "test-10", key: "user-a", limit: 3, windowMs: 60_000, now: now + i });
  const rejection = await enforceRateLimit({ bucket: "test-10", key: "user-a", limit: 3, windowMs: 60_000, now: now + 3 });
  ok("Response de rejeição existe", rejection !== null);
  check("status 429", rejection?.status, 429);
}

console.log("\n11 — enforceRateLimit: backend indisponível (RateLimitUnavailableError) vira 503, nunca 429\n");
{
  const failingBackend: RateLimitBackend = {
    async limit() {
      throw new RateLimitUnavailableError("Upstash fora do ar (simulado)");
    },
  };
  __setRateLimitBackendForTests(failingBackend);
  const rejection = await enforceRateLimit({ bucket: "test-11", key: "user-a", limit: 5, windowMs: 60_000 });
  ok("Response de rejeição existe", rejection !== null);
  check("status 503 (nunca 429 — não é limite excedido, é indisponibilidade)", rejection?.status, 503);
  const body = await rejection!.clone().json();
  ok("mensagem genérica, nunca menciona Upstash/Redis/infraestrutura", !JSON.stringify(body).toLowerCase().includes("upstash") && !JSON.stringify(body).toLowerCase().includes("redis"));
}

console.log("\n12 — rateLimitUnavailableResponse é sempre 503 com mensagem genérica\n");
{
  const response = rateLimitUnavailableResponse();
  check("status 503", response.status, 503);
  const body = await response.clone().json();
  ok("mensagem genérica presente", typeof body.error === "string" && body.error.length > 0);
}

__setRateLimitBackendForTests(null);
console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
