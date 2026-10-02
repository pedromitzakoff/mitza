/**
 * Testes da Etapa "MEGA FACELIFT — Correção Conceitual da Fase 4.6:
 * Dashboard é sempre Cliente" — cobre especificamente a matriz final
 * módulo × contexto definida nesta correção (Dashboard/Metas/Performance/
 * Dados exigem cliente; Operação/Demandas/Timeline continuam Todos-ou-
 * -Cliente) e os cenários de troca de módulo/cliente que motivaram a
 * correção. Os testes estruturais da Fase 4.6 em si (Sidebar, header,
 * `GlobalScopeSelect`, rotas globais) continuam em
 * `test-mega-facelift-fase46-contexto-global.ts` — não duplicados aqui.
 *
 * Revisado pela Etapa "Correção do fluxo final do Dashboard": Dashboard
 * continua EXCLUSIVO de cliente (nada mudou na matriz módulo×contexto em
 * si — Metas/Performance/Dados continuam caindo em `/clients` pra
 * "Todos"), mas o MECANISMO de "Dashboard + Todos" mudou — deixou de cair
 * em `/clients` e passou a cair em `/` (resolver que abre o primeiro
 * cliente da carteira, nunca mais uma escolha manual). A cobertura
 * detalhada desse resolver (sequência oficial, carteira vazia, redirect)
 * vive em `test-mega-facelift-correcao-dashboard-entrypoint.ts` — aqui só
 * os valores de `buildModuleContextHref` foram atualizados pra refletir o
 * novo destino.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-correcao-dashboard-cliente.ts
 */
import assert from "node:assert/strict";
import {
  buildModuleContextHref,
  moduleSupportsAllContext,
  resolveCurrentModuleAndContext,
  type ModuleKey,
} from "../src/lib/client-workspace-nav";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const CLIENT_ONLY_MODULES: ModuleKey[] = ["dashboard", "metas", "performance", "dados"];
const DUAL_CONTEXT_MODULES: ModuleKey[] = ["operation", "demandas", "timeline"];

console.log("\n1 — Matriz final: módulos de Growth do cliente NUNCA oferecem Todos no seletor (moduleSupportsAllContext)\n");
{
  for (const moduleKey of CLIENT_ONLY_MODULES) {
    ok(`moduleSupportsAllContext("${moduleKey}") === false`, moduleSupportsAllContext(moduleKey) === false);
  }
  // Dashboard é o único dos 4 com uma entrada em MODULE_GLOBAL_HREF — "/"
  // (resolver pro primeiro cliente, Etapa "Correção do fluxo final do
  // Dashboard"), nunca uma opção real no seletor (moduleSupportsAllContext
  // acima continua false pros 4). Metas/Performance/Dados continuam sem
  // nenhuma entrada, caindo no fallback padrão /clients.
  check('buildModuleContextHref("dashboard", Todos) cai em "/" (resolver pro primeiro cliente — nunca mais /clients)', buildModuleContextHref("dashboard", { type: "all" }, null), "/");
  for (const moduleKey of ["metas", "performance", "dados"] as const) {
    check(`buildModuleContextHref("${moduleKey}", Todos) cai em /clients (nenhuma rota global própria, decisão intocada)`, buildModuleContextHref(moduleKey, { type: "all" }, null), "/clients");
  }
}

console.log("\n2 — Matriz final: módulos operacionais continuam Todos-ou-Cliente, sem mudança\n");
{
  const expectedGlobalHref: Record<string, string> = { operation: "/operation", demandas: "/demandas", timeline: "/timeline" };
  for (const moduleKey of DUAL_CONTEXT_MODULES) {
    ok(`moduleSupportsAllContext("${moduleKey}") === true`, moduleSupportsAllContext(moduleKey) === true);
    check(`buildModuleContextHref("${moduleKey}", Todos) continua em ${expectedGlobalHref[moduleKey]}`, buildModuleContextHref(moduleKey, { type: "all" }, null), expectedGlobalHref[moduleKey]);
    check(`buildModuleContextHref("${moduleKey}", cliente c1) continua em /clients/c1/${moduleKey}`, buildModuleContextHref(moduleKey, { type: "client", id: "c1" }, null), `/clients/c1/${moduleKey}`);
  }
}

console.log("\n3 — Dashboard: nunca abre Todos no seletor, sempre exige cliente — contexto Todos resolve pro primeiro cliente, nunca uma escolha manual\n");
{
  check("Dashboard + cliente aibou -> /clients/aibou (painel individual)", buildModuleContextHref("dashboard", { type: "client", id: "aibou" }, null), "/clients/aibou");
  check("Dashboard + cliente aibou + mês -> preserva ?month=", buildModuleContextHref("dashboard", { type: "client", id: "aibou" }, "2026-08"), "/clients/aibou?month=2026-08");
  check("Dashboard + Todos -> '/' (resolver — nunca uma escolha manual em /clients, nunca o dashboard consolidado global)", buildModuleContextHref("dashboard", { type: "all" }, null), "/");
  check("Dashboard + Todos + mês -> ainda cai em '/' (mês não se propaga pra fora do contexto de cliente)", buildModuleContextHref("dashboard", { type: "all" }, "2026-08"), "/");
}

console.log("\n4 — Metas/Performance/Dados: mesma regra do Dashboard (client-only)\n");
{
  check("Metas + cliente aibou -> /clients/aibou/metas", buildModuleContextHref("metas", { type: "client", id: "aibou" }, null), "/clients/aibou/metas");
  check("Performance + cliente aibou -> /clients/aibou/relatorio", buildModuleContextHref("performance", { type: "client", id: "aibou" }, null), "/clients/aibou/relatorio");
  check("Dados + cliente aibou -> /clients/aibou/dados", buildModuleContextHref("dados", { type: "client", id: "aibou" }, null), "/clients/aibou/dados");
}

console.log("\n5 — Troca de módulo preservando cliente (decisão explícita do usuário)\n");
{
  check("Aibou/Dashboard -> Metas continua em Aibou", buildModuleContextHref("metas", { type: "client", id: "aibou" }, null), "/clients/aibou/metas");
  check("Aibou/Metas -> Performance continua em Aibou", buildModuleContextHref("performance", { type: "client", id: "aibou" }, null), "/clients/aibou/relatorio");
  check("Aibou/Performance -> Dados continua em Aibou", buildModuleContextHref("dados", { type: "client", id: "aibou" }, null), "/clients/aibou/dados");
  check("Aibou/Dashboard -> Operação continua em Aibou (módulo operacional também aceita contexto de cliente)", buildModuleContextHref("operation", { type: "client", id: "aibou" }, null), "/clients/aibou/operation");
}

console.log("\n6 — Todos + Operação -> Dashboard: comportamento determinístico (resolve pro primeiro cliente via '/'), nunca o dashboard global órfão\n");
{
  const currentContext = resolveCurrentModuleAndContext("/operation");
  check("resolveCurrentModuleAndContext('/operation') reconhece módulo operation em contexto Todos", currentContext, { module: "operation", context: { type: "all" } });
  check(
    "sair de Todos+Operação pro módulo Dashboard (mesmo contexto Todos) cai em '/' — resolver determinístico que abre o primeiro cliente real, nunca uma escolha manual nem o dashboard global antigo",
    buildModuleContextHref("dashboard", currentContext.context, null),
    "/",
  );
}

console.log("\n7 — Rotas antigas preservadas (nenhum link quebrado)\n");
{
  check("'/' ainda resolve como Dashboard+Todos pro núcleo de leitura de pathname (agora o resolver do primeiro cliente, ver test-mega-facelift-correcao-dashboard-entrypoint.ts)", resolveCurrentModuleAndContext("/"), { module: "dashboard", context: { type: "all" } });
  check("'/operation' ainda resolve normalmente", resolveCurrentModuleAndContext("/operation").module, "operation");
  check("'/demandas' ainda resolve normalmente", resolveCurrentModuleAndContext("/demandas").module, "demandas");
  check("'/timeline' ainda resolve normalmente", resolveCurrentModuleAndContext("/timeline").module, "timeline");
}

console.log(`\n${passed} verificações passaram.\n`);
