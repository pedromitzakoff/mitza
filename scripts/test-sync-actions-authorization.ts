/**
 * Auditoria de Segurança — Security Regression Audit, Achado #1 (correção).
 * Atualizado quando o Stract foi descontinuado (ver
 * `docs/STRACT_INTEGRATION_ARCHITECTURE.md`): os cenários 5-8, que
 * auditavam `syncClientStractSourcesAction` (removida), passaram a auditar
 * `syncClientMetaApiSourcesAction` — mesma garantia de autorização, único
 * caminho de sincronização automática que resta.
 *
 * `syncClientMetaAction`/`syncClientStractSourcesAction` (a segunda, hoje
 * substituída por `syncClientMetaApiSourcesAction`) tratavam um SELECT
 * em `clients` como autorização — comentário antigo dizia "RLS garante que
 * o select só retorna o cliente se o usuário for admin ou gestor atribuído
 * a ele". Isso parou de ser verdade quando `supabase/operation-collaboration-rls.sql`
 * reabriu `clients_select` pra `auth.uid() is not null` (qualquer autenticado
 * lê qualquer cliente, deliberado, pra colaboração na Operação) — o SELECT
 * virou um no-op de autorização. A correção troca isso por
 * `requireClientManagerAccess(clientId)` (`lib/auth.ts`), que nunca dependeu
 * dessa policy: decide pelo CONTEÚDO de `client_managers`/
 * `clients.primary_manager_id` comparado com a identidade real de quem está
 * logado (admin sempre passa; gestor só passa se atribuído a ESTE cliente).
 *
 * Mesma limitação estrutural de `test-performance-report-auth.ts`: este
 * ambiente não tem sessão HTTP real (sem cookies de um browser, sem
 * Supabase) pra invocar as Server Actions fim-a-fim com um perfil real —
 * `requireClientManagerAccess`/`getCurrentProfile` dependem de
 * `next/headers` (cookies de request), que só existe dentro do runtime do
 * Next.js. Por isso a verificação abaixo é ESTRUTURAL (código-fonte), não
 * comportamental — ela confirma que a função certa é chamada, na ordem
 * certa, e que o padrão antigo (select-como-autorização) foi removido.
 *
 * Os 4 primeiros cenários pedidos (admin sincroniza qualquer cliente;
 * gestor atribuído sincroniza o próprio cliente; gestor não atribuído NÃO
 * consegue; usuário sem acesso NÃO consegue mesmo com SELECT liberado) são
 * exatamente a lógica que `requireClientManagerAccess` já implementa e já
 * usa em produção (`performance-actions.ts`, `account-review-actions.ts`)
 * — aqui confirmamos que as duas Server Actions do Achado #1 agora DELEGAM
 * pra essa mesma função (nunca reimplementam a checagem), o que herda essas
 * garantias por construção. Testar o comportamento interno de
 * `requireClientManagerAccess` propriamente (com um Supabase real) fica
 * fora do escopo desta correção — ela já é código existente, não alterado
 * aqui, e usado em produção há mais tempo que este Achado.
 *
 * Rodar: npx tsx scripts/test-sync-actions-authorization.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

const metaSource = loadSource("src", "app", "clients", "meta-actions.ts");
// Stract foi descontinuado (ver docs/STRACT_INTEGRATION_ARCHITECTURE.md) —
// `stract-sync-actions.ts` foi removido; os cenários 5-8 abaixo, que
// auditavam essa action, passaram a auditar `syncClientMetaApiSourcesAction`
// (`meta-api-sync-actions.ts`), o único caminho de sincronização automática
// que resta.
const metaApiSyncSource = loadSource("src", "app", "clients", "meta-api-sync-actions.ts");

console.log("\n1 — syncClientMetaAction: autorização explícita via requireClientManagerAccess\n");
{
  ok('importa requireClientManagerAccess de "@/lib/auth"', /import\s*\{\s*requireClientManagerAccess\s*\}\s*from\s*"@\/lib\/auth"/.test(metaSource));
  ok("chama requireClientManagerAccess(clientId) dentro da action", /await requireClientManagerAccess\(clientId\)/.test(metaSource));
  ok(
    "cenários admin/gestor-atribuído/gestor-não-atribuído/sem-acesso são herdados de requireClientManagerAccess — nunca reimplementados aqui",
    !/is_admin|isAdmin|profile\.role/.test(stripComments(metaSource)),
  );
}

console.log("\n2 — syncClientMetaAction: o SELECT em `clients` como autorização foi removido\n");
{
  const code = stripComments(metaSource);
  ok('não importa mais queryOrError (padrão antigo "clients:access-check")', !/queryOrError/.test(code));
  ok('não existe mais nenhum .from("clients").select(...) nesta action', !/\.from\("clients"\)/.test(code));
  ok(
    "o comentário antigo, que afirmava (como fato vigente) que o SELECT era a checagem de acesso, não existe mais",
    !/a checagem de acesso é essa/.test(metaSource),
  );
}

console.log("\n3 — syncClientMetaAction: service role (via syncClientMetaSpend) só é alcançado DEPOIS da autorização\n");
{
  const idxAuth = metaSource.indexOf("await requireClientManagerAccess(clientId)");
  const idxSync = metaSource.indexOf("await syncClientMetaSpend(clientId)");
  ok("requireClientManagerAccess() aparece no código", idxAuth !== -1);
  ok("syncClientMetaSpend() aparece no código", idxSync !== -1);
  ok("requireClientManagerAccess() está ANTES de syncClientMetaSpend() (nunca depois)", idxAuth < idxSync);
}

console.log("\n4 — syncClientMetaAction: cliente inexistente continua um caminho seguro (erro tratado, nunca um crash cru)\n");
{
  ok("a chamada ao sync continua dentro de um try/catch", /try\s*\{[\s\S]*await syncClientMetaSpend\(clientId\)[\s\S]*\}\s*catch/.test(metaSource));
  ok("erro do sync (inclusive 'cliente não encontrado', lançado por syncClientMetaSpend) vira mensagem segura via toUserFacingError", /toUserFacingError\(err,/.test(metaSource));
}

console.log("\n5 — syncClientMetaApiSourcesAction: mesma autorização explícita via requireClientManagerAccess\n");
{
  ok('importa requireClientManagerAccess de "@/lib/auth"', /import\s*\{\s*requireClientManagerAccess\s*\}\s*from\s*"@\/lib\/auth"/.test(metaApiSyncSource));
  ok("chama requireClientManagerAccess(clientId) dentro da action", /await requireClientManagerAccess\(clientId\)/.test(metaApiSyncSource));
}

console.log("\n6 — syncClientMetaApiSourcesAction: nunca usou SELECT em `clients` como autorização\n");
{
  const code = stripComments(metaApiSyncSource);
  ok('não importa queryOrError (padrão antigo "clients:access-check")', !/queryOrError/.test(code));
  ok('não existe nenhum .from("clients").select(...) nesta action', !/\.from\("clients"\)/.test(code));
}

console.log("\n7 — syncClientMetaApiSourcesAction: service role (via syncOneMetaApiAccount) só é alcançado DEPOIS da autorização\n");
{
  const idxAuth = metaApiSyncSource.indexOf("await requireClientManagerAccess(clientId)");
  const idxImportSources = metaApiSyncSource.indexOf('.from("import_sources")');
  const idxSync = metaApiSyncSource.indexOf("syncOneMetaApiAccount(accountId)");
  ok("requireClientManagerAccess() aparece no código", idxAuth !== -1);
  ok('.from("import_sources") aparece no código', idxImportSources !== -1);
  ok("syncOneMetaApiAccount() aparece no código", idxSync !== -1);
  ok('requireClientManagerAccess() está ANTES de .from("import_sources") (nunca depois)', idxAuth < idxImportSources);
  ok("requireClientManagerAccess() está ANTES de syncOneMetaApiAccount() (nunca depois)", idxAuth < idxSync);
}

console.log("\n8 — as duas actions continuam funcionalmente idênticas depois da autorização passar (nenhuma lógica de sync foi alterada)\n");
{
  ok("syncClientMetaAction ainda revalida /clients/[id] e redireciona com synced=N/error=", /revalidatePath\(`\/clients\/\$\{clientId\}`\)/.test(metaSource) && /synced=\$\{result\.daysSynced\}/.test(metaSource));
  ok(
    "syncClientMetaApiSourcesAction ainda soma falhas por conta e preserva a mensagem de 'nenhuma conta ativa'",
    /Este cliente não tem nenhuma conta de busca direta na Meta ativa pra sincronizar\./.test(metaApiSyncSource) && /failedCount/.test(metaApiSyncSource),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
