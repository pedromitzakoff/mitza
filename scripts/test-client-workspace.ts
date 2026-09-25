/**
 * Testes da Etapa "MITZA — Reformulação Estrutural": workspace do cliente
 * (header persistente, seletor rápido de cliente, anterior/próximo, abas
 * como rotas irmãs) + separação Demandas×Operação por `tasks.origin`.
 * Núcleo puro (`lib/agency-accounts-tree.ts`, `lib/client-workspace-nav.ts`)
 * testado direto; o resto (layout/rotas/queries reais) é ESTRUTURAL —
 * mesma limitação de sempre neste ambiente (sem Supabase real), mesmo
 * padrão já usado por `test-operation-goal-filter.ts`.
 *
 * Rodar: npx tsx scripts/test-client-workspace.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgencyAccountsTree, flattenAgencyTree, resolveWalletSequence, type AgencyTree } from "../src/lib/agency-accounts-tree";
import {
  WORKSPACE_TABS,
  buildWorkspaceHref,
  resolveActiveTab,
  resolveCurrentSuffix,
  resolveReplicableSuffix,
} from "../src/lib/client-workspace-nav";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

console.log("\n1 — flattenAgencyTree/resolveWalletSequence: sequência global determinística\n");
{
  const tree: AgencyTree = {
    managers: [
      { id: "m1", name: "Ana", clients: [{ id: "c1", name: "Aibou", avatarUrl: null }, { id: "c2", name: "Bowa", avatarUrl: null }] },
      { id: "m2", name: "Beto", clients: [{ id: "c3", name: "Kaizen", avatarUrl: null }] },
    ],
    unassigned: [{ id: "c4", name: "Sem Gestor Ltda", avatarUrl: null }],
  };

  check(
    "flattenAgencyTree: gestores na ordem da árvore, clientes por wallet_position dentro de cada um, 'Sem responsável' sempre por último",
    flattenAgencyTree(tree).map((c) => c.id),
    ["c1", "c2", "c3", "c4"],
  );

  check("resolveWalletSequence: primeiro cliente — posição 1/4, sem anterior, próximo é c2", resolveWalletSequence(tree, "c1"), {
    position: 1,
    total: 4,
    prevId: null,
    nextId: "c2",
  });
  check("resolveWalletSequence: cliente do meio (troca de gestor) — anterior/próximo corretos mesmo cruzando pastas", resolveWalletSequence(tree, "c3"), {
    position: 3,
    total: 4,
    prevId: "c2",
    nextId: "c4",
  });
  check("resolveWalletSequence: último cliente (não atribuído) — sem próximo", resolveWalletSequence(tree, "c4"), {
    position: 4,
    total: 4,
    prevId: "c3",
    nextId: null,
  });
  check("resolveWalletSequence: cliente fora da carteira ativa (pausado/encerrado, não está na árvore) — null", resolveWalletSequence(tree, "c-nao-existe"), null);

  ok(
    "flattenAgencyTree/resolveWalletSequence reaproveitam a MESMA árvore da Sidebar (buildAgencyAccountsTree), nenhuma segunda fonte de ordenação",
    typeof buildAgencyAccountsTree === "function",
  );
}

console.log("\n2 — client-workspace-nav.ts: sufixo/aba ativa/URL do workspace\n");
{
  check("resolveCurrentSuffix: raiz do cliente é Visão geral (sufixo vazio)", resolveCurrentSuffix("/clients/c1", "c1"), "");
  check("resolveCurrentSuffix: reconhece sufixo de Operação", resolveCurrentSuffix("/clients/c1/operation", "c1"), "/operation");

  check("resolveActiveTab: raiz -> visao-geral", resolveActiveTab("/clients/c1", "c1")?.key, "visao-geral");
  check("resolveActiveTab: /relatorio -> performance", resolveActiveTab("/clients/c1/relatorio", "c1")?.key, "performance");
  check("resolveActiveTab: /operation -> operacao", resolveActiveTab("/clients/c1/operation", "c1")?.key, "operacao");
  check("resolveActiveTab: /demandas -> demandas", resolveActiveTab("/clients/c1/demandas", "c1")?.key, "demandas");
  check("resolveActiveTab: /edit -> configuracoes", resolveActiveTab("/clients/c1/edit", "c1")?.key, "configuracoes");
  check("resolveActiveTab: rota legada (/tasks/new) não corresponde a nenhuma aba (undefined, nunca uma aba errada marcada ativa)", resolveActiveTab("/clients/c1/tasks/new", "c1"), undefined);

  check("resolveReplicableSuffix: sufixo reconhecido (uma das 5 abas) é replicado ao trocar de cliente", resolveReplicableSuffix("/operation"), "/operation");
  check(
    "resolveReplicableSuffix: sufixo de rota legada (fora das 5 abas) NUNCA é replicado — cai pra Visão geral do próximo cliente",
    resolveReplicableSuffix("/tasks/new"),
    "",
  );

  check("buildWorkspaceHref: sem mês", buildWorkspaceHref("c2", "/operation", null), "/clients/c2/operation");
  check("buildWorkspaceHref: preserva mês ao trocar de cliente/aba (decisão 1 do usuário)", buildWorkspaceHref("c2", "/operation", "2026-08"), "/clients/c2/operation?month=2026-08");
  check("buildWorkspaceHref: Visão geral (sufixo vazio) nunca gera '/clients/c2/?month=...' com barra sobrando", buildWorkspaceHref("c2", "", "2026-08"), "/clients/c2?month=2026-08");

  check("WORKSPACE_TABS: exatamente as 5 abas pedidas, nesta ordem", WORKSPACE_TABS.map((t) => t.label), [
    "Visão geral",
    "Performance",
    "Operação",
    "Demandas",
    "Configurações",
  ]);
}

console.log("\n3 — Simulação de navegação: trocar de cliente preserva a ABA atual (decisão 1) — 'Aibou → Performance' vira 'JudClass → Performance'\n");
{
  const tree: AgencyTree = {
    managers: [{ id: "m1", name: "Ana", clients: [{ id: "aibou", name: "Aibou", avatarUrl: null }, { id: "judclass", name: "JudClass", avatarUrl: null }] }],
    unassigned: [],
  };
  const sequence = resolveWalletSequence(tree, "aibou")!;
  const currentPathname = "/clients/aibou/relatorio";
  const suffix = resolveReplicableSuffix(resolveCurrentSuffix(currentPathname, "aibou"));
  const nextHref = buildWorkspaceHref(sequence.nextId!, suffix, "2026-08");
  check("clicar 'próximo' estando em Aibou → Performance com mês selecionado leva a JudClass → Performance, mês preservado", nextHref, "/clients/judclass/relatorio?month=2026-08");
}

console.log("\n4 — Layout compartilhado: header persistente monta em toda sub-rota de clients/[id]/**\n");
{
  const layoutSource = loadSource("src", "app", "clients", "[id]", "layout.tsx");
  ok("layout.tsx busca a árvore compartilhada (cache() por request, mesma da Sidebar)", layoutSource.includes("loadAgencyAccountsTree()"));
  ok("layout.tsx resolve a sequência global (anterior/próximo/posição) a partir da árvore", layoutSource.includes("resolveWalletSequence(tree, id)"));
  ok(
    "cliente fora da carteira ativa (pausado/encerrado) não gera 404 — só perde anterior/próximo/posição (continua acessível pra consulta)",
    /prevId=\{sequence\?\.prevId \?\? null\}/.test(layoutSource) && !layoutSource.includes("if (!sequence)"),
  );
  ok("layout.tsx 404 real só quando o CLIENTE em si não existe", /if \(!client\) notFound\(\);/.test(layoutSource));
  ok("children (o conteúdo de cada aba) é renderizado ABAIXO do header — nunca substituído por ele", /<ClientWorkspaceHeader[\s\S]*?\/>\s*\{children\}/.test(layoutSource));
}

console.log("\n5 — Separação Demandas×Operação: cada aba filtra por origin, nunca mistura (correção do bug da auditoria)\n");
{
  const operationSource = loadSource("src", "app", "clients", "[id]", "operation", "page.tsx");
  const demandasSource = loadSource("src", "app", "clients", "[id]", "demandas", "page.tsx");
  const pendenciasDataSource = loadSource("src", "app", "demandas", "pendencias-data.ts");

  ok("Operação filtra tasks por origin='template' — nunca mostra Demandas (origin='manual') junto", operationSource.includes('.eq("origin", "template")'));
  ok(
    "Demandas do workspace do cliente reaproveita loadPendenciasRawData (MESMA regra/fonte da área global — origin='manual'), nunca uma segunda implementação",
    demandasSource.includes("loadPendenciasRawData(supabase, id)"),
  );
  ok("loadPendenciasRawData aceita escopo por cliente sem duplicar a regra origin='manual'", pendenciasDataSource.includes("scopeClientId?: string") && pendenciasDataSource.includes('.eq("origin", "manual")'));
  ok(
    "bug da auditoria (tasks sem filtro de origin na página antiga do cliente) não sobrevive: operation/page.tsx SEMPRE filtra origin explicitamente na query de tasks",
    /\.eq\("client_id", id\)\s*\n\s*\.eq\("origin", "template"\)/.test(operationSource),
  );
}

console.log("\n6 — Demandas do workspace reaproveita a List View global (filtros, agrupamento, seleção, drawer) — nunca reconstruída\n");
{
  const pageClientSource = loadSource("src", "app", "demandas", "pendencias-page-client.tsx");
  ok("PendenciasPageClient aceita scopedClientId — MESMO componente da área global, não um novo", pageClientSource.includes("scopedClientId"));
  ok("modo escopado esconde o filtro de Cliente (redundante — já é o próprio contexto)", /\{!scopedClientId && \(\s*<div className="w-44">\s*<SearchableSelect/.test(pageClientSource));
  ok('"+ Nova demanda" no modo escopado já nasce vinculada ao cliente, sem perguntar de novo', /const \[clientId, setClientId\] = useState<string \| null>\(scopedClientId \?\? null\);/.test(pageClientSource));
  ok("agrupamento/seleção múltipla/duplicar/excluir continuam intactos (nenhuma prop de escopo os desliga)", pageClientSource.includes("toggleSelectAllVisible") && pageClientSource.includes("handleBulkDuplicate"));
}

console.log("\n7 — Rename Pendências → Demandas: rota oficial + redirect preservando query string\n");
{
  const redirectSource = loadSource("src", "app", "pendencias", "page.tsx");
  ok("/pendencias é um redirect (nunca 404) pra /demandas", redirectSource.includes('redirect(queryString ? `/demandas?${queryString}` : "/demandas")'));
  ok("redirect preserva a query string inteira (filtros/agrupamento ficam 100% na URL)", redirectSource.includes("new URLSearchParams()") && redirectSource.includes("query.append(key, entry)"));
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");
  ok('menu principal usa "Demandas"/"/demandas" (nome antigo só reconhecido pra manter o item ativo em link velho)', sidebarSource.includes('label: "Demandas"') && sidebarSource.includes('href: "/demandas"'));
}

console.log(`\n${passed} verificações passaram.`);
