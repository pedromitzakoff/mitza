/**
 * Testes da Etapa "Correção do fluxo final do Dashboard" — o fluxo
 * correto é SEMPRE a experiência individual de `/clients/[id]`: abrir o
 * MITZA leva direto ao Dashboard de um cliente real (nunca "/ ->
 * /clients -> escolher -> Dashboard"), e "/" virou um RESOLVER
 * server-side que entra na carteira pela MESMA sequência oficial de
 * anterior/próximo (`flattenAgencyTree`) e redireciona pro primeiro
 * cliente.
 *
 * KOFF Analytics — Etapa 1.8: `LegacyGlobalDashboard` (o dashboard
 * consolidado antigo, confirmado 100% inalcançável desde a Etapa "Correção
 * do fluxo final do Dashboard") foi removido por completo de
 * `src/app/page.tsx` — a maior parte do que restava dele era exatamente a
 * camada operacional (Operação, account_reviews, atividade operacional)
 * que esta etapa elimina. Os testes que dependiam dele continuar no disco,
 * e os testes de `buildModuleContextHref`/`moduleSupportsAllContext`/
 * `resolveCurrentModuleAndContext` (`client-workspace-nav.ts` — sistema de
 * "módulos" removido nesta mesma etapa, já sem nenhum consumidor real
 * desde que `GlobalScopeSelect` saiu do produto), foram retirados. O que
 * resta aqui é só o núcleo que continua valendo: o próprio resolver "/" e
 * a sequência oficial da carteira que ele usa.
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

console.log("\n3 — '/' é só o resolver: Home() é o único export default, nunca renderiza dashboard consolidado algum\n");
{
  ok("'export default async function Home()' existe em page.tsx", pageSource.includes("export default async function Home()"));
  ok("Home() chama loadAgencyAccountsTree + flattenAgencyTree + resolveHomeRedirectHref (mesmo núcleo da sequência oficial, nenhuma query/ordenação própria)", /loadAgencyAccountsTree\(\)/.test(pageSource) && /flattenAgencyTree\(tree\)/.test(pageSource) && /resolveHomeRedirectHref\(/.test(pageSource));
  ok("Home() chama redirect(...) — nunca retorna JSX", /redirect\(resolveHomeRedirectHref/.test(pageSource));
  ok(
    "LegacyGlobalDashboard (implementação antiga, confirmada 100% inalcançável) foi removida por completo — nenhum export/JSX dela resta em page.tsx (menção em comentário histórico é esperada)",
    !pageSource.includes("export async function LegacyGlobalDashboard") && !pageSource.includes("buildOperationClientCard") && !pageSource.includes("GlobalScopeSelect"),
  );
}

console.log("\n4 — '/' com pelo menos 1 cliente sempre resolve direto pro Dashboard de um cliente, nunca /clients\n");
{
  const tree = buildTree([{ id: "aibou", name: "Aibou", wallet_position: 1, managerId: null }], []);
  check("'/' com pelo menos 1 cliente SEMPRE resolve direto pro Dashboard de um cliente, nunca /clients", resolveHomeRedirectHref(flattenAgencyTree(tree)), "/clients/aibou");
}

console.log("\n5 — anterior/próximo usa a MESMA sequência usada pra decidir o primeiro cliente de '/' — nunca duas definições de 'primeiro'\n");
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

console.log("\n6 — Sem redirect loop: /clients nunca redireciona de volta pra '/', e o resolver nunca aponta pra '/'\n");
{
  const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
  ok("/clients (app/clients/page.tsx) não contém nenhum redirect(\"/\") pra '/' — não existe risco de ida e volta", !/redirect\(\s*"\/"\s*\)/.test(clientsPageSource));
  const treesToCheck: AgencyTree[] = [buildTree([], []), buildTree([{ id: "x", name: "X", wallet_position: 1, managerId: null }], [])];
  for (const tree of treesToCheck) {
    ok("resolveHomeRedirectHref nunca devolve '/' (sempre /clients ou /clients/[id], nunca aponta pra si mesma)", resolveHomeRedirectHref(flattenAgencyTree(tree)) !== "/");
  }
}

console.log(`\n${passed} verificações passaram.\n`);
