/**
 * Auditoria de Segurança — Security Regression Audit, Achado #1 (correção):
 * `syncClientMetaAction`/`syncClientStractSourcesAction` tratavam um SELECT
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
const stractSource = loadSource("src", "app", "clients", "stract-sync-actions.ts");

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

console.log("\n5 — syncClientStractSourcesAction: mesma autorização explícita via requireClientManagerAccess\n");
{
  ok('importa requireClientManagerAccess de "@/lib/auth"', /import\s*\{\s*requireClientManagerAccess\s*\}\s*from\s*"@\/lib\/auth"/.test(stractSource));
  ok("chama requireClientManagerAccess(clientId) dentro da action", /await requireClientManagerAccess\(clientId\)/.test(stractSource));
}

console.log("\n6 — syncClientStractSourcesAction: o SELECT em `clients` como autorização foi removido\n");
{
  const code = stripComments(stractSource);
  ok('não importa mais queryOrError (padrão antigo "clients:access-check")', !/queryOrError/.test(code));
  ok('não existe mais nenhum .from("clients").select(...) nesta action', !/\.from\("clients"\)/.test(code));
}

console.log("\n7 — syncClientStractSourcesAction: service role (via runImportForSource) só é alcançado DEPOIS da autorização\n");
{
  const idxAuth = stractSource.indexOf("await requireClientManagerAccess(clientId)");
  const idxImport = stractSource.indexOf("getEnabledImportSourceIdsForClient(supabase, clientId)");
  const idxRun = stractSource.indexOf("runImportForSource(importSourceId)");
  ok("requireClientManagerAccess() aparece no código", idxAuth !== -1);
  ok("getEnabledImportSourceIdsForClient() aparece no código", idxImport !== -1);
  ok("runImportForSource() aparece no código", idxRun !== -1);
  ok("requireClientManagerAccess() está ANTES de getEnabledImportSourceIdsForClient() (nunca depois)", idxAuth < idxImport);
  ok("requireClientManagerAccess() está ANTES de runImportForSource() (nunca depois)", idxAuth < idxRun);
}

console.log("\n8 — as duas actions continuam funcionalmente idênticas depois da autorização passar (nenhuma lógica de sync foi alterada)\n");
{
  ok("syncClientMetaAction ainda revalida /clients/[id] e redireciona com synced=N/error=", /revalidatePath\(`\/clients\/\$\{clientId\}`\)/.test(metaSource) && /synced=\$\{result\.daysSynced\}/.test(metaSource));
  ok(
    "syncClientStractSourcesAction ainda soma falhas por fonte e preserva a mensagem de 'sem integração ativa'",
    /Este cliente não tem nenhuma integração ativa para sincronizar\./.test(stractSource) && /failedCount/.test(stractSource),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
