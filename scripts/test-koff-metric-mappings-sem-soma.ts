/**
 * Testes da Etapa "KOFF Analytics — Um evento por objetivo, nunca somar"
 * (pedido explícito do usuário, a partir de um incidente real: conta com
 * "lead" (formulário) e "mensagem iniciada" mapeados juntos pro objetivo
 * Leads relatou 40 leads quando só 20 eram formulários de verdade — as
 * outras 20 eram mensagens que nem chegaram até o cliente). Reverte a
 * decisão anterior de permitir várias colunas ativas por objetivo
 * (`supabase/stract-metric-mappings-multi-column.sql`) — de volta à regra
 * original, 1 evento ativo por objetivo, salvar um novo SEMPRE substitui o
 * anterior.
 *
 * `saveMetricMappingAction` é uma Server Action que depende de
 * `next/headers`/Supabase real — mesma limitação estrutural documentada em
 * `test-sync-actions-authorization.ts` (sem sessão HTTP real neste
 * ambiente). Por isso a verificação é ESTRUTURAL (código-fonte): confirma
 * que a função certa (desativar-antes-de-inserir) é chamada, na ordem
 * certa, e que o padrão antigo (bloquear só duplicata exata, permitindo
 * dois eventos DIFERENTES somados) foi removido.
 *
 * Rodar: npx tsx scripts/test-koff-metric-mappings-sem-soma.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
function fileExists(...segments: string[]): boolean {
  return existsSync(join(__dirname, "..", ...segments));
}

// ---------------------------------------------------------------------------
console.log("\nA — saveMetricMappingAction: substitui, nunca soma\n");
{
  const actionsSource = loadSource("src", "app", "settings", "meta-connections", "actions.ts");

  ok(
    "salvar um mapeamento desativa QUALQUER mapeamento já ativo do MESMO objetivo antes de inserir o novo",
    /\.from\("metric_mappings"\)\s*\n\s*\.update\(\{ active: false \}\)\s*\n\s*\.eq\("import_source_id", importSourceId\)\s*\n\s*\.eq\("goal", goal as PerformanceGoal\)\s*\n\s*\.eq\("active", true\)/.test(
      actionsSource,
    ),
  );
  ok(
    "a desativação acontece ANTES do insert do novo mapeamento (ordem importa: nunca os dois ativos ao mesmo tempo, nem que seja por um instante)",
    actionsSource.indexOf('.update({ active: false })') < actionsSource.indexOf('.from("metric_mappings").insert({'),
  );
  ok(
    "o padrão antigo (bloquear só duplicata EXATA do mesmo result_column, permitindo dois eventos diferentes somados) foi removido",
    !actionsSource.includes("Este evento já está mapeado e ativo pra este objetivo."),
  );
  ok(
    "uma falha ao desativar o mapeamento anterior interrompe a operação (nunca insere o novo sem garantir que o antigo saiu)",
    actionsSource.includes("if (deactivateError) failure("),
  );
  ok("mensagem de sucesso deixa explícito que houve substituição, nunca soma silenciosa", actionsSource.includes("substituiu o evento anterior deste objetivo"));
}

// ---------------------------------------------------------------------------
console.log("\nB — UI: admin é avisado da regra antes de salvar (nunca descobre por acidente, como no incidente real)\n");
{
  const drawerSource = loadSource("src", "app", "settings", "meta-connections", "meta-connection-drawer.tsx");
  const pickerSource = loadSource("src", "app", "settings", "meta-connections", "action-type-picker.tsx");

  ok(
    "a tela de Mapeamento de resultados explica a regra (1 evento por objetivo, substitui, nunca soma) antes da lista/formulário",
    drawerSource.includes("Cada objetivo tem só 1 evento ativo por vez") && drawerSource.includes("nunca soma"),
  );
  ok("o formulário de Novo mapeamento repete o aviso perto do botão de salvar", pickerSource.includes("Substitui o evento ativo deste objetivo") && pickerSource.includes("nunca soma"));
}

// ---------------------------------------------------------------------------
console.log("\nC — Sincronização: tolerância defensiva documentada corretamente (nunca mais um recurso 'soma por design')\n");
{
  const ingestRunSource = loadSource("src", "lib", "meta-api-ingest-run.ts");
  ok(
    "o comentário de mappingGroupsByGoal não apresenta mais somar múltiplos eventos como o caminho normal — é tolerância defensiva, documentada como tal",
    ingestRunSource.includes("tolerância defensiva") && ingestRunSource.includes("nunca deveria acontecer em uso normal"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — Migração de banco: diagnóstico antes de restringir, nunca uma constraint que falha às cegas\n");
{
  ok("existe o arquivo de migração que restaura a constraint original (1 evento por objetivo)", fileExists("supabase", "metric-mappings-one-event-per-goal.sql"));

  const migrationSource = loadSource("supabase", "metric-mappings-one-event-per-goal.sql");
  ok(
    "a migração inclui uma consulta de diagnóstico (só leitura) ANTES de restringir — nunca desativa nada automaticamente/às cegas",
    migrationSource.toLowerCase().includes("select") && migrationSource.includes("having count(*) > 1"),
  );
  ok(
    "a ordem de execução é explícita: diagnóstico primeiro, constraint só depois de confirmar que não há violação",
    migrationSource.includes("Passo 1") && migrationSource.includes("Passo 2") && migrationSource.indexOf("Passo 1") < migrationSource.indexOf("Passo 2"),
  );
  ok(
    "restaura o nome/definição original da constraint (metric_mappings_one_active_per_source_goal, 1 por import_source_id+goal)",
    migrationSource.includes("create unique index if not exists metric_mappings_one_active_per_source_goal") &&
      migrationSource.includes("on metric_mappings (import_source_id, goal) where active"),
  );
  ok("remove a constraint multi-coluna anterior (a que permitia a soma)", migrationSource.includes("drop index if exists metric_mappings_one_active_per_source_result_column"));
}

console.log(`\n${passed} verificações OK.\n`);
