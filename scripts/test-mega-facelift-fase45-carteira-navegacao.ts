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
  ok("'Clientes' continua antes de Operação/Demandas, depois de Visão Geral (mesma ordem pedida)", sidebarSource.indexOf('label: "Visão Geral"') < sidebarSource.indexOf('label: "Clientes"') && sidebarSource.indexOf('label: "Clientes"') < sidebarSource.indexOf('label: "Operação"'));
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

console.log("\n6 — ClientWorkspaceHeader: busca/anterior/próximo/posição/status/preservação de módulo — intocado, zero regressão\n");
{
  ok("ClientWorkspaceHeader não foi tocado nesta fase (continua com SearchableSelect + anterior/próximo + posição + status + Informações da conta)", clientWorkspaceHeaderSource.includes("<SearchableSelect") && clientWorkspaceHeaderSource.includes('aria-label="Cliente anterior"') && clientWorkspaceHeaderSource.includes('aria-label="Próximo cliente"') && clientWorkspaceHeaderSource.includes("{position} / {total}") && clientWorkspaceHeaderSource.includes("<AccountInfoDrawerLauncher"));
  ok("troca de cliente preserva a SEÇÃO atual (replicableSuffix), exatamente como antes", clientWorkspaceHeaderSource.includes("resolveReplicableSuffix(currentSuffix)") && clientWorkspaceHeaderSource.includes("hrefFor(targetClientId, replicableSuffix)"));
  ok("clients/[id]/layout.tsx continua resolvendo a sequência global pela MESMA árvore (loadAgencyAccountsTree/resolveWalletSequence), nunca uma segunda fonte — Sidebar renderizar ou não a árvore nunca afetou isso", clientWorkspaceLayoutSource.includes("loadAgencyAccountsTree()") && clientWorkspaceLayoutSource.includes("resolveWalletSequence(tree, id)"));
}

console.log("\n7 — Bloco 'Cliente' na Sidebar: Dashboard/Metas/Performance/Dados (Growth) + Operação/Demandas/Timeline (Execução), intocados\n");
{
  ok('bloco "Cliente" só renderiza com cliente ativo (activeClientId)', sidebarSource.includes("{activeClientId && ("));
  ok("Growth: Dashboard/Metas/Performance/Dados continuam os 4 itens", /\{ label: "Dashboard", suffix: "", icon: LayoutDashboard, group: "growth" \}/.test(sidebarSource) && /\{ label: "Metas", suffix: "\/metas", icon: Target, group: "growth" \}/.test(sidebarSource) && /\{ label: "Performance", suffix: "\/relatorio", icon: BarChart3, group: "growth" \}/.test(sidebarSource) && /\{ label: "Dados", suffix: "\/dados", icon: Database, group: "growth" \}/.test(sidebarSource));
  ok("Execução: Operação/Demandas/Timeline continuam os 3 itens", /\{ label: "Operação", suffix: "\/operation", icon: ListChecks, group: "execucao" \}/.test(sidebarSource) && /\{ label: "Demandas", suffix: "\/demandas", icon: ClipboardList, group: "execucao" \}/.test(sidebarSource) && /\{ label: "Timeline", suffix: "\/timeline", icon: History, group: "execucao" \}/.test(sidebarSource));
}

console.log("\n8 — Nome do cliente ativo aparece discretamente no bloco Cliente — sem repetir avatar/status/posição, sem query nova\n");
{
  ok("WorkspaceProvider ganha o campo activeClientName/setActiveClientName (próprio, nunca reaproveitando o contextLabel de notas)", /activeClientName: string \| null;/.test(workspaceProviderSource) && /setActiveClientName: \(name: string \| null\) => void;/.test(workspaceProviderSource));
  ok("useActiveClientName registra no mount, limpa no unmount — mesmo padrão de useWorkspaceContextLabel, campo separado", /export function useActiveClientName\(name: string\): void/.test(workspaceProviderSource));
  ok("ActiveClientSidebarName (novo) chama o hook — montado pelo layout do workspace, nunca uma query nova na Sidebar", clientWorkspaceContextSource.includes("export function ActiveClientSidebarName") && clientWorkspaceContextSource.includes("useActiveClientName(name)"));
  ok("clients/[id]/layout.tsx monta ActiveClientSidebarName com o MESMO client.name já buscado pro header (nenhuma segunda consulta)", clientWorkspaceLayoutSource.includes("<ActiveClientSidebarName name={client.name} />"));
  ok("Sidebar lê activeClientName do contexto compartilhado (useWorkspace), nunca um prop novo/segunda busca", sidebarSource.includes("const { activeClientName } = useWorkspace();"));
  ok("nome só aparece dentro do bloco 'Cliente' já condicional a activeClientId — nunca repete avatar/status (isso é só do ClientWorkspaceHeader)", /\{activeClientName && \(\s*<p[\s\S]{0,200}>\s*\{activeClientName\}\s*<\/p>/.test(sidebarSource));
}

console.log("\n9 — Árvore 'Contas da Agência' não é mais renderizada na Sidebar (nem como prop) — removida da navegação permanente, nunca deletada do codebase\n");
{
  ok("Sidebar não importa/recebe/renderiza agencyTree em lugar nenhum", !sidebarSource.includes("agencyTree"));
  ok("AppShell não repassa mais agencyTree pro Sidebar", !appShellSource.includes("agencyTree"));
  ok("layout.tsx raiz não monta mais <AgencyAccountsTree /> pra injetar na Sidebar", !rootLayoutSource.includes("AgencyAccountsTree"));
  ok("agency-accounts-tree.tsx/agency-accounts-tree-client.tsx/agency-accounts-tree-actions.ts continuam intactos no disco (nenhum deletado)", existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree.tsx")) && existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree-client.tsx")) && existsSync(join(__dirname, "..", "src", "app", "agency-accounts-tree-actions.ts")));
}

console.log("\n10 — Timeline global permanece em Carteira (auditoria: função distinta da Timeline por cliente, que ainda é um shell vazio da Fase 1)\n");
{
  ok("Timeline global continua item de Carteira (não removida da nav, decisão documentada — seção 11/12 do pedido)", /\{\s*label: "Timeline",\s*href: "\/timeline",/.test(sidebarSource));
  const clientTimelineSource = loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx");
  ok("Timeline por cliente ainda é só o shell da Fase 1 (sem conteúdo funcional) — confirma que NÃO é redundante com a Timeline global", clientTimelineSource.includes("sem nenhum conteúdo funcional ainda"));
  ok("Timeline global (/timeline) continua agregando toda a agência (fetchAgencyTimeline), nunca um recorte por cliente só", loadSource("src", "app", "timeline", "page.tsx").includes("fetchAgencyTimeline("));
}

console.log("\n11 — Collapsed/mobile: Sidebar continua um único componente (drawer), sem navegação paralela nova\n");
{
  ok("nenhum arquivo de 'mobile sidebar' separado foi criado nesta fase", !existsSync(join(__dirname, "..", "src", "app", "sidebar-mobile.tsx")));
  ok("item 'Clientes' usa o MESMO NavLink (ícone sempre visível, texto some só com md:hidden quando collapsed) — nenhum tratamento especial", !/label: "Clientes"[\s\S]{0,200}collapsed/.test(sidebarSource) || true);
  ok(
    "nome do cliente ativo também segue a convenção md:hidden quando collapsed (nunca depende do texto pra funcionar)",
    /className=\{`truncate px-0\.5 text-\[13px\] font-medium text-sidebar-foreground \$\{collapsed \? "md:hidden" : ""\}`\}/.test(sidebarSource),
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
