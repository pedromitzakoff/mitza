/**
 * Editor de Integração Stract (`/settings/meta-connections/[clientId]`) —
 * pedido explícito do usuário depois de ver 17 de 26 clientes Meta ativos
 * com pelo menos uma conexão faltando ("não quero ter que refazer
 * novamente um por um no Supabase"). Verificação ESTRUTURAL (mesma
 * limitação de `test-sync-actions-authorization.ts`: sem sessão HTTP real
 * neste ambiente pra render fim-a-fim de uma Server Component admin-only) —
 * confirma que a página é admin-only, que os campos obrigatórios existem,
 * e que o link de entrada a partir da lista de Conexões Meta existe.
 *
 * Rodar: npx tsx scripts/test-import-source-editor.ts
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

const editPageSource = loadSource("src", "app", "settings", "meta-connections", "[clientId]", "page.tsx");
const listPageSource = loadSource("src", "app", "settings", "meta-connections", "page.tsx");

console.log("\n1 — Página admin-only, mesmo critério de toda Configurações\n");
{
  ok('importa requireAdmin de "@/lib/auth"', /import\s*\{\s*requireAdmin\s*\}\s*from\s*"@\/lib\/auth"/.test(editPageSource));
  ok("chama requireAdmin() antes de qualquer leitura de dado", /await requireAdmin\(\);\s*\n\s*const \{ clientId \}/.test(editPageSource));
}

console.log("\n2 — Só EDITA fontes existentes (escopo combinado) — nunca cria import_sources do zero\n");
{
  ok('estado vazio explícito quando o cliente não tem fonte Stract ("conexão nova continua manual")', /Este cliente não tem nenhuma fonte Stract configurada/.test(editPageSource));
  ok("nunca chama .insert( em import_sources nesta página", !/\.from\("import_sources"\)\s*\n?\s*\.insert\(/.test(editPageSource));
}

console.log("\n3 — Todos os campos obrigatórios de import_sources (not null no banco) aparecem como required, sem exceção\n");
{
  const requiredFields = ["table_name", "external_account_id", "account_id_column", "date_column", "spend_column"];
  for (const field of requiredFields) {
    ok(`campo ${field} presente e marcado required`, new RegExp(`name="${field}"[\\s\\S]{0,40}?required`).test(editPageSource) || new RegExp(`Field name="${field}"[\\s\\S]*?required`).test(editPageSource));
  }
}

console.log("\n4 — Cada fonte vira um <form> próprio, vinculado a updateImportSourceAction(id, clientId) — nunca uma ação genérica sem escopo\n");
{
  ok('importa updateImportSourceAction de "@/app/clients/stract-sync-actions"', /import\s*\{\s*updateImportSourceAction\s*\}\s*from\s*"@\/app\/clients\/stract-sync-actions"/.test(editPageSource));
  ok("form action vinculado por fonte (source.id) e ao cliente (client.id) — nunca um id fixo/errado", /updateImportSourceAction\.bind\(null, source\.id, client\.id\)/.test(editPageSource));
  ok("itera sources.map — um <form> por fonte, nunca um formulário só pra múltiplas fontes ao mesmo tempo", /sources\.map\(\(source\) =>/.test(editPageSource));
}

console.log("\n5 — Lista de Conexões Meta linka pra cá — pedido explícito do usuário, ponto de entrada único\n");
{
  ok('link "Editar" pra /settings/meta-connections/${audit.clientId}', /href=\{`\/settings\/meta-connections\/\$\{audit\.clientId\}`\}/.test(listPageSource));
  ok("link só aparece quando o cliente já tem uma fonte (audit.importSource !== null) — nunca linka pro editor de uma fonte inexistente", /audit\.importSource !== null &&\s*\n\s*\(/.test(listPageSource) || /\{audit\.importSource !== null && \(/.test(listPageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
