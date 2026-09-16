/**
 * Etapa "Copiar link do cliente no Relatório" — `/clients/[id]/relatorio`
 * ganha uma ação secundária "Copiar link do cliente" no header (Período →
 * Copiar link do cliente → Baixar PDF), reaproveitando 100% a infra já
 * existente do link público (`lib/report-share-links.ts` +
 * `report-share-link-actions.ts`, MESMA usada pelo painel "Link do cliente"
 * em `account-info-drawer.tsx`) — nenhuma segunda infraestrutura de
 * compartilhamento, nenhum token/URL construído fora dessa camada.
 *
 * Este ambiente não tem Supabase real nem DOM/React renderizável — a
 * cobertura combina:
 * 1. Dinâmico: `getReportShareLinkStatus`/`rotateReportShareLink` com o
 *    store em memória já usado por `test-report-share-links.ts`, provando
 *    que a URL que a página passaria como `initialUrl` é sempre a MESMA
 *    reconstruída pela lib central (nunca um valor derivado de `clientId`).
 * 2. Estrutural: checagens sobre o código-fonte de `copy-report-link-button.tsx`,
 *    `report-header.tsx`, `[id]/relatorio/page.tsx` e `r/[token]/page.tsx` —
 *    mesmo padrão já usado pela seção 7/15/16 de `test-report-share-links.ts`
 *    pra auditar coisas que não dependem de DOM (import, ordem de props,
 *    quem chama o quê).
 *
 * Rodar: npx tsx scripts/test-copy-report-link-button.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getReportShareLinkStatus,
  rotateReportShareLink,
  __setReportShareLinkStoreForTests,
  type ReportShareLinkStore,
  type ActiveReportShareLink,
} from "../src/lib/report-share-links";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

interface StoredLink {
  clientId: string;
  token: string | null;
  tokenHash: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Mesmo dublê em memória de `test-report-share-links.ts` — nunca toca
 * Supabase/rede. */
class InMemoryReportShareLinkStore implements ReportShareLinkStore {
  links: StoredLink[] = [];
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
    this.links.push({ clientId, token, tokenHash, createdAt: new Date().toISOString(), revokedAt: null });
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

async function main() {

console.log('\n1 — sem link ativo, "initialUrl" que a página passaria é null (nunca um placeholder derivado de clientId)\n');
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const status = await getReportShareLinkStatus("client-a");
  ok("sem link ativo: active=false", status.active === false);
  ok("sem link ativo: url=null (o botão decide gerar, nunca inventa um valor)", status.url === null);
}

console.log('\n2 — com link ativo, "initialUrl" é a MESMA URL pública reconstruída pela lib central (nunca client-side)\n');
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);

  const token = await rotateReportShareLink("client-a");
  const status = await getReportShareLinkStatus("client-a");

  ok("status.active === true", status.active === true);
  ok("status.url é a URL completa com o token (nunca client-a/clientId em lugar do token)", status.url === `http://localhost:3000/r/${token}`);
  ok("status.url nunca contém o clientId literal", !status.url?.includes("client-a"));
}

console.log("\n3 — depois de revogado, initialUrl volta a ser null (mesmo estado 'sem link ativo' de antes de gerar)\n");
{
  const store = new InMemoryReportShareLinkStore(["client-a"]);
  __setReportShareLinkStoreForTests(store);
  await rotateReportShareLink("client-a");
  await store.revokeActiveForClient("client-a");

  const status = await getReportShareLinkStatus("client-a");
  ok("revogado: active=false", status.active === false);
  ok("revogado: url=null", status.url === null);
}

__setReportShareLinkStoreForTests(null);

const buttonSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "copy-report-link-button.tsx"), "utf8"));
const headerSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-header.tsx"), "utf8"));
const relatorioPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "page.tsx"), "utf8"));
const publicPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8"));
const shareLinksLibSource = readFileSync(join(__dirname, "..", "src", "lib", "report-share-links.ts"), "utf8");

console.log("\n4 — CopyReportLinkButton reaproveita a Server Action canônica, nunca uma segunda infra de token\n");
{
  ok("é 'use client'", buttonSource.trimStart().startsWith('"use client"'));
  ok(
    "importa generateReportShareLinkAction do arquivo canônico (mesmo usado pelo painel do drawer)",
    /import \{ generateReportShareLinkAction \} from "@\/app\/clients\/report-share-link-actions"/.test(buttonSource),
  );
  ok("nunca importa lib/report-share-links diretamente (só via Server Action)", !/lib\/report-share-links/.test(buttonSource));
  ok("nunca importa lib/supabase/admin", !/lib\/supabase\/admin/.test(buttonSource));
  ok("nunca referencia SUPABASE_SERVICE_ROLE_KEY", !/SUPABASE_SERVICE_ROLE_KEY/.test(buttonSource));
  ok("nunca reimplementa hash/randomBytes/token — nenhuma lógica de geração própria", !/randomBytes|createHash|base64url/.test(buttonSource));
  ok(
    "nunca duplica a checagem de admin (confia só no que a própria Server Action já impõe)",
    !/role\s*[!=]==?\s*["']admin["']/.test(buttonSource),
  );
}

console.log("\n5 — copia sempre o link público seguro (nunca a URL interna /clients/[id]/relatorio, nunca clientId como token)\n");
{
  ok("usa navigator.clipboard.writeText", /navigator\.clipboard\.writeText/.test(buttonSource));
  ok(
    "o valor copiado vem sempre de url/result.url (nunca de um literal /clients/.../relatorio)",
    /writeText\(value\)/.test(buttonSource) && !/writeText\([^)]*relatorio/.test(buttonSource),
  );
  ok(
    "nunca contém a URL interna do relatório (/relatorio) — só importa a Server Action, nunca constrói essa rota",
    !/\/relatorio/.test(buttonSource),
  );
  ok("nunca monta uma string concatenando clientId numa URL (ex.: `/r/${clientId}` ou similar)", !/\/r\/\$\{?\s*clientId/.test(buttonSource));
  ok(
    "clientId só é usado como argumento da Server Action, nunca interpolado em string",
    /generateReportShareLinkAction\(clientId\)/.test(buttonSource) && !/`[^`]*\$\{clientId\}[^`]*`/.test(buttonSource),
  );
  ok("a URL gerada (result.url) é usada tal como a Server Action devolve, nunca reconstruída aqui", /setUrl\(result\.url\)/.test(buttonSource));
}

console.log("\n6 — estado sem link ativo: o próprio clique gera (fluxo canônico), nunca gera silenciosamente fora de um clique\n");
{
  ok("useState(initialUrl) — parte do valor já resolvido pela página (getReportShareLinkStatus)", /useState\(initialUrl\)/.test(buttonSource));
  ok(
    "só chama generateReportShareLinkAction dentro do handler de clique (if (url) copia; senão gera)",
    /function handleClick\(\)\s*\{[\s\S]*if \(url\)[\s\S]*generateReportShareLinkAction\(clientId\)/.test(buttonSource),
  );
  ok("nenhum useEffect chama generateReportShareLinkAction automaticamente (sem geração fora do clique)", !/useEffect[\s\S]*generateReportShareLinkAction/.test(buttonSource));
  ok("erro da Server Action (ex.: gestor sem permissão) é surfaced, nunca engolido", /if \("error" in result\)[\s\S]*setError\(result\.error\)/.test(buttonSource));
}

console.log('\n7 — feedback "Link copiado" funciona e reverte pro rótulo padrão\n');
{
  ok('rótulo padrão é exatamente "Copiar link do cliente"', /const DEFAULT_LABEL = "Copiar link do cliente"/.test(buttonSource));
  ok('rótulo de sucesso é exatamente "Link copiado"', /const COPIED_LABEL = "Link copiado"/.test(buttonSource));
  ok("depois de copiar, o rótulo muda pra COPIED_LABEL", /setLabel\(COPIED_LABEL\)/.test(buttonSource));
  ok("setTimeout reverte pro DEFAULT_LABEL (feedback é temporário, não permanente)", /setTimeout\(\(\) => setLabel\(DEFAULT_LABEL\), 2000\)/.test(buttonSource));
}

console.log("\n8 — ReportHeader: ordem Período → Copiar link do cliente → Baixar PDF, e continua opcional (público nunca recebe)\n");
{
  const periodIdx = headerSource.indexOf("{periodControl}");
  const copyIdx = headerSource.indexOf("{copyLinkControl}");
  const pdfIdx = headerSource.indexOf("Baixar PDF");
  ok("periodControl aparece antes de copyLinkControl no JSX", periodIdx !== -1 && copyIdx !== -1 && periodIdx < copyIdx);
  ok("copyLinkControl aparece antes do botão Baixar PDF no JSX", copyIdx !== -1 && pdfIdx !== -1 && copyIdx < pdfIdx);
  ok("copyLinkControl é uma prop opcional (React.ReactNode)", /copyLinkControl\?: React\.ReactNode/.test(headerSource));
  ok("Baixar PDF continua condicionado a pdfHref, comportamento intocado", /\{pdfHref && \(/.test(headerSource));
}

console.log("\n9 — página interna do relatório: reaproveita getReportShareLinkStatus, nunca cria/hasheia token próprio\n");
{
  ok(
    "importa getReportShareLinkStatus da lib central (mesma usada em [id]/page.tsx)",
    /import \{ getReportShareLinkStatus \} from "@\/lib\/report-share-links"/.test(relatorioPageSource),
  );
  ok("importa CopyReportLinkButton do arquivo novo", /import \{ CopyReportLinkButton \} from "\.\/copy-report-link-button"/.test(relatorioPageSource));
  ok(
    "passa clientId real (client.id) e initialUrl vindo do status, nunca um valor inventado",
    /<CopyReportLinkButton clientId=\{client\.id\} initialUrl=\{reportShareLinkStatus\.url\} \/>/.test(relatorioPageSource),
  );
  ok("nunca importa lib/supabase/admin direto na página (Server Component RLS normal)", !/lib\/supabase\/admin/.test(relatorioPageSource));
  ok("nunca reimplementa geração de token (randomBytes/createHash) nesta página", !/randomBytes|createHash/.test(relatorioPageSource));
}

console.log("\n10 — rota pública /r/[token] nunca ganha o botão de copiar (ela não copia a si mesma)\n");
{
  ok("ReportHeader em /r/[token] nunca recebe copyLinkControl", !/copyLinkControl/.test(publicPageSource));
  ok("/r/[token] nunca importa CopyReportLinkButton", !/CopyReportLinkButton/.test(publicPageSource));
  ok("/r/[token] continua sem pdfHref (fora de escopo, comportamento preexistente intocado)", !/pdfHref/.test(publicPageSource));
}

console.log("\n11 — o núcleo do token (lib/report-share-links.ts) não foi alterado por esta etapa: mesmas garantias de sempre\n");
{
  ok("token_hash continua sendo sha256 (nunca o valor bruto usado pra resolver)", /createHash\("sha256"\)/.test(shareLinksLibSource));
  ok("resolveClientIdFromShareToken continua a única fonte de verdade de client_id por token", /export async function resolveClientIdFromShareToken/.test(shareLinksLibSource));
  ok("rotateReportShareLink continua revogando o anterior antes de inserir o novo", /await store\.revokeActiveForClient\(clientId\);\s*\n\s*const token = generateShareToken\(\);/.test(shareLinksLibSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
