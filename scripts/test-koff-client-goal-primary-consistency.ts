/**
 * Testes da Etapa "Configuração inteligente de métricas por cliente" —
 * Etapa 3 do plano aprovado: corrige o bug B1 da auditoria — dois
 * caminhos independentes pra definir o objetivo PRINCIPAL de um cliente
 * (`updateClientPerformanceGoalAction`, só `clients.performance_goal`, e
 * `setClientGoalPrimaryAction` → RPC antiga `set_client_goal_primary`, só
 * `client_goals.is_primary`) que nunca se sincronizavam entre si.
 *
 * Como não há acesso a um Supabase real neste ambiente (nem a migração foi
 * executada ainda — "não altere produção" segue valendo), estes testes são
 * ESTRUTURAIS: leem o código-fonte e a migração, e confirmam:
 *  A. A nova RPC (`set_client_primary_performance_goal`) atualiza as DUAS
 *     tabelas na mesma função (mesma transação implícita do PL/pgSQL).
 *  B. Os DOIS Server Actions são GATEADOS por `PRIMARY_GOAL_CONSISTENCY_
 *     RPC_MIGRATED` (Etapa "publicar sem migração" — pedido explícito:
 *     "separe a publicação visual das alterações de banco, de forma
 *     segura"): quando `true`, chamam a RPC nova; quando `false` (valor
 *     atual, a migração ainda não rodou em produção), caem de volta no
 *     comportamento ANTERIOR a esta etapa — nunca dependem da função nova
 *     existir pra funcionar hoje.
 *  C. O call site em `client-goals-section.tsx` passa `resultType` (não
 *     mais `goal.id`) — a RPC nova é identificada por objetivo, não por
 *     linha, porque o seletor rápido não tem um `goal.id` quando o cliente
 *     ainda não tem nenhuma linha em `client_goals`.
 *  D. A função antiga (`set_client_goal_primary`) continua existindo no
 *     banco (nunca removida) — é exatamente ela que o caminho de
 *     fallback (B) chama enquanto a flag for `false`.
 *
 * Rodar: npx tsx scripts/test-koff-client-goal-primary-consistency.ts
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

// ---------------------------------------------------------------------------
console.log("\nA — A nova função SQL escreve nas DUAS tabelas, nunca só numa\n");
{
  const sql = loadSource("supabase", "client-goal-primary-consistency.sql");
  const fnStart = sql.indexOf("create or replace function set_client_primary_performance_goal");
  const fnEnd = sql.indexOf("$$ language plpgsql;", fnStart);
  const fnBody = sql.slice(fnStart, fnEnd);

  ok("função existe e tem corpo", fnStart !== -1 && fnEnd > fnStart);
  ok("escreve em client_goals (upsert, is_primary = true)", fnBody.includes("insert into client_goals") && fnBody.includes("is_primary = true"));
  ok("rebaixa qualquer outro objetivo principal do mesmo cliente", fnBody.includes("update client_goals set is_primary = false"));
  ok(
    "ORDEM correta: rebaixa o antigo principal ANTES de promover o novo — nunca duas linhas is_primary=true ao mesmo tempo " +
      "(client_goals_one_primary_per_client é um índice único não adiável, checado ao final de CADA statement; promover antes de rebaixar violaria o índice e falharia)",
    fnBody.indexOf("update client_goals set is_primary = false") < fnBody.indexOf("insert into client_goals"),
  );
  ok("escreve em clients.performance_goal — nunca mais só uma das duas tabelas", fnBody.includes("update clients set performance_goal = p_result_type"));
  ok("valida o objetivo contra os 5 valores suportados", fnBody.includes("'leads', 'sales', 'followers', 'conversations', 'registrations'"));
  ok("arquivo documenta 'NÃO EXECUTAR sem aprovação'", sql.includes("NÃO EXECUTAR sem aprovação"));
}

// ---------------------------------------------------------------------------
console.log("\nB — Os dois Server Actions são gateados pela flag — nunca dependem da RPC nova existir hoje\n");
{
  const goalActionsSource = loadSource("src", "app", "clients", "goal-actions.ts");
  const performanceActionsSource = loadSource("src", "app", "clients", "performance-actions.ts");
  const flagsSource = loadSource("src", "lib", "migration-flags.ts");

  ok("a flag existe e está false (migração ainda não rodou em produção)", /PRIMARY_GOAL_CONSISTENCY_RPC_MIGRATED = false/.test(flagsSource));

  ok(
    "setClientGoalPrimaryAction tem os DOIS caminhos: a RPC nova (gateada) e o fallback com a RPC antiga",
    goalActionsSource.includes('supabase.rpc("set_client_primary_performance_goal"') &&
      goalActionsSource.includes('supabase.rpc("set_client_goal_primary"') &&
      goalActionsSource.includes("if (PRIMARY_GOAL_CONSISTENCY_RPC_MIGRATED)"),
  );
  ok(
    "updateClientPerformanceGoalAction tem os DOIS caminhos: a RPC nova (gateada) e o fallback com .update() direto",
    performanceActionsSource.includes('supabase.rpc("set_client_primary_performance_goal"') &&
      /\.from\("clients"\)\.update\(\{\s*performance_goal/.test(performanceActionsSource) &&
      performanceActionsSource.includes("if (PRIMARY_GOAL_CONSISTENCY_RPC_MIGRATED)"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — call site passa resultType, não goal.id (a RPC é por objetivo, não por linha)\n");
{
  const goalActionsSource = loadSource("src", "app", "clients", "goal-actions.ts");
  const sectionSource = loadSource("src", "app", "clients", "client-goals-section.tsx");

  ok(
    "setClientGoalPrimaryAction recebe resultType: PerformanceGoal como 1º parâmetro",
    /setClientGoalPrimaryAction\(resultType: PerformanceGoal, clientId: string, returnTo: string\)/.test(goalActionsSource),
  );
  ok(
    "client-goals-section.tsx passa goal.resultType (nunca mais goal.id) pro bind",
    sectionSource.includes("setClientGoalPrimaryAction.bind(null, goal.resultType, clientId, returnTo)"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — a RPC antiga continua existindo no banco — é ela que o fallback chama enquanto a flag for false\n");
{
  const consistencySql = loadSource("supabase", "client-goal-primary-consistency.sql");
  const clientGoalsSql = loadSource("supabase", "client-goals.sql");
  const goalActionsSource = loadSource("src", "app", "clients", "goal-actions.ts");

  ok("set_client_goal_primary continua definida em client-goals.sql (nunca um DROP FUNCTION)", clientGoalsSql.includes("create or replace function set_client_goal_primary"));
  ok(
    "o fallback de setClientGoalPrimaryAction chama exatamente a assinatura antiga (p_client_id, p_goal_id)",
    /set_client_goal_primary["'],\s*\{\s*p_client_id:\s*clientId,\s*p_goal_id:\s*goal\.id\s*\}/.test(goalActionsSource),
  );
  ok(
    "a migração nova documenta explicitamente por que a função antiga fica (compatibilidade, nunca removida às cegas)",
    consistencySql.includes("set_client_goal_primary") && consistencySql.toLowerCase().includes("compatibilidade"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
