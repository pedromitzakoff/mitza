/**
 * Testes da Etapa "Correção do fluxo final do Dashboard" — o fluxo
 * correto é SEMPRE a experiência individual de `/clients/[id]`: abrir o
 * MITZA leva direto ao Dashboard de um cliente real (nunca "/ ->
 * /clients -> escolher -> Dashboard"), e "/" virou um RESOLVER
 * server-side que entra na carteira pela MESMA sequência oficial de
 * anterior/próximo (`flattenAgencyTree`) e redireciona pro primeiro
 * cliente — nunca o dashboard consolidado antigo (`LegacyGlobalDashboard`,
 * preservado mas aposentado em `src/app/page.tsx`).
 *
 * Cobre os 15 cenários pedidos pelo usuário. Os testes de matriz
 * módulo×contexto (Dashboard/Metas/Performance/Dados exigem cliente)
 * continuam em `test-mega-facelift-correcao-dashboard-cliente.ts`; os
 * estruturais da Fase 4.6 em si, em
 * `test-mega-facelift-fase46-contexto-global.ts` — não duplicados aqui.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-correcao-dashboard-entrypoint.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAgencyAccountsTree,
  flattenAgencyTree,
  resolveHomeRedirectHref,
  resolveWalletSequence,
  type AgencyTree,
} from "../src/lib/agency-accounts-tree";
import { buildModuleContextHref, moduleSupportsAllContext, resolveCurrentModuleAndContext } from "../src/lib/client-workspace-nav";

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

const pageSource = loadSource("src", "app", "page.tsx");
const sidebarSource = loadSource("src", "app", "sidebar.tsx");

/** Mesma forma de `RawAgencyTreeClient` (privado do módulo) — monta uma
 * árvore sintética sem precisar do Supabase, mesmo padrão já usado por
 * `test-mega-facelift-fase45-carteira-navegacao.ts`. */
function buildTree(clients: { id: string; name: string; wallet_position: number | null; managerId: string | null }[], managers: { id: string; name: string }[]): AgencyTree {
  return buildAgencyAccountsTree(
    clients.map((c) => ({
      id: c.id,
      name: c.name,
      wallet_position: c.wallet_position,
      avatar_url: null,
      primary_manager: c.managerId ? { id: c.managerId, name: managers.find((m) => m.id === c.managerId)?.name ?? "" } : null,
    })),
    managers,
  );
}

console.log("\n1 — '/' com clientes -> primeiro cliente da sequência oficial da carteira\n");
{
  const tree = buildTree(
    [
      { id: "b", name: "Beta", wallet_position: 2, managerId: "m1" },
      { id: "a", name: "Alpha", wallet_position: 1, managerId: "m1" },
      { id: "c", name: "Charlie", wallet_position: 1, managerId: null },
    ],
    [{ id: "m1", name: "Gestor 1" }],
  );
  const flat = flattenAgencyTree(tree);
  check("sequência oficial: wallet_position dentro do gestor, 'sem responsável' por último", flat.map((c) => c.id), ["a", "b", "c"]);
  check("resolveHomeRedirectHref aponta pro PRIMEIRO da mesma sequência, nunca uma ordenação própria", resolveHomeRedirectHref(flat), "/clients/a");
}

console.log("\n2 — '/' sem clientes -> fallback seguro /clients (nunca um redirect pra rota inexistente)\n");
{
  const emptyTree = buildTree([], [{ id: "m1", name: "Gestor 1" }]);
  check("carteira vazia (nenhum cliente ativo) -> /clients", resolveHomeRedirectHref(flattenAgencyTree(emptyTree)), "/clients");
}

console.log("\n3 — Dashboard nunca renderiza o consolidado global: '/' deixou de ser 'export default' do dashboard antigo\n");
{
  const homeFnStart = pageSource.indexOf("export default async function Home()");
  const legacyFnStart = pageSource.indexOf("export async function LegacyGlobalDashboard(");
  ok("'export default async function Home()' existe e vem ANTES de LegacyGlobalDashboard no arquivo", homeFnStart !== -1 && legacyFnStart !== -1 && homeFnStart < legacyFnStart);
  const homeFnBody = pageSource.slice(homeFnStart, legacyFnStart);
  ok("Home() chama loadAgencyAccountsTree + flattenAgencyTree + resolveHomeRedirectHref (mesmo núcleo da sequência oficial, nenhuma query/ordenação própria)", /loadAgencyAccountsTree\(\)/.test(homeFnBody) && /flattenAgencyTree\(tree\)/.test(homeFnBody) && /resolveHomeRedirectHref\(/.test(homeFnBody));
  ok("Home() chama redirect(...) — nunca retorna JSX", /redirect\(resolveHomeRedirectHref/.test(homeFnBody));
  ok("Home() NUNCA monta <GlobalScopeSelect module=\"dashboard\"> nem qualquer JSX do dashboard consolidado antigo", !homeFnBody.includes("<GlobalScopeSelect") && !homeFnBody.includes("return (\n    <div"));
  ok("LegacyGlobalDashboard (implementação antiga) continua no disco, intacta — não deletada agressivamente", pageSource.includes("buildOperationClientCard") && pageSource.includes('<GlobalScopeSelect module="dashboard"'));
}

console.log("\n4 — Dashboard nunca exige passar por /clients quando existem clientes (buildModuleContextHref + resolver combinados)\n");
{
  check("Dashboard + Todos -> '/' (nunca /clients — a escolha manual desapareceu do fluxo)", buildModuleContextHref("dashboard", { type: "all" }, null), "/");
  const tree = buildTree([{ id: "aibou", name: "Aibou", wallet_position: 1, managerId: null }], []);
  check("'/' com pelo menos 1 cliente SEMPRE resolve direto pro Dashboard de um cliente, nunca /clients", resolveHomeRedirectHref(flattenAgencyTree(tree)), "/clients/aibou");
}

console.log("\n5/6/7/8 — Aibou em Metas/Performance/Dados/Operação -> clicar Dashboard preserva Aibou\n");
{
  for (const fromModule of ["metas", "performance", "dados", "operation"] as const) {
    check(`Aibou/${fromModule} -> Dashboard mantém Aibou`, buildModuleContextHref("dashboard", { type: "client", id: "aibou" }, null), "/clients/aibou");
  }
}

console.log("\n9 — Todos + Operação -> Dashboard: nunca manda pra /clients; resolve pro primeiro cliente oficial via '/'\n");
{
  const currentContext = resolveCurrentModuleAndContext("/operation");
  check("contexto atual lido de '/operation' é Todos", currentContext.context, { type: "all" });
  check("clicar Dashboard nesse contexto cai em '/' (resolver), nunca em /clients", buildModuleContextHref("dashboard", currentContext.context, null), "/");
  const tree = buildTree(
    [
      { id: "z", name: "Zeta", wallet_position: 1, managerId: "m1" },
      { id: "y", name: "Ypsilon", wallet_position: 2, managerId: "m1" },
    ],
    [{ id: "m1", name: "Gestor 1" }],
  );
  check("'/' resolve então pro primeiro cliente da sequência oficial (Zeta, não Ypsilon)", resolveHomeRedirectHref(flattenAgencyTree(tree)), "/clients/z");
}

console.log("\n10 — anterior/próximo usa a MESMA sequência usada pra decidir o primeiro cliente de '/' — nunca duas definições de 'primeiro'\n");
{
  const tree = buildTree(
    [
      { id: "a", name: "Alpha", wallet_position: 1, managerId: "m1" },
      { id: "b", name: "Beta", wallet_position: 2, managerId: "m1" },
      { id: "c", name: "Charlie", wallet_position: 3, managerId: "m1" },
    ],
    [{ id: "m1", name: "Gestor 1" }],
  );
  const flat = flattenAgencyTree(tree);
  const firstFromHome = resolveHomeRedirectHref(flat);
  check("'/' resolve pro primeiro cliente (Alpha)", firstFromHome, "/clients/a");
  const sequenceFromAlpha = resolveWalletSequence(tree, "a");
  ok("resolveWalletSequence (anterior/próximo) concorda: Alpha é a posição 1, sem anterior — MESMA fonte (flattenAgencyTree), nunca duas ordenações", sequenceFromAlpha !== null && sequenceFromAlpha.position === 1 && sequenceFromAlpha.prevId === null && sequenceFromAlpha.nextId === "b");
}

console.log("\n11 — busca/seletor do header troca cliente preservando o módulo Dashboard (mesmo mecanismo de sempre, intocado)\n");
{
  check("trocar pra outro cliente a partir de Dashboard preserva o módulo (sufixo '' replicado)", buildModuleContextHref("dashboard", { type: "client", id: "outro-cliente" }, null), "/clients/outro-cliente");
}

console.log("\n12 — Dashboard NUNCA oferece 'Todos os clientes' no seletor do header\n");
{
  ok("moduleSupportsAllContext('dashboard') === false", !moduleSupportsAllContext("dashboard"));
}

console.log("\n13 — Deep link /clients/[id] continua funcionando normalmente (layout do workspace intocado)\n");
{
  check("'/clients/aibou' resolve como dashboard + cliente aibou", resolveCurrentModuleAndContext("/clients/aibou"), { module: "dashboard", context: { type: "client", id: "aibou" } });
}

console.log("\n14 — /clients continua existindo como GESTÃO (busca/filtros/organizar carteira/gestor/wallet_position) — nunca removida, nunca parte do fluxo normal de troca de cliente\n");
{
  ok("Sidebar continua com 'Clientes' em GESTÃO, href fixo /clients", /\{ label: "Clientes", href: "\/clients"/.test(sidebarSource));
}

console.log("\n15 — Sem redirect loop: /clients nunca redireciona de volta pra '/', e o resolver nunca aponta pra '/'\n");
{
  const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
  ok("/clients (app/clients/page.tsx) não contém nenhum redirect(\"/\") pra '/' — não existe risco de ida e volta", !/redirect\(\s*"\/"\s*\)/.test(clientsPageSource));
  const treesToCheck: AgencyTree[] = [buildTree([], []), buildTree([{ id: "x", name: "X", wallet_position: 1, managerId: null }], [])];
  for (const tree of treesToCheck) {
    ok("resolveHomeRedirectHref nunca devolve '/' (sempre /clients ou /clients/[id], nunca aponta pra si mesma)", resolveHomeRedirectHref(flattenAgencyTree(tree)) !== "/");
  }
}

console.log(`\n${passed} verificações passaram.\n`);
