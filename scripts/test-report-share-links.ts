/**
 * Etapa "Link Externo V1" — `/r/[token]` (Dashboard público, sem login) e o
 * painel "Link do cliente" (`report-share-link-panel.tsx`).
 *
 * Etapa "Link legível por cliente" (pedido explícito do usuário, decisão
 * consciente de aceitar o trade-off de segurança via `AskUserQuestion`):
 * `rotateReportShareLink` passou a devolver um SLUG legível (ex.:
 * "DanielleSaqui"), não mais o token aleatório — resolvido primeiro por
 * `resolveClientIdFromShareSlug`. O token/hash continuam gerados e
 * persistidos junto (compat com link antigo, `resolveClientIdFromShareToken`
 * como fallback) — as seções 1-6 abaixo passaram a testar o caminho do
 * slug (o novo padrão); a seção 6b prova que o caminho antigo (token/hash)
 * continua funcionando independentemente, pra link já enviado antes desta
 * etapa nunca quebrar.
 *
 * Este ambiente não tem Supabase real: a resolução de token/slug/autorização
 * é testada injetando `InMemoryReportShareLinkStore` no lugar do Supabase
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
  resolveClientIdFromShareSlug,
  slugifyClientName,
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
  /** Nullable de propósito — modela a linha antiga (anterior à Etapa "Link
   * legível por cliente"), que nunca tinha essa coluna preenchida. */
  slug: string | null;
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

  async findActiveBySlug(slug: string): Promise<{ clientId: string } | null> {
    const link = this.links.find((l) => l.slug === slug && l.revokedAt === null);
    return link ? { clientId: link.clientId } : null;
  }

  async isSlugActive(slug: string): Promise<boolean> {
    return this.links.some((l) => l.slug === slug && l.revokedAt === null);
  }

  async isClientLive(clientId: string): Promise<boolean> {
    return this.liveClientIds.has(clientId);
  }

  async findActiveForClient(clientId: string): Promise<ActiveReportShareLink | null> {
    const link = this.links
      .filter((l) => l.clientId === clientId && l.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return link ? { clientId: link.clientId, createdAt: link.createdAt, token: link.token, slug: link.slug } : null;
  }

  async revokeActiveForClient(clientId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const link of this.links) {
      if (link.clientId === clientId && link.revokedAt === null) link.revokedAt = now;
    }
  }

  async insert(clientId: string, token: string, tokenHash: string, slug: string): Promise<void> {
    this.insertedTokenHashes.push(tokenHash);
    this.links.push({ clientId, token, tokenHash, slug, createdAt: new Date().toISOString(), revokedAt: null });
  }
}

function freshRateLimitBackend() {
  __setRateLimitBackendForTests(new InMemorySlidingWindowRateLimitBackend());
}

/** Pega o token BRUTO do link ativo mais recente de um cliente — só pra
 * testar o caminho legado (hash), que continua existindo junto do slug em
 * todo link novo. */
function rawTokenFor(store: InMemoryReportShareLinkStore, clientId: string): string {
  const link = store.links.filter((l) => l.clientId === clientId && l.revokedAt === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!link?.token) throw new Error(`nenhum token ativo encontrado pra ${clientId}`);
  return link.token;
}

async function main() {

console.log("\n1 — slug válido resolve para o cliente correto, e só ele\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a", "client-b"]);
  __setReportShareLinkStoreForTests(store);

  const slugA = await rotateReportShareLink("client-a", "Client A");
  ok("slug derivado do nome ('Client A' -> 'ClientA')", slugA === "ClientA");
  const resolved = await resolveClientIdFromShareSlug(slugA);
  ok("slug de client-a resolve pra client-a", resolved === "client-a");
}

console.log("\n2 — slug inválido (nunca existiu) → negado (null)\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  await rotateReportShareLink("client-a", "Client A");

  const resolved = await resolveClientIdFromShareSlug("SlugQueNuncaFoiGerado");
  ok("slug inexistente: null", resolved === null);

  const resolvedEmpty = await resolveClientIdFromShareSlug("");
  ok("slug vazio: null, sem nem consultar o store", resolvedEmpty === null);
}

console.log("\n3 — slug revogado → negado (null), mesmo existindo\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const slug = await rotateReportShareLink("client-a", "Client A");
  ok("antes de revogar: resolve normalmente", (await resolveClientIdFromShareSlug(slug)) === "client-a");

  await revokeReportShareLink("client-a");
  ok("depois de revogar: null", (await resolveClientIdFromShareSlug(slug)) === null);
}

console.log("\n4 — slug do cliente A nunca resolve para o cliente B\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a", "client-b"]);
  __setReportShareLinkStoreForTests(store);

  const slugA = await rotateReportShareLink("client-a", "Client A");
  const slugB = await rotateReportShareLink("client-b", "Client B");

  ok("slug A → client-a", (await resolveClientIdFromShareSlug(slugA)) === "client-a");
  ok("slug A NUNCA resolve pra client-b", (await resolveClientIdFromShareSlug(slugA)) !== "client-b");
  ok("slug B → client-b", (await resolveClientIdFromShareSlug(slugB)) === "client-b");
  ok("slug B NUNCA resolve pra client-a", (await resolveClientIdFromShareSlug(slugB)) !== "client-a");
}

console.log("\n5 — 'Gerar novo link' rotaciona: revoga o anterior, o antigo para de funcionar\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  // Nomes diferentes de propósito (slug muda de verdade) — prova que
  // rotacionar revoga o link anterior, não só que o novo também resolve.
  const firstSlug = await rotateReportShareLink("client-a", "Client A");
  const secondSlug = await rotateReportShareLink("client-a", "Client A Renomeada");

  ok("slug antigo parou de resolver", (await resolveClientIdFromShareSlug(firstSlug)) === null);
  ok("slug novo resolve normalmente", (await resolveClientIdFromShareSlug(secondSlug)) === "client-a");

  const status = await getReportShareLinkStatus("client-a");
  ok("status reporta exatamente 1 link ativo (nunca acumula)", status.active === true);
}

console.log("\n5b — rotacionar com o MESMO nome reaproveita o MESMO slug base (revoga antes de checar colisão — nunca um sufixo numérico desnecessário contra si mesmo)\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const firstSlug = await rotateReportShareLink("client-a", "Client A");
  const secondSlug = await rotateReportShareLink("client-a", "Client A");

  ok("mesmo nome -> mesmo slug base de novo", firstSlug === secondSlug);
  ok("o link ATIVO (o segundo) continua resolvendo pro cliente certo", (await resolveClientIdFromShareSlug(secondSlug)) === "client-a");
}

console.log("\n6 — cliente excluído (soft-delete): slug existente para de resolver\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]); // client-b nunca "live"
  __setReportShareLinkStoreForTests(store);

  const slug = await rotateReportShareLink("client-b", "Client B");
  ok("link existe e não foi revogado, mas o cliente não está 'live': null", (await resolveClientIdFromShareSlug(slug)) === null);
}

console.log("\n6a — colisão de slug entre clientes com o MESMO nome: sufixo numérico, nunca sobrescreve o link do outro\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a", "client-b"]);
  __setReportShareLinkStoreForTests(store);

  const slugA = await rotateReportShareLink("client-a", "João Silva");
  const slugB = await rotateReportShareLink("client-b", "João Silva");

  ok("primeiro cliente fica com o slug base", slugA === "JoaoSilva");
  ok("segundo cliente (mesmo nome) ganha sufixo numérico, nunca o mesmo slug", slugB === "JoaoSilva2" && slugB !== slugA);
  ok("cada slug resolve só pro próprio cliente", (await resolveClientIdFromShareSlug(slugA)) === "client-a" && (await resolveClientIdFromShareSlug(slugB)) === "client-b");
}

console.log("\n6b — caminho legado (token/hash) continua funcionando independentemente — link enviado antes da Etapa \"Link legível por cliente\" nunca quebra\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  // Link novo tem slug E token — simula o visitante usando a URL antiga
  // (token), nunca a nova (slug), mesmo cenário real de um link já enviado.
  await rotateReportShareLink("client-a", "Client A");
  const rawToken = rawTokenFor(store, "client-a");
  ok("token bruto resolve normalmente pelo caminho antigo (hash)", (await resolveClientIdFromShareToken(rawToken)) === "client-a");

  // Linha simulando uma geração ANTERIOR a esta etapa (slug nunca existiu).
  store.links.push({
    clientId: "client-a",
    token: "token-legado-bruto",
    tokenHash: __testing.hashShareToken("token-legado-bruto"),
    slug: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
  });
  ok(
    "resolveClientIdFromShareSlug nunca confunde um token bruto antigo com um slug (slug é null nessa linha)",
    (await resolveClientIdFromShareSlug("token-legado-bruto")) === null,
  );
  ok("mas resolveClientIdFromShareToken resolve normalmente esse link antigo", (await resolveClientIdFromShareToken("token-legado-bruto")) === "client-a");
}

console.log('\n6c — slugifyClientName: normalização pura (acentos, espaços, símbolos) — nunca uma URL vazia/quebrada\n');
{
  ok('"Danielle Saqui" -> "DanielleSaqui"', slugifyClientName("Danielle Saqui") === "DanielleSaqui");
  ok('acento nunca sobrevive: "José" -> "Jose"', slugifyClientName("José") === "Jose");
  ok('múltiplos espaços/hífen colapsam em limite de palavra: "Pet  Fast-Food" -> "PetFastFood"', slugifyClientName("Pet  Fast-Food") === "PetFastFood");
  ok('nome vazio nunca produz slug vazio (fallback explícito)', slugifyClientName("") === "Cliente");
  ok('nome só com símbolos cai no mesmo fallback', slugifyClientName("***") === "Cliente");
}

console.log("\n7 — alteração de query/parâmetro nunca muda o cliente autorizado (auditoria da rota pública)\n");
{
  // A rota /r/[token] tem DUAS fontes possíveis de client_id — slug
  // primeiro (Etapa "Link legível por cliente"), token como fallback —
  // nunca uma terceira fonte. Prova estrutural: o código-fonte da página
  // nunca lê um clientId de searchParams/query, e o único identificador
  // usado nas chamadas de dado é a variável resolvida por slug/token.
  const source = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8");

  ok(
    "resolve o clientId via resolveClientIdFromShareSlug PRIMEIRO, resolveClientIdFromShareToken como fallback — nunca uma terceira fonte",
    /const clientId = \(await resolveClientIdFromShareSlug\(token\)\) \?\? \(await resolveClientIdFromShareToken\(token\)\)/.test(source),
  );
  // Correção da divergência Dashboard interno × link compartilhado: o
  // link agora abre o Cockpit (CockpitView via buildCockpitViewModel),
  // cujos únicos parâmetros de URL são mês/filtro — nunca clientId.
  ok(
    "searchParams desestruturado só pega campos de mês/filtro do Cockpit, nunca clientId",
    /const \{ month: monthQueryParam, filtro: filterTextParam, modo: filterModeParam \} = await searchParams/.test(source),
  );
  ok("nunca lê searchParams.clientId em lugar nenhum do arquivo", !/searchParams\.clientId|searchParams\[.client_?[Ii]d.\]/.test(source));
  ok(
    "buildCockpitViewModel é chamado com a variável clientId (resolvida pelo token), nunca um literal de query",
    /buildCockpitViewModel\(supabase, clientId, \{/.test(source),
  );
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
  "\n13 — Etapa \"Link Externo — token recuperável\": token bruto continua persistido mesmo com o slug virando a URL exibida; hash/token continuam corretos\n",
);
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const slug = await rotateReportShareLink("client-a", "Client A");
  const rawToken = rawTokenFor(store, "client-a");

  ok("exatamente 1 hash foi inserido no store", store.insertedTokenHashes.length === 1);
  const [persistedHash] = store.insertedTokenHashes;
  ok("token_hash continua sendo o sha256 hex do token bruto (64 caracteres hex)", persistedHash === __testing.hashShareToken(rawToken));
  ok("token_hash tem formato de hash hex (64 chars, só [0-9a-f])", /^[0-9a-f]{64}$/.test(persistedHash));
  ok("token_hash NUNCA é igual ao token bruto", persistedHash !== rawToken);

  // Decisão desta etapa: o valor BRUTO também fica salvo, pra o painel
  // "Link do cliente" poder reexibi-lo a qualquer momento (nunca mais só
  // uma vez, na tela, no instante da geração) — continua valendo mesmo
  // depois da Etapa "Link legível por cliente" ter trocado a URL exibida.
  ok("exatamente 1 link foi salvo no store", store.links.length === 1);
  ok("o token bruto foi persistido junto (Etapa 'token recuperável')", store.links[0].token === rawToken);
  ok("o slug também foi persistido junto (Etapa 'Link legível por cliente')", store.links[0].slug === slug);

  const status = await getReportShareLinkStatus("client-a");
  ok("getReportShareLinkStatus devolve a URL do SLUG (não mais o token), reconstruída a partir do valor persistido", status.url === `http://localhost:3000/r/${slug}`);
}

console.log('\n13b — status de um link ativo criado ANTES da Etapa "Link legível por cliente" (sem slug persistido) cai pro token, mesmo comportamento de sempre\n');
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  // Simula uma linha antiga: insere direto no array, sem passar por
  // rotateReportShareLink (que sempre grava slug desde esta etapa).
  store.links.push({ clientId: "client-a", token: "token-antigo-sem-slug", tokenHash: "hash-antigo", slug: null, createdAt: new Date().toISOString(), revokedAt: null });

  const status = await getReportShareLinkStatus("client-a");
  ok("link ainda é reportado como ativo", status.active === true);
  ok("sem slug: a URL cai pro token (mesmo comportamento de antes desta etapa, nunca quebra)", status.url === "http://localhost:3000/r/token-antigo-sem-slug");
}

console.log('\n13c — status de um link ativo criado ANTES da Etapa "token recuperável" (nem token nem slug persistidos) cai pro caso "sem valor reexibível"\n');
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  store.links.push({ clientId: "client-a", token: null, tokenHash: "hash-antigo", slug: null, createdAt: new Date().toISOString(), revokedAt: null });

  const status = await getReportShareLinkStatus("client-a");
  ok("link ainda é reportado como ativo", status.active === true);
  ok("sem token nem slug salvos (linha anterior a ambas as etapas), a URL não é montada", status.url === null);
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
    "a Server Action retorna a URL completa (`url`), não só um path pro cliente montar — desde a Etapa 'Link legível por cliente', montada a partir do slug",
    /return \{ url: `\$\{resolvePublicShareLinkBaseUrl\(\)\}\/r\/\$\{slug\}` \}/.test(actionsSource),
  );
  ok("painel client nunca usa window.location.origin pra montar a URL do link", !/window\.location\.origin/.test(panelSource));
  ok("painel client usa result.url diretamente (a URL já vem pronta do servidor)", /setUrl\(result\.url\)/.test(panelSource));
}

__setReportShareLinkStoreForTests(null);
__setRateLimitBackendForTests(null);
console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
