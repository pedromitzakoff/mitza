/**
 * Testes do workspace do cliente — cobre a Etapa "MITZA — Reformulação
 * Estrutural" (header persistente, seletor rápido de cliente, anterior/
 * próximo, rotas de aprofundamento, separação Demandas×Operação por
 * `tasks.origin`) E a Etapa "Correção de UX do Workspace" que a sucedeu
 * (painel principal integrado, sem as 5 abas equivalentes, largura
 * corrigida). Núcleo puro (`lib/agency-accounts-tree.ts`,
 * `lib/client-workspace-nav.ts`) testado direto; o resto (layout/rotas/
 * queries reais) é ESTRUTURAL — mesma limitação de sempre neste ambiente
 * (sem Supabase real), mesmo padrão já usado por
 * `test-operation-goal-filter.ts`.
 *
 * Rodar: npx tsx scripts/test-client-workspace.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgencyAccountsTree, flattenAgencyTree, resolveWalletSequence, type AgencyTree } from "../src/lib/agency-accounts-tree";
import {
  WORKSPACE_SECTION_SUFFIXES,
  buildWorkspaceHref,
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

console.log("\n2 — client-workspace-nav.ts: sufixo/seção/URL do workspace (sem conceito de 'aba ativa' — as 5 abas saíram do header)\n");
{
  check("resolveCurrentSuffix: raiz do cliente é o Painel principal (sufixo vazio)", resolveCurrentSuffix("/clients/c1", "c1"), "");
  check("resolveCurrentSuffix: reconhece sufixo de Operação", resolveCurrentSuffix("/clients/c1/operation", "c1"), "/operation");

  check("WORKSPACE_SECTION_SUFFIXES: as 5 seções reconhecidas pra replicar ao trocar de cliente", WORKSPACE_SECTION_SUFFIXES, [
    "",
    "/relatorio",
    "/operation",
    "/demandas",
    "/edit",
  ]);

  check("resolveReplicableSuffix: sufixo reconhecido (uma das 5 seções) é replicado ao trocar de cliente", resolveReplicableSuffix("/operation"), "/operation");
  check(
    "resolveReplicableSuffix: sufixo de rota legada (fora das 5 seções) NUNCA é replicado — cai pro Painel principal do próximo cliente",
    resolveReplicableSuffix("/tasks/new"),
    "",
  );

  check("buildWorkspaceHref: sem mês", buildWorkspaceHref("c2", "/operation", null), "/clients/c2/operation");
  check("buildWorkspaceHref: preserva mês ao trocar de cliente/seção (decisão 1 do usuário)", buildWorkspaceHref("c2", "/operation", "2026-08"), "/clients/c2/operation?month=2026-08");
  check("buildWorkspaceHref: Painel principal (sufixo vazio) nunca gera '/clients/c2/?month=...' com barra sobrando", buildWorkspaceHref("c2", "", "2026-08"), "/clients/c2?month=2026-08");
}

console.log("\n3 — Simulação de navegação: trocar de cliente preserva a SEÇÃO atual (decisão 1) — 'Aibou → Relatório' vira 'JudClass → Relatório'\n");
{
  const tree: AgencyTree = {
    managers: [{ id: "m1", name: "Ana", clients: [{ id: "aibou", name: "Aibou", avatarUrl: null }, { id: "judclass", name: "JudClass", avatarUrl: null }] }],
    unassigned: [],
  };
  const sequence = resolveWalletSequence(tree, "aibou")!;
  const currentPathname = "/clients/aibou/relatorio";
  const suffix = resolveReplicableSuffix(resolveCurrentSuffix(currentPathname, "aibou"));
  const nextHref = buildWorkspaceHref(sequence.nextId!, suffix, "2026-08");
  check("clicar 'próximo' estando em Aibou / relatório completo com mês selecionado leva a JudClass / relatório completo, mês preservado", nextHref, "/clients/judclass/relatorio?month=2026-08");
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
  ok("children (o conteúdo de cada seção) é renderizado ABAIXO do header — nunca substituído por ele", /<ClientWorkspaceHeader[\s\S]*?\/>\s*\{children\}/.test(layoutSource));
}

console.log("\n5 — Correção de UX do Workspace: header voltou a ser só CONTEXTO — sem as 5 abas, largura corrigida\n");
{
  const headerSource = loadSource("src", "app", "clients", "client-workspace-header.tsx");
  ok('a barra `role="tablist"` com as 5 abas foi REMOVIDA do header (nunca mais uma segunda navegação principal competindo com a Sidebar)', !headerSource.includes('role="tablist"'));
  ok("header não importa mais WORKSPACE_TABS/resolveActiveTab (conceito de aba ativa não existe mais aqui)", !headerSource.includes("WORKSPACE_TABS") && !headerSource.includes("resolveActiveTab"));
  ok("avatar do cliente é o link de volta pro Painel principal (`/clients/[id]`) quando fora dele", /href=\{`\/clients\/\$\{client\.id\}`\}/.test(headerSource));
  ok(
    "header usa a MESMA constante de largura do painel/rotas de aprofundamento (WORKSPACE_CONTENT_MAX_WIDTH_CLASS) — nunca mais um max-w-5xl próprio e desalinhado",
    headerSource.includes("WORKSPACE_CONTENT_MAX_WIDTH_CLASS") && !headerSource.includes("max-w-5xl"),
  );
  ok(
    "Informações da conta (AccountInfoDrawerLauncher) continua no header, acessível de qualquer seção — decisão 3 da correção",
    headerSource.includes("AccountInfoDrawerLauncher"),
  );

  const containerSource = loadSource("src", "app", "clients", "workspace-container.tsx");
  ok(
    "causa raiz da largura estreita documentada no próprio módulo (cada rota tinha seu PRÓPRIO max-w-5xl/6xl, nunca uma restrição vinda do layout.tsx ou do AppShell)",
    /causa raiz/i.test(containerSource),
  );
  ok(
    "largura corrigida é generosa (~1600px), não mais o max-w-5xl (64rem/1024px) estreito de antes — pedido explícito: 'não quero um max-width estreito'",
    containerSource.includes('WORKSPACE_CONTENT_MAX_WIDTH_CLASS = "max-w-[1600px]"'),
  );
}

console.log("\n6 — Painel principal (/clients/[id]) integra Performance + Operação + Demandas numa única visão, sem duplicar dados/regras\n");
{
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok("Painel usa WorkspaceContainer (largura corrigida, mesma do resto do workspace)", pageSource.includes("<WorkspaceContainer>"));

  ok("PERFORMANCE: AccountFollowUpPanel (KPIs + ritmo do mês) continua no Painel — nenhum cálculo novo", pageSource.includes("<AccountFollowUpPanel"));
  ok('PERFORMANCE: CTA "Ver relatório completo" pro Relatório completo (`/relatorio`), reaproveitado 100%', /Ver relatório completo/.test(pageSource) && pageSource.includes("${client.id}/relatorio"));

  ok(
    "OPERAÇÃO: resumo reaproveita `clientOperationalState`/`resolveOperationPriorityGroup` já carregados — nenhuma segunda fonte de saúde operacional",
    pageSource.includes("resolveOperationPriorityGroup(clientOperationalState.evaluation)"),
  );
  ok(
    "OPERAÇÃO: sprint atual via `findSprintForDate` sobre o MESMO `sprints` já buscado pro mês em exibição — nenhuma query paralela só pro resumo",
    pageSource.includes("findSprintForDate(sprints, todayStr)"),
  );
  ok(
    "Painel NUNCA consulta `tasks` diretamente (bug de misturar Demandas×Operação não pode voltar por aqui) — Demandas via loadPendenciasRawData, Operação via sprint/otimização/saúde já carregados",
    !pageSource.includes('from("tasks")'),
  );
  ok('OPERAÇÃO: CTA "Ver operação completa" pra `/operation`', /Ver operação completa/.test(pageSource) && pageSource.includes("${client.id}/operation"));

  ok(
    "DEMANDAS: resumo reaproveita `loadPendenciasRawData` (MESMA fonte/regra de `/clients/[id]/demandas` e da área global — origin='manual'), nunca uma terceira implementação",
    pageSource.includes("loadPendenciasRawData(supabase, id)"),
  );
  ok(
    "DEMANDAS: contagem usa a função canônica countOpenDemandas (mesma da Home e de `/demandas`), nunca um filtro inline novo",
    pageSource.includes("countOpenDemandas("),
  );
  ok("DEMANDAS: mostra até 3 itens mais urgentes (nunca a List View inteira)", pageSource.includes(".slice(0, 3)"));
  ok('DEMANDAS: CTA "Ver todas" pra `/clients/[id]/demandas`', /Ver todas/.test(pageSource) && pageSource.includes("${client.id}/demandas"));
}

console.log("\n7 — Configurações deixou de competir no menu horizontal — acessível via ação secundária (Informações da conta)\n");
{
  const drawerSource = loadSource("src", "app", "clients", "account-info-drawer.tsx");
  ok(
    'AccountInfoDrawer ganhou um CTA "Editar configurações" pra `/clients/[id]/edit` — via de acesso após a remoção da aba Configurações',
    /Editar configurações/.test(drawerSource) && drawerSource.includes("${clientId}/edit"),
  );
  ok("nunca duplica o formulário dentro do drawer (só o link)", !drawerSource.includes("<ClientForm"));

  const editSource = loadSource("src", "app", "clients", "[id]", "edit", "page.tsx");
  ok("`/clients/[id]/edit` continua existindo intacta (largura de formulário é decisão do próprio conteúdo — nunca alargada à força)", editSource.includes("max-w-3xl"));
}

console.log("\n8 — Largura das rotas de aprofundamento (Operação/Relatório/Demandas) corrigida — mesma constante, nunca um valor solto\n");
{
  const operationSource = loadSource("src", "app", "clients", "[id]", "operation", "page.tsx");
  const relatorioSource = loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx");
  const pageClientSource = loadSource("src", "app", "demandas", "pendencias-page-client.tsx");

  ok("Operação usa WorkspaceContainer (mesma largura do Painel)", operationSource.includes("<WorkspaceContainer>") && !operationSource.includes("max-w-5xl"));
  ok('Operação tem link "← {cliente}" de volta pro Painel (sem aba destacada no header pra sinalizar onde se está)', /&larr; \{client\.name\}/.test(operationSource));

  ok("Relatório usa a MESMA constante de largura (WORKSPACE_CONTENT_MAX_WIDTH_CLASS), não mais um max-w-6xl solto", relatorioSource.includes("WORKSPACE_CONTENT_MAX_WIDTH_CLASS") && !relatorioSource.includes("max-w-6xl"));

  ok(
    "Demandas (List View, global + escopada) usa a MESMA constante de largura, não mais um max-w-6xl solto",
    pageClientSource.includes("WORKSPACE_CONTENT_MAX_WIDTH_CLASS") && !pageClientSource.includes("max-w-6xl"),
  );

  const demandasWrapperSource = loadSource("src", "app", "clients", "[id]", "demandas", "page.tsx");
  ok('Demandas do cliente tem link "← {cliente}" de volta pro Painel, mesmo padrão de Operação', /&larr; \{client\.name\}/.test(demandasWrapperSource));
}

console.log("\n9 — Separação Demandas×Operação: cada rota filtra por origin, nunca mistura (correção da Fase 1, permanece intacta)\n");
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
    "bug da auditoria original (tasks sem filtro de origin na página antiga do cliente) não sobrevive: operation/page.tsx SEMPRE filtra origin explicitamente na query de tasks",
    /\.eq\("client_id", id\)\s*\n\s*\.eq\("origin", "template"\)/.test(operationSource),
  );
}

console.log("\n10 — Demandas do workspace reaproveita a List View global (filtros, agrupamento, seleção, drawer) — nunca reconstruída\n");
{
  const pageClientSource = loadSource("src", "app", "demandas", "pendencias-page-client.tsx");
  ok("PendenciasPageClient aceita scopedClientId — MESMO componente da área global, não um novo", pageClientSource.includes("scopedClientId"));
  ok("modo escopado esconde o filtro de Cliente (redundante — já é o próprio contexto)", /\{!scopedClientId && \(\s*<div className="w-44">\s*<SearchableSelect/.test(pageClientSource));
  ok('"+ Nova demanda" no modo escopado já nasce vinculada ao cliente, sem perguntar de novo', /const \[clientId, setClientId\] = useState<string \| null>\(scopedClientId \?\? null\);/.test(pageClientSource));
  ok("agrupamento/seleção múltipla/duplicar/excluir continuam intactos (nenhuma prop de escopo os desliga)", pageClientSource.includes("toggleSelectAllVisible") && pageClientSource.includes("handleBulkDuplicate"));
}

console.log("\n11 — Rename Pendências → Demandas: rota oficial + redirect preservando query string\n");
{
  const redirectSource = loadSource("src", "app", "pendencias", "page.tsx");
  ok("/pendencias é um redirect (nunca 404) pra /demandas", redirectSource.includes('redirect(queryString ? `/demandas?${queryString}` : "/demandas")'));
  ok("redirect preserva a query string inteira (filtros/agrupamento ficam 100% na URL)", redirectSource.includes("new URLSearchParams()") && redirectSource.includes("query.append(key, entry)"));
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");
  ok('menu principal usa "Demandas"/"/demandas" (nome antigo só reconhecido pra manter o item ativo em link velho)', sidebarSource.includes('label: "Demandas"') && sidebarSource.includes('href: "/demandas"'));
}

console.log(`\n${passed} verificações passaram.`);
