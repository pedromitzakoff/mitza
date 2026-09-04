/**
 * Etapa 2A (Auditoria de Segurança — correções prioritárias) — Achado #3:
 * as 5 rotas de cron/admin (`/api/cron/*`, `/api/admin/sync-stract`) faziam
 * `if (cronSecret) { valida } ` sem `else`, ou seja, sem `CRON_SECRET`
 * configurado a rota seguia SEM checar nada (fail-open). `isAuthorizedCronRequest`
 * (`lib/cron-auth.ts`) corrige isso: sem a env var, sem header, ou com
 * `Bearer` incorreto, o resultado é sempre negar — nunca "deixa passar
 * porque não tinha o que comparar".
 *
 * Etapa 2C: `guardCronRequest` agora é async (rate limit distribuído via
 * Upstash é uma chamada de rede) — os testes injetam
 * `InMemorySlidingWindowRateLimitBackend` (nunca tocam Upstash real).
 *
 * Rodar: npx tsx scripts/test-cron-auth.ts
 */
import assert from "node:assert/strict";
import { isAuthorizedCronRequest, guardCronRequest } from "../src/lib/cron-auth";
import { InMemorySlidingWindowRateLimitBackend, __setRateLimitBackendForTests } from "../src/lib/rate-limit";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;
function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
}

function requestWithAuth(authHeader: string | null): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new Request("https://example.com/api/cron/sync-meta", { headers });
}

function freshRateLimitBackend() {
  __setRateLimitBackendForTests(new InMemorySlidingWindowRateLimitBackend());
}

async function main() {

console.log("\n1 — CRON_SECRET ausente (env não configurada) → bloqueia, mesmo com header correto\n");
{
  setSecret(undefined);
  ok("sem env e sem header: nega", !isAuthorizedCronRequest(requestWithAuth(null)));
  ok("sem env mas COM um Bearer qualquer: nega (nunca compara contra undefined)", !isAuthorizedCronRequest(requestWithAuth("Bearer qualquer-coisa")));
}

console.log("\n2 — CRON_SECRET = string vazia → tratado como ausente, bloqueia (fail-closed)\n");
{
  setSecret("");
  ok("env vazia: nega", !isAuthorizedCronRequest(requestWithAuth("Bearer ")));
}

console.log("\n3 — CRON_SECRET configurado, header Authorization ausente → bloqueia\n");
{
  setSecret("segredo-de-teste-123");
  ok("header ausente: nega", !isAuthorizedCronRequest(requestWithAuth(null)));
}

console.log("\n4 — CRON_SECRET configurado, Bearer incorreto → bloqueia\n");
{
  setSecret("segredo-de-teste-123");
  ok("Bearer com valor errado: nega", !isAuthorizedCronRequest(requestWithAuth("Bearer valor-errado")));
  ok("Bearer certo mas sem o prefixo 'Bearer ': nega", !isAuthorizedCronRequest(requestWithAuth("segredo-de-teste-123")));
  ok("Bearer com o segredo certo mas caixa diferente: nega (comparação exata)", !isAuthorizedCronRequest(requestWithAuth("bearer segredo-de-teste-123")));
  ok("Bearer certo + sufixo extra: nega (nunca prefix-match)", !isAuthorizedCronRequest(requestWithAuth("Bearer segredo-de-teste-1234")));
}

console.log("\n5 — CRON_SECRET configurado, Bearer correto → autoriza\n");
{
  setSecret("segredo-de-teste-123");
  ok("Bearer exatamente igual: autoriza", isAuthorizedCronRequest(requestWithAuth("Bearer segredo-de-teste-123")));
}

console.log("\n6 — formato de chamada da Vercel Cron continua compatível\n");
{
  // A Vercel Cron sempre envia `Authorization: Bearer <CRON_SECRET>` em GET
  // quando a env var está configurada no projeto — mesmo formato usado aqui,
  // nenhuma mudança de contrato de chamada, só a regra de fail-closed.
  setSecret("valor-real-de-producao");
  const vercelStyleRequest = new Request("https://mitza.example.com/api/cron/sync-meta", {
    method: "GET",
    headers: { Authorization: "Bearer valor-real-de-producao" },
  });
  ok("requisição no formato exato da Vercel Cron é autorizada", isAuthorizedCronRequest(vercelStyleRequest));
}

console.log("\n7 — guardCronRequest: sem CRON_SECRET, nega com 401 (nunca chega a checar rate limit)\n");
{
  freshRateLimitBackend();
  setSecret(undefined);
  const rejection = await guardCronRequest(requestWithAuth("Bearer qualquer-coisa"), "test-route-1");
  ok("rejeição existe (não é null)", rejection !== null);
  ok("status 401 (auth falha primeiro, não 429)", rejection?.status === 401);
}

console.log("\n8 — guardCronRequest: Bearer correto e dentro do limite → autoriza (retorna null)\n");
{
  freshRateLimitBackend();
  setSecret("segredo-de-teste-123");
  const rejection = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "test-route-2");
  ok("null = pode prosseguir", rejection === null);
}

console.log("\n9 — guardCronRequest: chamadas SEM o segredo (correto ou errado) nunca consomem a cota do bucket de rate limit\n");
{
  // Prova a ordem auth→rate-limit: um flood de requisições sem CRON_SECRET
  // correto nunca deve conseguir bloquear a chamada legítima que vem depois
  // (senão seria uma auto-negação de serviço contra a própria Vercel Cron).
  freshRateLimitBackend();
  setSecret("segredo-de-teste-123");
  for (let i = 0; i < 50; i++) {
    const rejection = await guardCronRequest(requestWithAuth("Bearer errado"), "test-route-3");
    assert.equal(rejection?.status, 401, `chamada ${i} sem segredo deveria ser 401`);
  }
  const legitimate = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "test-route-3");
  ok("depois de 50 tentativas com Bearer ERRADO, a chamada legítima ainda passa (cota intacta)", legitimate === null);

  // Idem pra "sem header nenhum" — não só "Bearer errado".
  freshRateLimitBackend();
  for (let i = 0; i < 50; i++) {
    const rejection = await guardCronRequest(requestWithAuth(null), "test-route-3b");
    assert.equal(rejection?.status, 401, `chamada ${i} sem header deveria ser 401`);
  }
  const legitimateNoHeader = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "test-route-3b");
  ok("depois de 50 tentativas SEM header nenhum, a chamada legítima ainda passa (cota intacta)", legitimateNoHeader === null);
}

console.log("\n10 — guardCronRequest: acima do limite (já autenticado) → 429 com Retry-After\n");
{
  freshRateLimitBackend();
  setSecret("segredo-de-teste-123");
  let lastRejection: Response | null = null;
  for (let i = 0; i < 6; i++) {
    lastRejection = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "test-route-4");
  }
  ok("6ª chamada autenticada em sequência é bloqueada", lastRejection !== null);
  ok("status 429 (rate limit, não auth)", lastRejection?.status === 429);
  ok("Retry-After presente", Number(lastRejection?.headers.get("Retry-After")) > 0);
}

console.log("\n11 — guardCronRequest: rotas diferentes (buckets diferentes) não compartilham cota\n");
{
  freshRateLimitBackend();
  setSecret("segredo-de-teste-123");
  for (let i = 0; i < 5; i++) await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "sync-meta");
  const syncMetaBlocked = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "sync-meta");
  const syncStractStillFree = await guardCronRequest(requestWithAuth("Bearer segredo-de-teste-123"), "sync-stract");
  ok("sync-meta esgotado: bloqueado", syncMetaBlocked !== null);
  ok("sync-stract, rota diferente, cota própria: autorizado", syncStractStillFree === null);
}

setSecret(ORIGINAL_SECRET);
console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
