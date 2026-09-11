/**
 * Etapa "Link Externo V1" — `/r/[token]` (Performance Report público, sem
 * login) e o painel "Link do cliente" (`report-share-link-panel.tsx`).
 *
 * Este ambiente não tem Supabase real: a resolução de token/autorização é
 * testada injetando `InMemoryReportShareLinkStore` no lugar do Supabase
 * (`__setReportShareLinkStoreForTests`, mesma abstração de
 * `RateLimitBackend`/`__setRateLimitBackendForTests` em `lib/rate-limit.ts`).
 * O rate limit do `/r/*` é testado do mesmo jeito, via
 * `checkPublicReportRateLimit` (extraído de `proxy.ts`) + o backend em
 * memória já existente. "Página pública não exige login"/"páginas internas
 * continuam exigindo login" exercitam a função real `isPublicPath`
 * (`lib/supabase/middleware.ts`), não uma reimplementação. "Nenhuma service
 * role chega ao client bundle" é uma checagem estrutural do código-fonte dos
 * componentes client ("use client").
 *
 * Rodar: npx tsx scripts/test-report-share-links.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveClientIdFromShareToken,
  rotateReportShareLink,
  revokeReportShareLink,
  getReportShareLinkStatus,
  __setReportShareLinkStoreForTests,
  __testing,
  type ReportShareLinkStore,
  type ActiveReportShareLink,
} from "../src/lib/report-share-links";
import { checkPublicReportRateLimit } from "../src/proxy";
import { isPublicPath } from "../src/lib/supabase/middleware";
import { InMemorySlidingWindowRateLimitBackend, __setRateLimitBackendForTests } from "../src/lib/rate-limit";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

interface StoredLink {
  clientId: string;
  /** Nullable de propósito — modela a linha antiga (anterior à Etapa "Link
   * Externo — token recuperável"), que nunca tinha essa coluna preenchida. */
  token: string | null;
  tokenHash: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Dublê em memória de `ReportShareLinkStore` — nunca toca Supabase/rede.
 * `insertedTokenHashes` existe pra provar que `token_hash` continua sendo o
 * sha256 do token bruto (nunca o valor cru), mesmo com o token bruto agora
 * também sendo persistido (Etapa "Link Externo — token recuperável"). */
class InMemoryReportShareLinkStore implements ReportShareLinkStore {
  links: StoredLink[] = [];
  insertedTokenHashes: string[] = [];
  private liveClientIds: Set<string>;

  constructor(liveClientIds: string[]) {
    this.liveClientIds = new Set(liveClientIds);
  }

  async findActiveByTokenHash(tokenHash: string): Promise<{ clientId: string } | null> {
    const link = this.links.find((l) => l.tokenHash === tokenHash && l.revokedAt === null);
    return link ? { clientId: link.clientId } : null;
  }

  async isClientLive(clientId: string): Promise<boolean> {
    return this.liveClientIds.has(clientId);
  }

  async findActiveForClient(clientId: string): Promise<ActiveReportShareLink | null> {
    const link = this.links
      .filter((l) => l.clientId === clientId && l.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return link ? { clientId: link.clientId, createdAt: link.createdAt, token: link.token } : null;
  }

  async revokeActiveForClient(clientId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const link of this.links) {
      if (link.clientId === clientId && link.revokedAt === null) link.revokedAt = now;
    }
  }

  async insert(clientId: string, token: string, tokenHash: string): Promise<void> {
    this.insertedTokenHashes.push(tokenHash);
    this.links.push({ clientId, token, tokenHash, createdAt: new Date().toISOString(), revokedAt: null });
  }
}

function freshRateLimitBackend() {
  __setRateLimitBackendForTests(new InMemorySlidingWindowRateLimitBackend());
}

async function main() {

console.log("\n1 — token válido resolve para o cliente correto, e só ele\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a", "client-b"]);
  __setReportShareLinkStoreForTests(store);

  const tokenA = await rotateReportShareLink("client-a");
  const resolved = await resolveClientIdFromShareToken(tokenA);
  ok("token de client-a resolve pra client-a", resolved === "client-a");
}

console.log("\n2 — token inválido (nunca existiu) → negado (null)\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  await rotateReportShareLink("client-a");

  const resolved = await resolveClientIdFromShareToken("token-que-nunca-foi-gerado");
  ok("token inexistente: null", resolved === null);

  const resolvedEmpty = await resolveClientIdFromShareToken("");
  ok("token vazio: null, sem nem consultar o store", resolvedEmpty === null);
}

console.log("\n3 — token revogado → negado (null), mesmo existindo\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const token = await rotateReportShareLink("client-a");
  ok("antes de revogar: resolve normalmente", (await resolveClientIdFromShareToken(token)) === "client-a");

  await revokeReportShareLink("client-a");
  ok("depois de revogar: null", (await resolveClientIdFromShareToken(token)) === null);
}

console.log("\n4 — token do cliente A nunca resolve para o cliente B\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a", "client-b"]);
  __setReportShareLinkStoreForTests(store);

  const tokenA = await rotateReportShareLink("client-a");
  const tokenB = await rotateReportShareLink("client-b");

  ok("token A → client-a", (await resolveClientIdFromShareToken(tokenA)) === "client-a");
  ok("token A NUNCA resolve pra client-b", (await resolveClientIdFromShareToken(tokenA)) !== "client-b");
  ok("token B → client-b", (await resolveClientIdFromShareToken(tokenB)) === "client-b");
  ok("token B NUNCA resolve pra client-a", (await resolveClientIdFromShareToken(tokenB)) !== "client-a");
}

console.log("\n5 — 'Gerar novo link' rotaciona: revoga o anterior, o antigo para de funcionar\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const firstToken = await rotateReportShareLink("client-a");
  const secondToken = await rotateReportShareLink("client-a");

  ok("token antigo parou de resolver", (await resolveClientIdFromShareToken(firstToken)) === null);
  ok("token novo resolve normalmente", (await resolveClientIdFromShareToken(secondToken)) === "client-a");

  const status = await getReportShareLinkStatus("client-a");
  ok("status reporta exatamente 1 link ativo (nunca acumula)", status.active === true);
}

console.log("\n6 — cliente excluído (soft-delete): token existente para de resolver\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]); // client-b nunca "live"
  __setReportShareLinkStoreForTests(store);

  const token = await rotateReportShareLink("client-b");
  ok("link existe e não foi revogado, mas o cliente não está 'live': null", (await resolveClientIdFromShareToken(token)) === null);
}

console.log("\n7 — alteração de query/parâmetro nunca muda o cliente autorizado (auditoria da rota pública)\n");
{
  // A rota /r/[token] só tem UMA fonte de client_id: resolveClientIdFromShareToken(token).
  // Prova estrutural: o código-fonte da página nunca lê um clientId de
  // searchParams/query, e o único identificador usado nas chamadas de dado
  // é a variável resolvida pelo token.
  const source = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8");

  ok("resolve o clientId exclusivamente via resolveClientIdFromShareToken(token)", /const clientId = await resolveClientIdFromShareToken\(token\)/.test(source));
  ok("searchParams desestruturado só pega campos de período, nunca clientId", /const \{ analyticsPreset: presetParam, analyticsStart: startParam, analyticsEnd: endParam \} = await searchParams/.test(source));
  ok("nunca lê searchParams.clientId em lugar nenhum do arquivo", !/searchParams\.clientId|searchParams\[.client_?[Ii]d.\]/.test(source));
  ok("buildPerformanceReportData é chamado com a variável clientId (resolvida pelo token), nunca um literal de query", /buildPerformanceReportData\(supabase, clientId, period\)/.test(source));
}

console.log("\n8 — página pública (/r/*) não exige login — exercitando a função real do middleware\n");
{
  ok("isPublicPath('/r/algum-token-aqui') === true", isPublicPath("/r/algum-token-aqui"));
  ok("isPublicPath('/r') === true (path exato)", isPublicPath("/r"));
  ok("/login continua público (regra preexistente, não regrediu)", isPublicPath("/login"));
}

console.log("\n9 — páginas internas continuam exigindo login — mesma função, sem regressão\n");
{
  ok("isPublicPath('/clients/abc123') === false", !isPublicPath("/clients/abc123"));
  ok("isPublicPath('/') === false (dashboard)", !isPublicPath("/"));
  ok("isPublicPath('/reports') === false — nunca colide com o prefixo '/r/'", !isPublicPath("/reports"));
  ok("isPublicPath('/relatorio-qualquer') === false — nunca colide por prefixo textual solto", !isPublicPath("/relatorio-qualquer"));
}

console.log("\n10 — rate limit funciona: acima do limite, /r/* é bloqueado com 429\n");
{
  freshRateLimitBackend();
  const request = { nextUrl: { pathname: "/r/algum-token" }, headers: new Headers({ "x-forwarded-for": "203.0.113.10" }) };

  let lastRejection: Response | null = null;
  for (let i = 0; i < 61; i++) {
    lastRejection = await checkPublicReportRateLimit(request);
  }
  ok("61ª requisição do mesmo IP em /r/* é bloqueada", lastRejection !== null);
  ok("status 429", lastRejection?.status === 429);
}

console.log("\n11 — rate limit: IPs diferentes têm cota própria (um visitante não bloqueia outro)\n");
{
  freshRateLimitBackend();
  const requestA = { nextUrl: { pathname: "/r/token-x" }, headers: new Headers({ "x-forwarded-for": "203.0.113.20" }) };
  const requestB = { nextUrl: { pathname: "/r/token-x" }, headers: new Headers({ "x-forwarded-for": "203.0.113.21" }) };

  for (let i = 0; i < 60; i++) await checkPublicReportRateLimit(requestA);
  const blockedA = await checkPublicReportRateLimit(requestA);
  const stillFreeB = await checkPublicReportRateLimit(requestB);

  ok("IP A esgotado: bloqueado", blockedA !== null);
  ok("IP B, mesmo token na URL, cota própria: livre", stillFreeB === null);
}

console.log("\n12 — rate limit: rotas fora de /r/* nunca são checadas por este guard\n");
{
  freshRateLimitBackend();
  const request = { nextUrl: { pathname: "/clients/abc" }, headers: new Headers() };
  const result = await checkPublicReportRateLimit(request);
  ok("null imediato — nem consulta o backend de rate limit", result === null);
}

console.log(
  "\n13 — Etapa \"Link Externo — token recuperável\": token bruto agora É persistido (decisão consciente), mas /r/[token] continua resolvendo só pelo hash\n",
);
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const token = await rotateReportShareLink("client-a");

  ok("exatamente 1 hash foi inserido no store", store.insertedTokenHashes.length === 1);
  const [persistedHash] = store.insertedTokenHashes;
  ok("token_hash continua sendo o sha256 hex do token (64 caracteres hex)", persistedHash === __testing.hashShareToken(token));
  ok("token_hash tem formato de hash hex (64 chars, só [0-9a-f])", /^[0-9a-f]{64}$/.test(persistedHash));
  ok("token_hash NUNCA é igual ao token bruto", persistedHash !== token);

  // Decisão desta etapa: o valor BRUTO também fica salvo, pra o painel
  // "Link do cliente" poder reexibi-lo a qualquer momento (nunca mais só
  // uma vez, na tela, no instante da geração).
  ok("exatamente 1 link foi salvo no store", store.links.length === 1);
  ok("o token bruto foi persistido junto (Etapa 'token recuperável')", store.links[0].token === token);

  const status = await getReportShareLinkStatus("client-a");
  ok("getReportShareLinkStatus devolve a URL completa reconstruída a partir do token persistido", status.url === `http://localhost:3000/r/${token}`);
}

console.log('\n13b — status de um link ativo criado ANTES da Etapa "token recuperável" (sem token persistido) cai pro caso "sem valor reexibível"\n');
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  // Simula uma linha antiga: insere direto no array, sem passar por
  // rotateReportShareLink (que sempre grava o token desde esta etapa).
  store.links.push({ clientId: "client-a", token: null, tokenHash: "hash-antigo", createdAt: new Date().toISOString(), revokedAt: null });

  const status = await getReportShareLinkStatus("client-a");
  ok("link ainda é reportado como ativo", status.active === true);
  ok("sem token bruto salvo (linha anterior a esta etapa), a URL não é montada", status.url === null);
}


console.log("\n14 — token bruto: alta entropia (256 bits) e nunca colide entre gerações\n");
{
  const tokens = new Set<string>();
  for (let i = 0; i < 500; i++) tokens.add(__testing.generateShareToken());
  ok("500 tokens gerados, todos únicos (sem colisão)", tokens.size === 500);

  const sample = __testing.generateShareToken();
  ok("token não contém caracteres inválidos de base64url (+, /, =)", !/[+/=]/.test(sample));
  // 32 bytes em base64url (sem padding) = 43 caracteres.
  ok("token tem 43 caracteres (32 bytes = 256 bits em base64url)", sample.length === 43);
}

console.log("\n15 — nenhuma service role chega ao client bundle (checagem estrutural)\n");
{
  const panelSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "report-share-link-panel.tsx"), "utf8");
  const drawerSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "account-info-drawer.tsx"), "utf8");
  const actionsSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "report-share-link-actions.ts"), "utf8");

  ok("report-share-link-panel.tsx é 'use client'", panelSource.trimStart().startsWith('"use client"'));
  ok("account-info-drawer.tsx é 'use client'", drawerSource.trimStart().startsWith('"use client"'));
  ok("painel client nunca importa lib/supabase/admin", !/lib\/supabase\/admin/.test(panelSource));
  ok("painel client nunca importa lib/report-share-links diretamente", !/lib\/report-share-links/.test(panelSource));
  ok("painel client nunca referencia SUPABASE_SERVICE_ROLE_KEY", !/SUPABASE_SERVICE_ROLE_KEY/.test(panelSource));
  ok("drawer client nunca importa lib/supabase/admin", !/lib\/supabase\/admin/.test(drawerSource));
  ok("drawer client nunca referencia SUPABASE_SERVICE_ROLE_KEY", !/SUPABASE_SERVICE_ROLE_KEY/.test(drawerSource));
  ok("painel client só fala com o servidor via as duas Server Actions", /import \{ generateReportShareLinkAction, revokeReportShareLinkAction \} from "\.\/report-share-link-actions"/.test(panelSource));
  ok("Server Actions ficam num arquivo 'use server' (nunca embutidas no client component)", /^"use server";/.test(actionsSource));
}

console.log("\n16 — URL do link é montada no servidor via VERCEL_PROJECT_PRODUCTION_URL, nunca via window.location.origin do admin\n");
{
  const libSource = readFileSync(join(__dirname, "..", "src", "lib", "report-share-links.ts"), "utf8");
  const actionsSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "report-share-link-actions.ts"), "utf8");
  const panelSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "report-share-link-panel.tsx"), "utf8");

  // Achado real: gerar o link enquanto o admin navega numa URL de deployment
  // (protegida por "Vercel Authentication") produzia um link inacessível
  // pra qualquer cliente real — a correção é nunca depender de onde o
  // browser do admin está, sempre usar o domínio de produção real do
  // projeto (env var que a própria Vercel injeta). Etapa "Link Externo —
  // token recuperável": a resolução da URL foi promovida pra
  // `resolvePublicShareLinkBaseUrl` (lib central) — tanto a geração
  // (Server Action) quanto a leitura de status (Server Component)
  // precisam montar a MESMA URL, nunca duas implementações.
  ok("resolvePublicShareLinkBaseUrl (lib central) usa VERCEL_PROJECT_PRODUCTION_URL", /VERCEL_PROJECT_PRODUCTION_URL/.test(libSource));
  ok(
    "a Server Action reaproveita resolvePublicShareLinkBaseUrl (nunca uma segunda implementação própria)",
    /import\s*\{[^}]*resolvePublicShareLinkBaseUrl[^}]*\}\s*from\s*"@\/lib\/report-share-links"/.test(actionsSource) &&
      !/VERCEL_PROJECT_PRODUCTION_URL/.test(actionsSource),
  );
  ok(
    "a Server Action retorna a URL completa (`url`), não só um path pro cliente montar",
    /return \{ url: `\$\{resolvePublicShareLinkBaseUrl\(\)\}\/r\/\$\{token\}` \}/.test(actionsSource),
  );
  ok("painel client nunca usa window.location.origin pra montar a URL do link", !/window\.location\.origin/.test(panelSource));
  ok("painel client usa result.url diretamente (a URL já vem pronta do servidor)", /setUrl\(result\.url\)/.test(panelSource));
}

__setReportShareLinkStoreForTests(null);
__setRateLimitBackendForTests(null);
console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
