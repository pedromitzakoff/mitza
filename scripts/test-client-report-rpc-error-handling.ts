/**
 * Auditoria de Segurança — Security Regression Audit, Achado #2 (correção):
 * `markClientReportSentAction` (`client-report-actions.ts`) devolvia
 * `rpcError.message` cru pro usuário pra QUALQUER falha de
 * `register_recurring_execution` — a mesma RPC que `recurring-task-actions.ts`
 * já trata corretamente (só deixa passar a mensagem quando
 * `error.code === "P0001"`, a exceção de negócio intencional escrita em
 * plpgsql; qualquer outro código vira mensagem genérica, erro completo só
 * no `console.error`). A correção replica exatamente essa régua aqui.
 *
 * Mesma limitação estrutural de `test-sync-actions-authorization.ts`: sem
 * Supabase real neste ambiente, `markClientReportSentAction` não pode ser
 * chamada fim-a-fim (depende de `getCurrentProfile`/cookies de request).
 * Verificação estrutural (código-fonte), não comportamental.
 *
 * Rodar: npx tsx scripts/test-client-report-rpc-error-handling.ts
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

const source = readFileSync(join(__dirname, "..", "src", "app", "clients", "client-report-actions.ts"), "utf8");

// Recorta só o corpo de markClientReportSentAction pra nenhuma checagem
// aqui acidentalmente casar com outra função do mesmo arquivo
// (saveClientReportAction/fetchReportMetricsAction têm seu próprio
// tratamento de erro, sem relação com esta RPC).
const fnStart = source.indexOf("export async function markClientReportSentAction");
assert.ok(fnStart !== -1, "markClientReportSentAction não encontrada no arquivo");
const fnBody = source.slice(fnStart);

console.log("\n1 — P0001 (exceção de negócio intencional) continua expondo a mensagem em português da RPC\n");
{
  ok('define RAISED_BUSINESS_ERROR_CODE = "P0001" (mesmo código de recurring-task-actions.ts)', /RAISED_BUSINESS_ERROR_CODE\s*=\s*"P0001"/.test(source));
  ok(
    "a mensagem final é rpcError.message SÓ quando rpcError.code === RAISED_BUSINESS_ERROR_CODE",
    /rpcError\.code === RAISED_BUSINESS_ERROR_CODE\s*\?\s*rpcError\.message\s*:/.test(fnBody),
  );
}

console.log("\n2 — erro técnico (qualquer outro código) NUNCA vaza rpcError.message pro usuário\n");
{
  ok(
    "existe uma mensagem genérica de fallback (não rpcError.message) pro branch 'else' do ternário",
    /:\s*REGISTER_EXECUTION_GENERIC_ERROR_MESSAGE/.test(fnBody),
  );
  ok(
    "REGISTER_EXECUTION_GENERIC_ERROR_MESSAGE é uma string fixa (não interpola rpcError)",
    /const REGISTER_EXECUTION_GENERIC_ERROR_MESSAGE\s*=\s*"[^`$]*";/.test(source),
  );
  // Fora do console.error (log server-side, legítimo) e da comparação de
  // código, `rpcError.message` só pode aparecer no branch correto do
  // ternário acima — nunca interpolado direto numa string de retorno pro
  // usuário (o bug original era exatamente uma interpolação dessas).
  const returnBlock = fnBody.slice(fnBody.indexOf("if (rpcError)"), fnBody.indexOf("if (rpcError)") + 900);
  const rawInterpolation = /error:\s*`[^`]*\$\{rpcError\.message\}[^`]*`/.test(returnBlock);
  ok("nenhuma interpolação de template string com rpcError.message no retorno pro usuário", !rawInterpolation);
}

console.log("\n3 — erro técnico completo continua sendo logado no servidor (console.error), nunca só descartado\n");
{
  const ifBlock = fnBody.slice(fnBody.indexOf("if (rpcError)"), fnBody.indexOf("if (rpcError)") + 900);
  ok("chama console.error dentro do tratamento de rpcError", /console\.error\(/.test(ifBlock));
  ok("o log inclui supabaseCode/supabaseMessage/supabaseDetails/supabaseHint (mesmo formato de recurring-task-actions.ts)", /supabaseCode:\s*rpcError\.code/.test(ifBlock) && /supabaseMessage:\s*rpcError\.message/.test(ifBlock));
}

console.log("\n4 — fluxo de sucesso (sem rpcError) não muda: continua ok:true, sem campo error, com dedupe de execução preservado\n");
{
  ok("o report ainda é marcado como enviado (status/sent_at/sent_by) antes de chamar a RPC", /status:\s*"sent",\s*sent_at:\s*now,\s*sent_by:\s*profile\.id/.test(fnBody));
  ok("dedupe por client_report_id continua existindo (nunca registra 2 execuções pro mesmo report)", /existingExecution/.test(fnBody));
  ok(
    "caminho de sucesso (sem erro) ainda retorna { ok: true, sentAt, sentByName } sem o campo error",
    /return \{ ok: true, sentAt: now, sentByName: profile\.name \};/.test(fnBody),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
