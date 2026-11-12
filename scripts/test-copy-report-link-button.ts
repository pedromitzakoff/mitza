/**
 * Etapa "Copiar link do cliente no Relatório" — `/clients/[id]/relatorio`
 * ganhou uma ação secundária "Copiar link do cliente" no header, reaproveitando
 * 100% a infra já existente do link público (`lib/report-share-links.ts` +
 * `report-share-link-actions.ts`, MESMA usada pelo painel "Link do cliente"
 * em `account-info-drawer.tsx`) — nenhuma segunda infraestrutura de
 * compartilhamento, nenhum token/URL construído fora dessa camada.
 *
 * Correção da divergência Dashboard interno × link compartilhado (rodada
 * posterior a esta etapa, pedido explícito do usuário): `/r/[token]` deixou
 * de abrir o Relatório de Performance — passou a abrir o Cockpit
 * (`CockpitView`), pra nunca mais divergir visualmente da versão interna da
 * agência. Como consequência direta, o botão duplicado "Copiar link do
 * cliente" saiu do header do Relatório (decisão explícita: "mover para o
 * Dashboard" em vez de manter dois lugares pra copiar o MESMO link) —
 * `copy-report-link-button.tsx` foi deletado; o painel "Compartilhamento"
 * de `account-info-drawer.tsx` (já visível no cabeçalho de QUALQUER rota do
 * cliente, incluindo o Cockpit) continua sendo o único ponto de
 * geração/cópia do link, sem nenhuma segunda implementação.
 *
 * Este ambiente não tem Supabase real nem DOM/React renderizável — a
 * cobertura combina:
 * 1. Dinâmico: `getReportShareLinkStatus`/`rotateReportShareLink` com o
 *    store em memória já usado por `test-report-share-links.ts` (a lib
 *    central nunca mudou por essa correção).
 * 2. Estrutural: checagens sobre o código-fonte de `report-header.tsx`,
 *    `[id]/relatorio/page.tsx`, `r/[token]/page.tsx` e
 *    `account-info-drawer.tsx` — mesmo padrão já usado pela seção 7/15/16
 *    de `test-report-share-links.ts` pra auditar coisas que não dependem
 *    de DOM (import, ordem de props, quem chama o quê).
 *
 * Rodar: npx tsx scripts/test-copy-report-link-button.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

const headerSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-header.tsx"), "utf8"));
const relatorioPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "page.tsx"), "utf8"));
const publicPageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8"));
const drawerSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "account-info-drawer.tsx"), "utf8"));
const shareLinksLibSource = readFileSync(join(__dirname, "..", "src", "lib", "report-share-links.ts"), "utf8");

console.log("\n4 — copy-report-link-button.tsx foi deletado (decisão explícita: mover o compartilhamento pro Dashboard, nunca duplicar)\n");
{
  ok(
    "o arquivo não existe mais no disco",
    !existsSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "copy-report-link-button.tsx")),
  );
  ok("nenhum arquivo do projeto importa mais CopyReportLinkButton", !/CopyReportLinkButton/.test(headerSource + relatorioPageSource + publicPageSource));
}

console.log("\n8 — ReportHeader: 'copyLinkControl' saiu por completo (o Relatório não é mais o que é compartilhado)\n");
{
  ok("copyLinkControl não existe mais como prop", !/copyLinkControl/.test(headerSource));
  ok("Baixar PDF continua condicionado a pdfHref, comportamento intocado", /\{pdfHref && \(/.test(headerSource));
  ok("ordem Período → Baixar PDF preservada (sem o botão de copiar link no meio)", headerSource.indexOf("{periodControl}") < headerSource.indexOf("Baixar PDF"));
}

console.log("\n9 — página interna do relatório: não busca/renderiza mais status de link nenhum (ação saiu daqui)\n");
{
  ok("não importa mais getReportShareLinkStatus (saiu junto com o botão)", !/getReportShareLinkStatus/.test(relatorioPageSource));
  ok("não importa mais CopyReportLinkButton", !/CopyReportLinkButton/.test(relatorioPageSource));
  ok("nunca importa lib/supabase/admin direto na página (Server Component RLS normal)", !/lib\/supabase\/admin/.test(relatorioPageSource));
}

console.log("\n10 — o painel 'Compartilhamento' (account-info-drawer.tsx) é agora o ÚNICO ponto de geração/cópia do link, com a descrição correta (Dashboard, não Relatório)\n");
{
  ok(
    "o drawer (visível no cabeçalho de QUALQUER rota do cliente, incluindo o Cockpit) continua usando ReportShareLinkPanel — mesma infra de sempre, nenhuma segunda implementação",
    /<ReportShareLinkPanel/.test(drawerSource),
  );
  ok(
    "a descrição do painel não menciona mais 'Relatório de Performance' — o link agora abre o Dashboard",
    !/Relatório de Performance/.test(drawerSource) && /Dashboard/.test(drawerSource),
  );
  ok("rota pública /r/[token] renderiza o Cockpit (CockpitView), nunca mais ReportHeader/ReportBody/pdfHref", /CockpitView/.test(publicPageSource) && !/ReportHeader|ReportBody|pdfHref/.test(publicPageSource));
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
