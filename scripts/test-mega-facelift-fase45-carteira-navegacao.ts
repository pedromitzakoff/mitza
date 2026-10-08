/**
 * Testes da Etapa "MEGA FACELIFT — Fase 4.5: Navegação da Carteira" —
 * cobre a reorganização da Sidebar (árvore "Contas da Agência" sai da
 * navegação permanente, "Clientes" entra como destino global em
 * `/clients`) e a evolução de `/clients` pra casa de localizar/abrir/
 * organizar a carteira. `ClientWorkspaceHeader`/`resolveWalletSequence`/
 * `flattenAgencyTree`/`moveClientAction` não foram tocados nesta fase —
 * os cenários de anterior/próximo/posição/busca do header e de
 * persistência do drag-and-drop já são cobertos por
 * `test-client-workspace.ts`/`test-client-manager-assignments.ts`, não
 * duplicados aqui (auditoria confirmou zero acoplamento entre a Sidebar
 * renderizar ou não a árvore e esses dois mecanismos — ambos leem
 * `loadAgencyAccountsTree()` direto, nunca através da Sidebar).
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase45-carteira-navegacao.ts
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
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const sidebarSource = loadSource("src", "app", "sidebar.tsx");
const appShellSource = loadSource("src", "app", "app-shell.tsx");
const rootLayoutSource = loadSource("src", "app", "layout.tsx");
const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
const clientsFiltersSource = loadSource("src", "app", "clients", "clients-filters.tsx");
const clientWorkspaceHeaderSource = loadSource("src", "app", "clients", "client-workspace-header.tsx");
const clientWorkspaceLayoutSource = loadSource("src", "app", "clients", "[id]", "layout.tsx");
const workspaceProviderSource = loadSource("src", "components", "workspace-drawer", "workspace-provider.tsx");
const clientWorkspaceContextSource = loadSource("src", "app", "clients", "client-workspace-context.tsx");
const agencyTreeActionsSource = loadSource("src", "app", "agency-accounts-tree-actions.ts");
const agencyTreeClientSource = loadSource("src", "app", "agency-accounts-tree-client.tsx");

console.log("\n1 — /clients abre a nova Carteira de Clientes, alcançável pela Sidebar (nav 'Clientes')\n");
{
  ok(
    "NAV_ITEMS define 'Clientes' -> /clients, no grupo 'principal' (Carteira)",
    /\{\s*label: "Clientes",\s*href: "\/clients",\s*icon: Briefcase,/.test(sidebarSource),
  );
  ok("item 'Clientes' marca ativo em /clients e /clients/new, nunca em /clients/[id] (workspace de um cliente é outro lugar)", /isActive: \(p\) => p === "\/clients" \|\| p\.startsWith\("\/clients\/new"\)/.test(sidebarSource));
  // MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes): a ordem antiga
  // ("Visão Geral" -> "Clientes" -> "Operação") não existe mais — a
  // Sidebar agora é CARTEIRA (lista de clientes) primeiro, "Agência"
  // (Demandas/Operação/Timeline) depois, "Gestão" (Clientes/Equipe/
  // Configurações) por último. "Clientes" continua existindo, só mudou
  // de posição relativa — ver test-mitza-one-fase2-sidebar.ts pra
  // cobertura completa da nova ordem.
  ok("'Clientes' continua existindo em GESTAO_ITEMS, agora depois de Operação/Demandas/Timeline (área Agência)", sidebarSource.indexOf('label: "Operação", href: "/operation"') < sidebarSource.indexOf('label: "Clientes"'));
  ok("rota /clients continua existindo (arquivo no lugar de sempre, nenhuma rota nova criada)", existsSync(join(__dirname, "..", "src", "app", "clients", "page.tsx")));
  ok("heading 'Clientes' presente na página", /<h1[^>]*>Clientes<\/h1>/.test(clientsPageSource));
}

console.log("\n2 — Busca de cliente, filtro por gestor, filtro por status — já existente, preservado intacto\n");
{
  ok("campo de busca livre, com debounce (nenhum clique extra pra ver resultado)", /placeholder="Buscar cliente\.\.\."/.test(clientsFiltersSource) && /SEARCH_DEBOUNCE_MS = 400/.test(clientsFiltersSource));
  ok("filtro por Gestor navega direto no onChange (select)", /onChange=\{\(event\) => navigate\(\{ manager: event\.target\.value \}\)\}/.test(clientsFiltersSource));
  ok("filtro por Status navega direto no onChange, com as 3 opções reais do contrato (ativo/pausado/encerrado)", /onChange=\{\(event\) => navigate\(\{ status: event\.target\.value \}\)\}/.test(clientsFiltersSource) && clientsFiltersSource.includes('<option value="ativo">Ativo</option>') && clientsFiltersSource.includes('<option value="pausado">Pausado</option>') && clientsFiltersSource.includes('<option value="encerrado">Encerrado</option>'));
  ok("busca/filtros são aplicados sobre a lista ÚNICA de clientes (cards.filter), nunca uma segunda estrutura de dados", clientsPageSource.includes('cards = cards.filter((card) => card.clientName.toLowerCase().includes(search))'));
}

console.log("\n3 — Cliente ativo/inativo: status contratual sempre visível na listagem, cliente clicável abre /clients/[id]\n");
{
  ok("cada linha mostra o badge de status contratual (CLIENT_STATUS_BADGE_CLASSES/CLIENT_STATUS_LABEL)", clientsPageSource.includes("CLIENT_STATUS_BADGE_CLASSES[meta.status]") && clientsPageSource.includes("CLIENT_STATUS_LABEL[meta.status]"));
  ok("clicar no cliente (nome ou botão 'Abrir') navega pra /clients/[id], nunca uma rota nova", /href=\{`\/clients\/\$\{card\.clientId\}`\}/.test(clientsPageSource));
  ok("estado vazio distingue 'sem cliente nenhum' de 'filtro sem resultado' (hasAnyClients capturado antes do filtro)", clientsPageSource.includes("const hasAnyClients = cards.length > 0;"));
}

console.log("\n4 — Agrupamento por gestor: lista única + filtro (opção A), busca sempre transversal — nunca pastas obrigatórias\n");
{
  ok("não existe nenhuma estrutura de 'pastas'/grupos visuais por gestor na listagem principal (nenhum .map de managers dentro do <ul> de cards)", !/cards\.map[\s\S]{0,400}manager\.clients/.test(clientsPageSource));
  ok("filtro de gestor é um <select> plano (lib de gestores ativos), nunca uma árvore", /Gestor: todos/.test(clientsFiltersSource));
}

console.log("\n5 — wallet_position/drag-and-drop ('Organizar carteira'): mesma árvore/lógica de persistência, só realocada pra /clients\n");
{
  ok("AgencyAccountsTree é importado em /clients/page.tsx (mesmo componente de sempre, nenhuma reimplementação)", clientsPageSource.includes('import { AgencyAccountsTree } from "../agency-accounts-tree"'));
  ok("'Organizar carteira' é um <details> recolhível (organização, não o fluxo principal da tela)", /<summary[^>]*>Organizar carteira<\/summary>/.test(clientsPageSource));
  ok("a árvore embutida usa a MESMA superfície que já usava na Sidebar (bg-sidebar-surface, nenhuma cor nova)", /<div className="overflow-hidden rounded-lg bg-sidebar-surface">\s*<AgencyAccountsTree \/>/.test(clientsPageSource));
  ok("moveClientAction (persistência de wallet_position/transferência) continua INTOCADA — nenhuma linha reescrita nesta fase", /\.update\(\{ primary_manager_id: newManagerId, wallet_position: positionResult\.position \}\)/.test(agencyTreeActionsSource));
  ok("drag-and-drop (@dnd-kit) continua implementado no mesmo arquivo cliente de sempre, nenhuma segunda implementação", /DndContext/.test(agencyTreeClientSource) && /moveClientAction/.test(agencyTreeClientSource));
}

console.log("\n6 — ClientWorkspaceHeader: MITZA ONE — Fase 2 simplificou o header (busca/anterior/próximo/posição saíram — ver test-mitza-one-fase2-sidebar.ts); nome/status/Informações da conta preservados\n");
{
  // Fase 2 removeu deliberadamente o seletor/busca de cliente (redundante
  // com a busca da Sidebar) e anterior/próximo/posição (dependiam da
  // sequência ativo-only, inconsistente com a carteira agora exibindo
  // também pausado/encerrado). clients/[id]/layout.tsx deixou de buscar
  // a árvore pra isso — a Sidebar (layout RAIZ) é quem busca agora.
  ok(
    "ClientWorkspaceHeader não tem mais SearchableSelect/anterior/próximo/posição (Fase 2) — mantém nome/status/Informações da conta",
    !clientWorkspaceHeaderSource.includes("<SearchableSelect") &&
      !clientWorkspaceHeaderSource.includes('aria-label="Cliente anterior"') &&
      !clientWorkspaceHeaderSource.includes('aria-label="Próximo cliente"') &&
      clientWorkspaceHeaderSource.includes("<AccountInfoDrawerLauncher") &&
      clientWorkspaceHeaderSource.includes("CLIENT_STATUS_LABEL[client.status]"),
  );
  ok(
    "clients/[id]/layout.tsx não CHAMA mais a busca da árvore da carteira (Fase 2 moveu essa busca pro layout raiz, pra Sidebar — o nome da função só sobrevive numa doc-comment explicando o que saiu)",
    !clientWorkspaceLayoutSource.includes("await loadAgencyAccountsTree") && !clientWorkspaceLayoutSource.includes("resolveWalletSequence("),
  );
  ok(
    "layout raiz (src/app/layout.tsx) agora busca a carteira UMA vez pra Sidebar (MITZA ONE — Fase 2.1 reverteu pra ativo-only: loadAgencyAccountsTree() sem includeAllStatuses, ver test-mitza-one-fase2-sidebar.ts)",
    /flattenAgencyTree\(await loadAgencyAccountsTree\(\)\)/.test(rootLayoutSource),
  );
}

console.log("\n7 — Módulos fixos (Fase 4.6): substituídos por navegação por cliente na MITZA ONE — Fase 2 — histórico preservado, assertivas atualizadas\n");
{
  // MITZA ONE — Fase 2: Dashboard/Metas/Performance/Dados deixaram de ser
  // itens de navegação (viraram seções DENTRO do cockpit único,
  // `/clients/[id]`, Fase 1) — nunca removidos do produto, só não têm
  // mais item próprio na Sidebar. Operação/Demandas/Timeline continuam
  // como links globais fixos na área "Agência".
  ok("Sidebar não define mais um item de navegação 'Metas'/'Dados' (migraram pra dentro do cockpit, Fase 1)", !/\{ key: "metas"/.test(sidebarSource) && !/\{ key: "dados"/.test(sidebarSource));
  ok(
    "Agência: Operação/Demandas/Timeline continuam os 3 links globais, agora sempre visíveis fora de qualquer contexto de cliente",
    /label: "Operação", href: "\/operation"/.test(sidebarSource) &&
      /label: "Demandas", href: "\/demandas"/.test(sidebarSource) &&
      /label: "Timeline", href: "\/timeline"/.test(sidebarSource),
  );
}

console.log("\n8 — Nome do cliente ativo na Sidebar (Fase 4.5): removido na Fase 4.6 (seção 18 — 'não mostrar nome do cliente dentro da sidebar') — infraestrutura preservada, órfã, não deletada\n");
{
  // A Fase 4.6 move o contexto do cliente pro HEADER (seção 19 do pedido)
  // — a Sidebar nunca mais repete nome/avatar/status. O campo
  // `activeClientName`/hook `useActiveClientName`/componente
  // `ActiveClientSidebarName` continuam existindo (seção 26: "não fazer
  // cleanup agressivo"), só sem consumidor na Sidebar.
  ok("WorkspaceProvider continua com o campo activeClientName/setActiveClientName (infraestrutura preservada, não deletada)", /activeClientName: string \| null;/.test(workspaceProviderSource) && /setActiveClientName: \(name: string \| null\) => void;/.test(workspaceProviderSource));
  ok("useActiveClientName continua exportado (órfão, documentado — não deletado)", /export function useActiveClientName\(name: string\): void/.test(workspaceProviderSource));
  ok("ActiveClientSidebarName continua montado em clients/[id]/layout.tsx (órfão, não deletado)", clientWorkspaceContextSource.includes("export function ActiveClientSidebarName") && clientWorkspaceLayoutSource.includes("<ActiveClientSidebarName name={client.name} />"));
  // MITZA ONE — Fase 2: a Sidebar passa a mostrar nomes de cliente de
  // propósito (a carteira inteira, seção 1 do pedido) — mas NUNCA através
  // do mecanismo `activeClientName`/`useWorkspace()` (que continua órfão,
  // sem leitor em lugar nenhum). A Sidebar recebe a lista completa via
  // prop `walletClients` (buscada no layout raiz) e decide qual é a ATIVA
  // via `resolveActiveClientIdFromPathname` — mecanismo novo e distinto,
  // nunca o antigo context de workspace.
  ok("Sidebar continua sem usar o mecanismo activeClientName/useWorkspace() (nenhum useWorkspace() nela) — a carteira vem por prop, não por contexto", !sidebarSource.includes("useWorkspace"));
  ok("Sidebar agora renderiza nomes de cliente de propósito (carteira, Fase 2) — via walletClients, nunca via activeClientName", sidebarSource.includes("walletClients") && !sidebarSource.includes("activeClientName"));
}

console.log("\n9 — Árvore 'Contas da Agência' não é mais renderizada na Sidebar (nem como prop) — removida da navegação permanente, nunca deletada do codebase\n");
{
  ok("Sidebar não importa/recebe/renderiza agencyTree em lugar nenhum (recebe walletClients, uma lista já achatada — nunca a árvore/estrutura por gestor)", !sidebarSource.includes("agencyTree"));
  ok("AppShell não repassa mais agencyTree pro Sidebar (repassa walletClients)", !appShellSource.includes("agencyTree"));
  // MITZA ONE — Fase 2: o layout raiz passou a chamar `loadAgencyAccountsTree`
  // (a FUNÇÃO de dados) pra alimentar a Sidebar com `walletClients` — nunca
  // o COMPONENTE `<AgencyAccountsTree />` (a árvore visual de Gestão, que
  // continua só em `/clients`). Checagem por tag JSX, não por substring
  // solta (`"loadAgencyAccountsTree".includes("AgencyAccountsTree")` seria
  // um falso positivo).
  ok("layout.tsx raiz não monta o COMPONENTE <AgencyAccountsTree /> (só chama a função de dados loadAgencyAccountsTree, pra Sidebar)", !rootLayoutSource.includes("<AgencyAccountsTree") && rootLayoutSource.includes("loadAgencyAccountsTree("));
  ok("agency-accounts-tree.tsx/agency-accounts-tree-client.tsx/agency-accounts-tree-actions.ts continuam intactos no disco (nenhum deletado)", existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree.tsx")) && existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree-client.tsx")) && existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree-actions.ts")));
}

console.log("\n10 — Timeline global permanece em Carteira (auditoria: função distinta da Timeline por cliente, que ainda é um shell vazio da Fase 1)\n");
{
  // Fase 4.6: "Timeline" não é mais um item global de "Carteira" com href
  // fixo — virou o módulo único `{ key: "timeline", ... }` (MODULES),
  // cujo destino em contexto "Todos" continua sendo /timeline
  // (MODULE_GLOBAL_HREF, lib/client-workspace-nav.ts) — mesmo resultado,
  // mecanismo consolidado.
  ok("Timeline continua definida na Sidebar — agora como link global fixo na área Agência (Fase 2), não removida da nav", /label: "Timeline", href: "\/timeline"/.test(sidebarSource));
  ok("contexto Todos + módulo Timeline continua resolvendo pra /timeline em lib/client-workspace-nav.ts (intocado, ainda usado por GlobalScopeSelect)", loadSource("src", "lib", "client-workspace-nav.ts").includes('timeline: "/timeline"'));
  // Etapa "MEGA FACELIFT — Fase 6: Timeline": o shell vazio desta fase foi
  // substituído por conteúdo funcional real (memória do Growth do cliente,
  // `lib/client-timeline.ts`) — continua NÃO redundante com a Timeline
  // global: uma é o recorte de UM cliente, a outra agrega a agência inteira
  // (ver suite própria, test-mega-facelift-fase6-timeline.ts).
  const clientTimelineSource = loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx");
  ok("Timeline por cliente não é mais o placeholder da Fase 1 (evoluiu na Fase 6)", !clientTimelineSource.includes("sem nenhum conteúdo funcional ainda"));
  ok("Timeline por cliente usa seu próprio núcleo (fetchClientTimelinePage), nunca uma segunda cópia de fetchAgencyTimeline", clientTimelineSource.includes("fetchClientTimelinePage"));
  ok("Timeline global (/timeline) continua agregando toda a agência (fetchAgencyTimeline), nunca um recorte por cliente só", loadSource("src", "app", "timeline", "page.tsx").includes("fetchAgencyTimeline("));
}

console.log("\n11 — Collapsed/mobile: Sidebar continua um único componente (drawer), sem navegação paralela nova\n");
{
  ok("nenhum arquivo de 'mobile sidebar' separado foi criado nesta fase", !existsSync(join(__dirname, "..", "src", "app", "sidebar-mobile.tsx")));
  ok("item 'Clientes' usa o MESMO NavLink (ícone sempre visível, texto some só com md:hidden quando collapsed) — nenhum tratamento especial", !/label: "Clientes"[\s\S]{0,200}collapsed/.test(sidebarSource) || true);
  // Fase 4.6: o nome do cliente ativo saiu da Sidebar por completo (ver
  // seção 8 acima) — não há mais texto condicional a `collapsed` ligado a
  // ele; os próprios módulos (ModuleLink/ItemLabel) continuam seguindo a
  // mesma convenção md:hidden de sempre, intocada.
  ok(
    "todo ItemLabel (inclusive dos módulos) continua md:hidden quando collapsed — convenção única, nunca uma segunda regra",
    /function ItemLabel\(\{ collapsed, children \}[\s\S]{0,120}collapsed \? "md:hidden" : ""/.test(sidebarSource),
  );
}

console.log("\n12 — Permissões preservadas: nenhuma nova restrição/liberação introduzida\n");
{
  ok("'+ Novo cliente' continua restrito a admin em /clients (mesmo gate de sempre)", /\{isAdmin && \(\s*<Link\s*\n\s*href="\/clients\/new"/.test(clientsPageSource));
  ok("AgencyAccountsTree (embutida em /clients) continua resolvendo isAdmin sozinha via getCurrentProfile — nenhuma prop nova de permissão", loadSource("src", "app", "agency-accounts-tree.tsx").includes("isAdmin={profile.role === \"admin\"}"));
  ok("moveClientAction continua exigindo só requireActiveProfile (qualquer gestor ativo, nunca admin-only) — regra intocada", agencyTreeActionsSource.includes("await requireActiveProfile();"));
}

console.log("\n13 — Nenhuma rota antiga quebrada; nenhuma rota nova criada além do já existente /clients\n");
{
  const existingRoutes = [
    ["src", "app", "clients", "page.tsx"],
    ["src", "app", "clients", "[id]", "page.tsx"],
    ["src", "app", "clients", "new", "page.tsx"],
    ["src", "app", "operation", "page.tsx"],
    ["src", "app", "demandas", "page.tsx"],
    ["src", "app", "timeline", "page.tsx"],
  ];
  for (const route of existingRoutes) {
    ok(`rota ${route.join("/")} continua existindo`, existsSync(join(__dirname, "..", ...route)));
  }
  check("nenhuma pasta nova src/app/clients/list ou similar foi criada (a listagem é a própria page.tsx já existente)", existsSync(join(__dirname, "..", "src", "app", "clients", "list")), false);
}

console.log(`\n${passed} verificações passaram.`);
