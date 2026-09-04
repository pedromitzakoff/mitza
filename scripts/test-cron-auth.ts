/**
 * Etapa 2A (Auditoria de Segurança — correções prioritárias) — Achado #3:
 * as 5 rotas de cron/admin (`/api/cron/*`, `/api/admin/sync-stract`) faziam
 * `if (cronSecret) { valida } ` sem `else`, ou seja, sem `CRON_SECRET`
 * configurado a rota seguia SEM checar nada (fail-open). `isAuthorizedCronRequest`
 * (`lib/cron-auth.ts`) corrige isso: sem a env var, sem header, ou com
 * `Bearer` incorreto, o resultado é sempre negar — nunca "deixa passar
 * porque não tinha o que comparar".
 *
 * Rodar: npx tsx scripts/test-cron-auth.ts
 */
import assert from "node:assert/strict";
import { isAuthorizedCronRequest } from "../src/lib/cron-auth";

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

setSecret(ORIGINAL_SECRET);
console.log(`\nTodos os ${passed} testes passaram.`);
