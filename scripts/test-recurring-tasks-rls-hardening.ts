/**
 * Etapa 2A (Auditoria de Segurança — correções prioritárias) — Achado #2:
 * `recurring_tasks`/`recurring_task_clients`/`recurring_task_checklist_items`/
 * `recurring_task_goal_history` tinham policy de SELECT `using (true)`, sem
 * `to authenticated` — legíveis por qualquer requisição anônima via API REST
 * do Supabase. `supabase/recurring-tasks-rls-hardening.sql` corrige isso.
 *
 * Este ambiente não tem conexão com um Postgres real (nem local nem de
 * produção) — não é possível aqui executar `set role anon; select ...` e
 * observar o resultado de verdade. Este arquivo faz a verificação estática
 * possível sem banco: confirma que o texto da migration nova (a) elimina o
 * `using (true)` de SELECT pras 4 tabelas, (b) usa os helpers de autorização
 * JÁ EXISTENTES no projeto (nunca um segundo sistema), e (c) a regra
 * escolhida bate com o que os consumidores reais precisam (auditados antes
 * de escrever a migration — ver comentário no próprio SQL).
 *
 * A prova definitiva (anon negado / gestor autorizado permitido / admin
 * permitido) só é possível com um Postgres de verdade — o SQL read-only pra
 * isso está no relatório desta etapa, pra rodar no SQL Editor do Supabase.
 *
 * Rodar: npx tsx scripts/test-recurring-tasks-rls-hardening.ts
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

const migrationPath = join(__dirname, "..", "supabase", "recurring-tasks-rls-hardening.sql");
const sql = readFileSync(migrationPath, "utf8");
// Só o SQL de verdade, sem os comentários `--` (que citam o padrão antigo
// "using (true)" como contexto histórico do achado — nunca fazem parte da
// migration que de fato roda).
const sqlWithoutComments = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

console.log("\n1 — Migration é idempotente (drop policy if exists antes de cada create policy)\n");
{
  const tables = ["recurring_tasks", "recurring_task_checklist_items", "recurring_task_goal_history", "recurring_task_clients"];
  for (const table of tables) {
    const dropPattern = new RegExp(`drop policy if exists ${table}_select on ${table};`);
    ok(`${table}: tem "drop policy if exists" antes de recriar`, dropPattern.test(sql));
  }
}

console.log("\n2 — Nenhuma policy de SELECT das 4 tabelas usa mais 'using (true)' (o achado original)\n");
{
  // Confirma que a migration NOVA não repete o padrão vulnerável — a prova
  // de que ele deixou de valer em produção depende de rodar esta migration
  // (fora do alcance deste ambiente), mas o texto da correção em si nunca
  // pode reintroduzir `using (true)`.
  ok("SQL executável (sem comentários) não contém 'using (true)' nem 'using(true)'", !/using\s*\(\s*true\s*\)/i.test(sqlWithoutComments));
}

console.log("\n3 — recurring_tasks / checklist_items / goal_history: usam current_team_member_id() (sem client_id na tabela, não dá pra escopar por cliente)\n");
{
  for (const table of ["recurring_tasks", "recurring_task_checklist_items", "recurring_task_goal_history"]) {
    const pattern = new RegExp(
      `create policy ${table}_select on ${table}\\s+for select using \\(current_team_member_id\\(\\) is not null\\);`,
    );
    ok(`${table}_select usa current_team_member_id() is not null (qualquer membro ativo, nunca anon)`, pattern.test(sql));
  }
}

console.log("\n4 — recurring_task_clients: usa is_admin() or is_client_manager(client_id) — tem client_id, escopo mais estrito disponível\n");
{
  const pattern = /create policy recurring_task_clients_select on recurring_task_clients\s+for select using \(is_admin\(\) or is_client_manager\(client_id\)\);/;
  ok("recurring_task_clients_select usa o mesmo padrão de toda tabela escopada por cliente", pattern.test(sql));
}

console.log("\n5 — Nenhum helper novo inventado — só os 3 já usados no resto do projeto\n");
{
  const usedHelpers = new Set(sqlWithoutComments.match(/\b(is_admin|is_client_manager|current_team_member_id|current_organization_id)\s*\(/g)?.map((m) => m.replace(/\s*\($/, "")));
  ok("helpers usados são só is_admin/is_client_manager/current_team_member_id (já existentes)", [...usedHelpers].every((h) => ["is_admin", "is_client_manager", "current_team_member_id"].includes(h)));
  ok("pelo menos um helper foi de fato usado", usedHelpers.size > 0);
}

console.log(`\nTodos os ${passed} testes passaram.`);
