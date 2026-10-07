/**
 * Testes da Etapa "Demandas sempre abre em Todos por padrão" — Demandas é
 * a lista do que precisa ser feito na agência toda; o link da Sidebar
 * deixou de preservar o cliente atual (ex.: Aibou -> Operação -> Demandas
 * não deve mais abrir só a fração de Aibou) e passou a ir sempre pra
 * `/demandas` (Todos), mesma regra independente de QUAL módulo/cliente o
 * usuário estava antes. Os outros 6 módulos (Dashboard/Metas/Performance/
 * Dados/Operação/Timeline) continuam preservando o cliente atual, como
 * sempre — nenhuma mudança neles.
 *
 * Isso é só sobre o DESTINO do clique na Sidebar: `/clients/[id]/demandas`
 * continua existindo e funcionando (deep link, anterior/próximo, busca do
 * header, o atalho "Todos -> cliente" de `GlobalScopeSelect`) — coberto a
 * fundo em `test-client-workspace.ts`/`test-mega-facelift-fase46-contexto-global.ts`,
 * não duplicado aqui.
 *
 * Rodar: npx tsx scripts/test-demandas-sempre-todos-sidebar.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildModuleContextHref, resolveModuleLinkContext, type ModuleKey } from "../src/lib/client-workspace-nav";

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
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

console.log("\n1 — resolveModuleLinkContext: Demandas SEMPRE força Todos, mesmo dentro de um cliente\n");
{
  check('resolveModuleLinkContext("demandas", cliente aibou) -> Todos', resolveModuleLinkContext("demandas", { type: "client", id: "aibou" }), { type: "all" });
  check('resolveModuleLinkContext("demandas", Todos) -> Todos (sem mudança quando já era Todos)', resolveModuleLinkContext("demandas", { type: "all" }), { type: "all" });
}

console.log("\n2 — Os outros 6 módulos continuam preservando o contexto ambiente, sem mudança\n");
{
  const unaffected: ModuleKey[] = ["dashboard", "metas", "performance", "dados", "operation", "timeline"];
  for (const moduleKey of unaffected) {
    check(`resolveModuleLinkContext("${moduleKey}", cliente aibou) continua cliente aibou (nenhuma mudança)`, resolveModuleLinkContext(moduleKey, { type: "client", id: "aibou" }), { type: "client", id: "aibou" });
    check(`resolveModuleLinkContext("${moduleKey}", Todos) continua Todos (nenhuma mudança)`, resolveModuleLinkContext(moduleKey, { type: "all" }), { type: "all" });
  }
}

console.log("\n3 — Combinado com buildModuleContextHref: clicar Demandas na Sidebar sempre cai em /demandas, de qualquer módulo/cliente\n");
{
  for (const fromModule of ["dashboard", "metas", "performance", "dados", "operation", "timeline"] as const) {
    check(
      `Aibou/${fromModule} -> clicar Demandas na Sidebar cai em /demandas (Todos), nunca /clients/aibou/demandas`,
      buildModuleContextHref("demandas", resolveModuleLinkContext("demandas", { type: "client", id: "aibou" }), null),
      "/demandas",
    );
  }
  check("Todos/Operação -> clicar Demandas continua em /demandas (já era Todos, sem mudança)", buildModuleContextHref("demandas", resolveModuleLinkContext("demandas", { type: "all" }), null), "/demandas");
}

console.log("\n4 — Deep link /clients/[id]/demandas continua funcionando (só o DESTINO do clique na Sidebar mudou, nunca a rota)\n");
{
  check("buildModuleContextHref direto com contexto de cliente continua abrindo o workspace do cliente (usado por anterior/próximo, busca do header, GlobalScopeSelect)", buildModuleContextHref("demandas", { type: "client", id: "aibou" }, null), "/clients/aibou/demandas");
}

console.log("\n5 — Sidebar: MITZA ONE — Fase 2 (Sidebar = Carteira) substituiu ModuleLink/resolveModuleLinkContext por um link GLOBAL fixo — garantia ainda mais forte (nunca dependeu de contexto ambiente pra começar)\n");
{
  // A Sidebar deixou de ter 'módulo + contexto ambiente' (Fase 2 — não há
  // mais navegação por módulo). O item "Demandas" da nova área "Agência"
  // é simplesmente href: "/demandas", sem nenhuma lógica de contexto —
  // nunca precisa de resolveModuleLinkContext pra "forçar" Todos, porque
  // não existe outro destino possível. `resolveModuleLinkContext`/
  // `buildModuleContextHref` continuam intocados em client-workspace-nav.ts
  // (seções 1-4 acima) — só deixaram de ser chamados PELA SIDEBAR.
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");
  ok(
    "AGENCIA_ITEMS define Demandas com href fixo '/demandas' (sem contexto, sem resolveModuleLinkContext) — nunca abre a fração de um cliente",
    /label: "Demandas", href: "\/demandas"/.test(sidebarSource),
  );
  ok(
    "Sidebar não IMPORTA mais resolveModuleLinkContext/buildModuleContextHref (módulo + contexto deixou de existir como conceito na navegação — os nomes só sobrevivem numa doc-comment explicando o que saiu)",
    !sidebarSource.includes("import {") || !/import \{[^}]*\b(resolveModuleLinkContext|buildModuleContextHref)\b[^}]*\} from "@\/lib\/client-workspace-nav"/.test(sidebarSource),
  );
  const headerSource = loadSource("src", "app", "clients", "client-workspace-header.tsx");
  ok("ClientWorkspaceHeader NÃO importa resolveModuleLinkContext — seu mecanismo de troca de cliente/contexto é outro, intocado por esta etapa", !headerSource.includes("resolveModuleLinkContext"));
  const globalScopeSelectSource = loadSource("src", "app", "global-scope-select.tsx");
  ok("GlobalScopeSelect NÃO importa resolveModuleLinkContext — entrada 'Todos -> cliente' continua um mecanismo próprio, intocado", !globalScopeSelectSource.includes("resolveModuleLinkContext"));
}

console.log(`\n${passed} verificações passaram.\n`);
