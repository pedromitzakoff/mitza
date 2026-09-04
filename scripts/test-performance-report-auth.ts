/**
 * Etapa 2A (Auditoria de Segurança — correções prioritárias) — Achado #1:
 * `/api/clients/[id]/performance-report` não tinha nenhuma checagem de
 * sessão própria, só a RLS de `clients` (que já negava corretamente, mas
 * sem nenhuma camada de defesa em profundidade). Adicionamos
 * `getCurrentProfile()` (mesmo helper canônico de `lib/auth.ts` usado por
 * toda página/Server Action) ANTES de qualquer consulta a `clients` ou
 * início do Chromium.
 *
 * Este ambiente não tem sessão HTTP real (sem Next.js rodando, sem cookies
 * de um browser) pra chamar a rota fim-a-fim — `getCurrentProfile()`
 * depende de `next/headers`/cookies de request, que só existem dentro do
 * runtime do Next.js. A verificação possível aqui é estrutural: confirma,
 * no CÓDIGO-FONTE da rota, que a checagem de autenticação existe e roda
 * ANTES de qualquer leitura de `clients`/geração de PDF — nunca depois.
 * A verificação comportamental (401 sem sessão / 404 sem acesso / 200 com
 * acesso) precisa ser feita manualmente contra o app rodando — passos no
 * relatório desta etapa.
 *
 * Rodar: npx tsx scripts/test-performance-report-auth.ts
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

const routePath = join(__dirname, "..", "src", "app", "api", "clients", "[id]", "performance-report", "route.ts");
const source = readFileSync(routePath, "utf8");
// Só o código de verdade — o comentário da rota cita "createAdminClient()"
// como contexto de por que ela NÃO é usada aqui, o que faria uma busca
// ingênua pela string falhar por engano.
const codeWithoutComments = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
  .join("\n");

console.log("\n1 — getCurrentProfile (helper canônico de lib/auth.ts) é importado e usado\n");
{
  ok('importa getCurrentProfile de "@/lib/auth"', /import\s*\{\s*getCurrentProfile\s*\}\s*from\s*"@\/lib\/auth"/.test(source));
  ok("chama getCurrentProfile() dentro do handler GET", /await getCurrentProfile\(\)/.test(source));
}

console.log("\n2 — sem perfil, a rota responde 401 (nunca 200/404 disfarçando a ausência de sessão)\n");
{
  ok('responde 401 quando !profile', /if \(!profile\) return NextResponse\.json\(\{ error: .+ \}, \{ status: 401,/.test(source));
}

console.log("\n3 — ordem: checagem de sessão roda ANTES do rate limit, da query em clients e do PDF/Chromium\n");
{
  const idxProfileCheck = source.indexOf("await getCurrentProfile()");
  const idxRateLimit = source.indexOf("checkRateLimit(");
  const idxClientsQuery = source.indexOf('.from("clients")');
  const idxBuildData = source.indexOf("buildPerformanceReportData(");
  const idxRenderPdf = source.indexOf("renderReportPdf(");

  ok("getCurrentProfile() está no código antes do primeiro checkRateLimit", idxProfileCheck !== -1 && idxRateLimit !== -1 && idxProfileCheck < idxRateLimit);
  ok("checkRateLimit() está antes da query em clients", idxRateLimit < idxClientsQuery);
  ok("getCurrentProfile() está antes de buildPerformanceReportData (monta o relatório)", idxProfileCheck < idxBuildData);
  ok("getCurrentProfile() está antes de renderReportPdf (sobe o Chromium)", idxProfileCheck < idxRenderPdf);
  ok("checkRateLimit() está antes de renderReportPdf (sobe o Chromium) — nunca gera PDF antes de checar o limite", idxRateLimit < idxRenderPdf);
}

console.log("\n4 — RLS continua sendo a segunda camada — a query em clients não foi removida nem trocada por service role\n");
{
  ok('ainda usa createSupabaseClient() (cookie-bound, RLS) — nunca createAdminClient()', /createClient as createSupabaseClient/.test(source));
  ok("nunca importa createAdminClient (service role) nesta rota", !/createAdminClient/.test(codeWithoutComments));
  ok('a checagem "Cliente não encontrado" (404, via RLS) continua existindo', /Cliente não encontrado/.test(source));
}

console.log("\n5 — Etapa 2B: identidade do rate limit é o usuário AUTENTICADO (profile.id), nunca só o clientId da URL\n");
{
  ok("importa checkRateLimit/rateLimitedResponse de lib/rate-limit", /import\s*\{\s*checkRateLimit,\s*rateLimitedResponse\s*\}\s*from\s*"@\/lib\/rate-limit"/.test(source));
  ok("a key do bucket por (usuário, cliente) usa profile.id, não só `id`", /key:\s*`\$\{profile\.id\}:\$\{id\}`/.test(source));
  ok("existe também um limite mais amplo por usuário (todos os clientes)", /key:\s*profile\.id,/.test(source));
  ok("resposta de rate limit exceeded é 429 via rateLimitedResponse", /rateLimitedResponse\(/.test(source));
}

console.log("\n6 — Etapa 2B: toda resposta da rota (200/401/404/429/500) carrega Cache-Control private, no-store\n");
{
  ok("define um Cache-Control private, no-store, max-age=0 centralizado", /"Cache-Control":\s*"private, no-store, max-age=0"/.test(source));
  const responseReturns = source.match(/return (?:new NextResponse\(|NextResponse\.json\(|res;)/g) ?? [];
  ok("há pelo menos 6 pontos de retorno na rota (200, 401, 404, 429×2, 500)", responseReturns.length >= 6);
  // Todo `NextResponse.json(...)` de erro deve referenciar o header (direto
  // ou reaproveitando NO_STORE_HEADERS) — a única exceção aceitável é a
  // resposta de rate limit, que usa `rateLimitedResponse` + `res.headers.set`.
  const jsonErrorReturns = source.match(/return NextResponse\.json\(\{ error:[^;]*\);/g) ?? [];
  for (const ret of jsonErrorReturns) {
    ok(`resposta de erro inclui NO_STORE_HEADERS: ${ret.slice(0, 60)}...`, /NO_STORE_HEADERS/.test(ret));
  }
  ok("as respostas de rate limit aplicam NO_STORE_HEADERS via res.headers.set", /res\.headers\.set\(k, v\)/.test(source));
}

console.log(`\nTodos os ${passed} testes passaram.`);
