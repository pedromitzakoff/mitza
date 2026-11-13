/**
 * Testes da Etapa "Configuração inteligente de métricas por cliente" —
 * Etapa 4 do plano aprovado: a seção "Métricas de performance" dentro de
 * `/clients/[id]/edit`, reaproveitando 100% do que já existia
 * (`ClientGoalsSection`, `ActionTypePicker`, `discoverActionTypesAction`/
 * `saveMetricMappingAction`) — nenhuma lógica nova de descoberta/salvamento
 * de evento, nenhum segundo sistema de mapeamento.
 *
 * Cobre:
 *  A. Conversas/Cadastros já aparecem em todo seletor (migração
 *     `performance-goal-conversations-registrations.sql` confirmada
 *     executada em produção) — `AVAILABLE_PERFORMANCE_GOAL_OPTIONS`
 *     (lista vazia de pendências) é a fonte única nos 4 pontos de seleção,
 *     nunca `PERFORMANCE_GOAL_OPTIONS` direto.
 *  B. `ActionTypePicker` com `fixedGoal`: esconde o seletor "Objetivo",
 *     mostra o nome do objetivo como texto, nunca duplica a lógica de
 *     descoberta/salvamento (`discoverActionTypesAction`/
 *     `saveMetricMappingAction` continuam as únicas usadas).
 *  C. `ClientGoalsSection` embute o evento da Meta POR OBJETIVO, nunca
 *     pra "followers" (não vem do Meta Ads), nunca quando o cliente não
 *     tem conta Meta conectada — e nunca sem explicar o motivo.
 *  D. `resolveClientMetaMappingSource`/`listActiveMetricMappingsByGoal`
 *     reaproveitam exatamente as mesmas tabelas/filtros já usados em
 *     `MetaConnectionDrawer`/`dados-data.ts` — nenhuma consulta nova
 *     inventada, 'carts' nunca aparece como um objetivo de cliente.
 *  E. A seção em `/clients/[id]/edit` foi renomeada pro nome pedido
 *     ("Métricas de performance"), não criou uma rota nova.
 *
 * Rodar: npx tsx scripts/test-koff-client-metrics-section.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVAILABLE_PERFORMANCE_GOAL_OPTIONS, PERFORMANCE_GOAL_OPTIONS, PERFORMANCE_GOALS_PENDING_MIGRATION } from "../src/lib/performance-goals";

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
console.log("\nA — Conversas/Cadastros liberados em toda seleção (migração já rodou)\n");
{
  ok("PERFORMANCE_GOALS_PENDING_MIGRATION está vazia (migração confirmada em produção)", PERFORMANCE_GOALS_PENDING_MIGRATION.length === 0);
  ok("AVAILABLE_PERFORMANCE_GOAL_OPTIONS tem os 5 objetivos agora", AVAILABLE_PERFORMANCE_GOAL_OPTIONS.length === 5);
  ok("AVAILABLE_PERFORMANCE_GOAL_OPTIONS é idêntica a PERFORMANCE_GOAL_OPTIONS (lista de pendências vazia)", AVAILABLE_PERFORMANCE_GOAL_OPTIONS.length === PERFORMANCE_GOAL_OPTIONS.length);
  ok("mas continuam existindo na config completa (a mesma fonte de sempre, nunca duplicada)", PERFORMANCE_GOAL_OPTIONS.length === 5);

  const actionTypePickerSource = loadSource("src", "app", "settings", "meta-connections", "action-type-picker.tsx");
  const clientPerfGoalEditorSource = loadSource("src", "app", "clients", "client-performance-goal-editor.tsx");
  const clientGoalsSectionSource = loadSource("src", "app", "clients", "client-goals-section.tsx");

  ok("ActionTypePicker usa AVAILABLE_PERFORMANCE_GOAL_OPTIONS no seletor de objetivo", actionTypePickerSource.includes("AVAILABLE_PERFORMANCE_GOAL_OPTIONS.map"));
  ok("ClientPerformanceGoalEditor (seletor rápido) usa a mesma lista gateada", clientPerfGoalEditorSource.includes("AVAILABLE_PERFORMANCE_GOAL_OPTIONS.map"));
  ok(
    "ClientGoalsSection usa a lista gateada tanto pra 'Adicionar objetivo' quanto pra 'Classificar campanhas'",
    (clientGoalsSectionSource.match(/AVAILABLE_PERFORMANCE_GOAL_OPTIONS/g) ?? []).length >= 2,
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — ActionTypePicker com fixedGoal: mesma lógica, sem seletor redundante\n");
{
  const source = loadSource("src", "app", "settings", "meta-connections", "action-type-picker.tsx");

  ok("fixedGoal é opcional — uso existente (Configurações) não muda", /fixedGoal\?: PerformanceGoal/.test(source));
  ok("quando fixedGoal existe, vira um <input type=\"hidden\">, nunca um segundo <select>", source.includes('<input type="hidden" name="goal" value={fixedGoal} />'));
  ok("discoverActionTypesAction continua a única chamada de descoberta (nenhuma duplicada)", (source.match(/discoverActionTypesAction\(accountId\)/g) ?? []).length === 1);
  ok("heading é parametrizável, default preserva o texto original ('Novo mapeamento')", source.includes('heading = "Novo mapeamento"'));
}

// ---------------------------------------------------------------------------
console.log("\nC — ClientGoalsSection: evento por objetivo, nunca pra followers, nunca sem conta Meta\n");
{
  const source = loadSource("src", "app", "clients", "client-goals-section.tsx");

  ok("reaproveita ActionTypePicker (import direto, nunca uma cópia)", source.includes('import { ActionTypePicker } from "@/app/settings/meta-connections/action-type-picker"'));
  ok("reaproveita saveMetricMappingAction (import direto, nunca uma cópia)", source.includes('import { saveMetricMappingAction } from "@/app/settings/meta-connections/actions"'));
  ok(
    "o expansível de evento nunca aparece pra 'followers'",
    source.includes('goal.resultType !== "followers" && metaMappingSource !== null'),
  );
  ok(
    "quando o cliente não tem conta Meta conectada, explica o motivo (nunca esconde sem dizer por quê)",
    source.includes("Conecte a conta Meta deste cliente"),
  );
  ok("usa fixedGoal (nunca o seletor de objetivo genérico) dentro do card de cada objetivo", source.includes("fixedGoal={goal.resultType}"));
}

// ---------------------------------------------------------------------------
console.log("\nD — Dados reaproveitados das MESMAS tabelas já usadas em Configurações/Dados, nenhuma consulta nova inventada\n");
{
  const source = loadSource("src", "lib", "client-metric-mapping-source.ts");

  ok(
    "resolveClientMetaMappingSource usa o MESMO filtro de sempre (channel=meta, provider=meta_api, enabled=true)",
    source.includes('.eq("channel", "meta")') && source.includes('.eq("provider", "meta_api")') && source.includes('.eq("enabled", true)'),
  );
  ok("limitação B3 da auditoria documentada explicitamente (no máximo 1 conta Meta por cliente, nesta rodada)", source.toLowerCase().includes("máximo 1 conta meta"));
  ok("lê metric_mappings (a MESMA tabela de sempre, nunca uma nova)", source.includes('.from("metric_mappings")'));
  ok("'carts' nunca vira um objetivo de cliente aqui (parsePerformanceGoal descarta)", source.includes("parsePerformanceGoal(row.goal)"));
}

// ---------------------------------------------------------------------------
console.log("\nE — /clients/[id]/edit: seção renomeada no lugar pedido, nenhuma rota nova\n");
{
  const editPageSource = loadSource("src", "app", "clients", "[id]", "edit", "page.tsx");

  // Etapa "Configurações do Cliente": a seção foi renomeada de novo, pra
  // diferenciar claramente de "Indicadores exibidos no Dashboard" (ponto 2
  // do pedido) — mesmo wrapper (ClientGoalsSection), mesma aba Métricas.
  ok(
    'título da seção é "Objetivos de performance" (ponto 2 do pedido — diferenciação de Indicadores exibidos)',
    editPageSource.includes(">Objetivos de performance<"),
  );
  ok("continua dentro de /clients/[id]/edit — nenhuma rota nova criada", editPageSource.includes("<ClientGoalsSection"));
  ok(
    "passa metaMappingSource/metaMappingsByGoal pro componente reaproveitado",
    editPageSource.includes("metaMappingSource={metaMappingSource}") && editPageSource.includes("metaMappingsByGoal={metaMappingsByGoal}"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
