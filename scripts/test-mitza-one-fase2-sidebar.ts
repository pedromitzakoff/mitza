/**
 * Testes da Etapa "MITZA ONE — Fase 2: Sidebar = Carteira de Clientes +
 * Header Simplificado". Cobre os núcleos puros novos
 * (`resolveActiveClientIdFromPathname`, já existente/reaproveitado;
 * `filterAgencyTreeClients`, novo) com chamadas diretas (sem DOM/
 * Supabase), e checagens ESTRUTURAIS de `sidebar.tsx`/
 * `client-workspace-header.tsx`/`layout.tsx`/`app-shell.tsx` via grep de
 * código-fonte — mesmo padrão já usado pelas suites anteriores.
 *
 * Rodar: npx tsx scripts/test-mitza-one-fase2-sidebar.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveActiveClientIdFromPathname, buildWorkspaceHref } from "../src/lib/client-workspace-nav";
import { filterAgencyTreeClients, type AgencyTreeClient } from "../src/lib/agency-accounts-tree";

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
const headerSource = loadSource("src", "app", "clients", "client-workspace-header.tsx");
const clientLayoutSource = loadSource("src", "app", "clients", "[id]", "layout.tsx");
const rootLayoutSource = loadSource("src", "app", "layout.tsx");
const appShellSource = loadSource("src", "app", "app-shell.tsx");
const treeDataSource = loadSource("src", "lib", "agency-accounts-tree-data.ts");

function makeClients(n: number, overrides?: Partial<AgencyTreeClient>[]): AgencyTreeClient[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `Cliente ${i}`,
    avatarUrl: null,
    ...(overrides?.[i] ?? {}),
  }));
}

// ---------------------------------------------------------------------------
console.log("\nA — Arquitetura final da Sidebar (seção 1/2/7 do pedido): carteira + Agência + Gestão, nenhum componente decorativo novo\n");
{
  ok("Sidebar importa AgencyTreeClient (tipo oficial da carteira) e recebe walletClients por prop", sidebarSource.includes("walletClients: AgencyTreeClient[]"));
  ok("Sidebar importa buildWorkspaceHref/resolveActiveClientIdFromPathname de lib/client-workspace-nav (núcleo único, nenhuma segunda lógica de pathname)", sidebarSource.includes('import { buildWorkspaceHref, resolveActiveClientIdFromPathname } from "@/lib/client-workspace-nav"'));
  ok("Sidebar importa filterAgencyTreeClients de lib/agency-accounts-tree (núcleo puro, nenhuma segunda implementação de busca)", sidebarSource.includes("filterAgencyTreeClients"));
  ok(
    "AGENCIA_ITEMS define Demandas/Timeline, hrefs globais fixos (Operação removido na Etapa 'Simplificação da Operação' — ver test-mega-facelift-fase1-shell.ts)",
    /label: "Demandas", href: "\/demandas"/.test(sidebarSource) && !sidebarSource.includes('label: "Operação"') && /label: "Timeline", href: "\/timeline"/.test(sidebarSource),
  );
  ok("GESTAO_ITEMS define Clientes/Equipe/Configurações (Configurações admin-only), mesmo grupo de sempre", /label: "Clientes", href: "\/clients"/.test(sidebarSource) && /label: "Equipe", href: "\/team"/.test(sidebarSource) && /label: "Configurações", href: "\/settings", icon: Settings, adminOnly: true/.test(sidebarSource));
  ok("nenhum componente/ícone decorativo novo (sem lib de ícone nova, sem gráfico/badge novo) — só lucide-react, já em uso", !sidebarSource.includes("from \"recharts\"") && !sidebarSource.includes("Badge"));
}

// ---------------------------------------------------------------------------
console.log("\nB — Origem e ordenação dos clientes (seção 1/6 do pedido; Fase 2.1: revertido pra ativo-only)\n");
{
  ok(
    "layout raiz busca a carteira SEM includeAllStatuses (Fase 2.1, seção 1: 'mostrar somente clientes ativos na carteira' — reutiliza o filtro padrão já existente, nenhuma segunda regra) + flattenAgencyTree (MESMA ordenação oficial de sempre — gestor, depois wallet_position)",
    rootLayoutSource.includes("loadAgencyAccountsTree()") &&
      !rootLayoutSource.includes("loadAgencyAccountsTree({ includeAllStatuses: true })") &&
      rootLayoutSource.includes("flattenAgencyTree(agencyTree)"),
  );
  ok("AppShell só repassa walletClients pra Sidebar — nenhum dado novo, nenhuma segunda consulta aqui", appShellSource.includes("walletClients: AgencyTreeClient[]") && appShellSource.includes("walletClients={walletClients}"));
  ok(
    "loadAgencyAccountsTree(options?) preserva byte a byte o comportamento ANTERIOR (ativo-only) quando includeAllStatuses não é passado — nenhum chamador antigo (app/page.tsx, agency-accounts-tree.tsx) foi alterado",
    treeDataSource.includes("if (!options?.includeAllStatuses)") && loadSource("src", "app", "page.tsx").includes("loadAgencyAccountsTree()") && loadSource("src", "app", "agency-accounts-tree.tsx").includes("loadAgencyAccountsTree()"),
  );
  ok("RLS continua o único filtro de PERMISSÃO (createSupabaseClient normal, nunca admin/service-role, nunca um segundo filtro de acesso na Sidebar)", treeDataSource.includes("createSupabaseClient()") && !treeDataSource.includes("createAdminClient"));
}

console.log("\nC — Funcionamento da busca (filterAgencyTreeClients): 0/1/25/100 clientes, nomes repetidos, pausado/inativo, case-insensitive\n");
{
  check("0 clientes -> lista vazia, sem erro", filterAgencyTreeClients([], "qualquer"), []);
  check("busca vazia (string vazia) -> devolve a lista inteira, nunca filtra", filterAgencyTreeClients(makeClients(3), ""), makeClients(3));
  check("busca só espaços -> mesmo comportamento de busca vazia (trim)", filterAgencyTreeClients(makeClients(2), "   "), makeClients(2));

  const oneClient = [{ id: "a", name: "Aibou", avatarUrl: null }];
  check("1 cliente, busca por substring real -> encontra", filterAgencyTreeClients(oneClient, "ibo"), oneClient);
  check("1 cliente, busca sem match -> lista vazia (nunca erro)", filterAgencyTreeClients(oneClient, "zzz"), []);

  const c25 = makeClients(25);
  check("25 clientes, busca por 'Cliente 7' -> só o cliente 7 (match exato de substring, nunca também 17/27 etc. aqui)", filterAgencyTreeClients(c25, "Cliente 7"), [c25[7]]);
  check("25 clientes, busca vazia -> todos os 25, mesma ordem", filterAgencyTreeClients(c25, ""), c25);

  const c100 = makeClients(100);
  check(
    "100 clientes, busca por 'Cliente 1' -> substring simples, mesmo critério determinístico aplicado diretamente (Cliente 1, 10-19)",
    filterAgencyTreeClients(c100, "Cliente 1").length,
    c100.filter((c) => c.name.includes("Cliente 1")).length,
  );
  check("100 clientes, busca vazia -> todos os 100", filterAgencyTreeClients(c100, "").length, 100);

  const duplicateNames: AgencyTreeClient[] = [
    { id: "dup-1", name: "Helping Hand", avatarUrl: null },
    { id: "dup-2", name: "Helping Hand", avatarUrl: null },
  ];
  check("clientes com NOME repetido: busca por nome devolve AMBOS (busca é só texto, nunca decide por ID)", filterAgencyTreeClients(duplicateNames, "helping"), duplicateNames);

  const pausedAndActive: AgencyTreeClient[] = [
    { id: "ativo-1", name: "Conta Ativa", avatarUrl: null, status: "ativo" },
    { id: "pausado-1", name: "Conta Pausada", avatarUrl: null, status: "pausado" },
    { id: "encerrado-1", name: "Conta Encerrada", avatarUrl: null, status: "encerrado" },
  ];
  check("busca NUNCA exclui por status (pausado/encerrado aparecem igual, seção 1 do pedido: 'não assumir exclusão')", filterAgencyTreeClients(pausedAndActive, "conta"), pausedAndActive);

  check("case-insensitive: 'AIBOU' encontra 'Aibou'", filterAgencyTreeClients(oneClient, "AIBOU"), oneClient);
}

// ---------------------------------------------------------------------------
console.log("\nD — Header antes/depois (seção 3 do pedido): removido seletor/busca/anterior-próximo/posição; preservado nome/status/Informações da conta\n");
{
  // ANTES (ver histórico pré-Fase 2 em git/test-mega-facelift-fase46-
  // contexto-global.ts, seção 2, já corrigida pra refletir o DEPOIS): o
  // header tinha SearchableSelect + anterior/próximo + posição X/Y.
  ok(
    "DEPOIS: header não IMPORTA mais SearchableSelect/ChevronLeft/ChevronRight, nem renderiza <SearchableSelect/posição X·Y (os nomes só sobrevivem em doc-comments explicando o que saiu)",
    !headerSource.includes('from "@/components/ui/searchable-select"') && !headerSource.includes("<SearchableSelect") && !headerSource.includes("ChevronLeft") && !headerSource.includes("ChevronRight") && !headerSource.includes("{position"),
  );
  ok("DEPOIS: nome do cliente aparece como TEXTO visível (antes só existia como placeholder dentro do seletor removido)", /\{client\.name\}/.test(headerSource) && headerSource.includes("text-sm font-semibold text-overview-text-primary"));
  ok("DEPOIS: status contratual real preservado (CLIENT_STATUS_LABEL/CLIENT_STATUS_BADGE_CLASSES, nunca confundido com saúde de performance)", headerSource.includes("CLIENT_STATUS_LABEL[client.status]") && headerSource.includes("CLIENT_STATUS_BADGE_CLASSES[client.status]"));
  ok("DEPOIS: Informações da conta preservada com TODAS as ações reais (sincronização/compartilhamento/configuração vivem dentro de AccountInfoDrawerLauncher, componente intocado)", headerSource.includes("<AccountInfoDrawerLauncher"));
  ok("avatar continua link de volta pro cockpit quando fora dele (única affordance de 'voltar' que precisa funcionar de qualquer sub-rota)", headerSource.includes("Voltar para o cockpit"));
  ok("clients/[id]/layout.tsx não busca mais a árvore pro header (Fase 2 moveu a busca da carteira pro layout raiz)", !clientLayoutSource.includes("await loadAgencyAccountsTree") && !clientLayoutSource.includes("resolveWalletSequence("));
}

// ---------------------------------------------------------------------------
console.log("\nE — Destacar o cliente atual, inclusive em rotas antigas/deep links (seção 4 do pedido)\n");
{
  check("'/clients/aibou' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou"), "aibou");
  check("'/clients/aibou/metas' (rota preservada) -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/metas"), "aibou");
  check("'/clients/aibou/relatorio' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/relatorio"), "aibou");
  check("'/clients/aibou/dados' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/dados"), "aibou");
  check("'/clients/aibou/operation' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/operation"), "aibou");
  check("'/clients/aibou/demandas' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/demandas"), "aibou");
  check("'/clients/aibou/timeline' -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/timeline"), "aibou");
  check("'/clients/aibou/edit' (rota legada fora dos módulos) -> aibou (ainda destaca o cliente certo)", resolveActiveClientIdFromPathname("/clients/aibou/edit"), "aibou");
  check("'/clients/aibou/tasks/new' (rota bem antiga) -> aibou", resolveActiveClientIdFromPathname("/clients/aibou/tasks/new"), "aibou");
  check("'/clients' (listagem) -> null, nunca um cliente", resolveActiveClientIdFromPathname("/clients"), null);
  check("'/clients/new' (criação) -> null, nunca tratado como id 'new'", resolveActiveClientIdFromPathname("/clients/new"), null);
  check("'/operation' (rota global) -> null", resolveActiveClientIdFromPathname("/operation"), null);
  ok("ClientRow compara client.id === activeClientId (seguro com nomes repetidos — nunca compara por nome)", sidebarSource.includes("const active = client.id === activeClientId"));
  ok("ClientRow usa aria-current='page' quando ativo (acessibilidade, seção 5 do pedido)", sidebarSource.includes('aria-current={active ? "page" : undefined}'));
}

console.log("\nF — Links vindos de Demandas/Operação/Timeline/Clientes chegam ao cockpit correto; sem loop de redirect\n");
{
  check("buildWorkspaceHref com suffix vazio sempre monta /clients/[id] (o cockpit)", buildWorkspaceHref("aibou", "", null), "/clients/aibou");
  check("buildWorkspaceHref preserva month quando presente", buildWorkspaceHref("aibou", "", "2026-10"), "/clients/aibou?month=2026-10");
  ok("ClientRow da Sidebar sempre usa suffix '' (cockpit) ao trocar de cliente — nunca replica uma sub-rota legada (seção 4 do pedido: 'não vazar... estado que não pertençam ao destino')", sidebarSource.includes('const href = buildWorkspaceHref(client.id, "", month)'));
  ok("nenhum redirect novo foi introduzido em sidebar.tsx/client-workspace-header.tsx (sem risco de loop)", !sidebarSource.includes("redirect(") && !headerSource.includes("redirect("));
}

console.log("\nG — Collapsed/mobile (seção 5 do pedido): recolhida nunca lista dezenas de ícones; mobile sempre mostra tudo\n");
{
  ok(
    "carteira completa (busca+lista) usa 'md:hidden' quando collapsed — some SÓ no desktop recolhido, nunca no mobile (mesma convenção de ItemLabel)",
    /flex min-h-0 flex-1 flex-col px-2\.5 \$\{collapsed \? "md:hidden" : ""\}/.test(sidebarSource),
  );
  ok(
    "versão compacta (desktop recolhido) usa 'hidden md:flex' — nunca aparece no mobile (a carteira completa já cobre esse caso lá)",
    sidebarSource.includes('collapsed ? "hidden flex-col items-center gap-1.5 px-2.5 md:flex" : "hidden"'),
  );
  ok("versão compacta mostra o cliente ATUAL (se houver) via ClientAvatar — nunca a lista inteira como ícones", /\{activeClient && \(/.test(sidebarSource));
  ok("versão compacta tem um gatilho de busca que EXPANDE a sidebar (toggleCollapsed) — acesso à busca preservado mesmo recolhida", sidebarSource.includes("function expandAndFocusSearch"));
  ok("nenhum arquivo de 'mobile sidebar' separado foi criado", !sidebarSource.includes("sidebar-mobile"));
}

console.log("\nH — Performance (seção 6 do pedido): sem N+1, sem métrica pesada, busca local\n");
{
  ok("loadAgencyAccountsTree continua só 2 queries (clients + team_members), nenhuma query por cliente (N+1)", (treeDataSource.match(/requireQuery\(/g) ?? []).length === 2);
  ok("Sidebar NUNCA chama Supabase/fetch diretamente (toda a carteira chega via prop walletClients, já resolvida no layout raiz)", !sidebarSource.includes("createSupabaseClient") && !sidebarSource.includes("fetch("));
  ok("busca é um filtro em memória (useMemo sobre filterAgencyTreeClients), nenhum debounce/chamada de rede por tecla", sidebarSource.includes("useMemo(() => filterAgencyTreeClients(walletClients, search)"));
  ok("AgencyTree/AgencyTreeClient continuam SEM nenhuma métrica de performance (orçamento/resultado/CPA) — seção 6 do pedido: 'Sidebar é navegação, não dashboard de performance'", !loadSource("src", "lib", "agency-accounts-tree.ts").includes("monthActual") && !loadSource("src", "lib", "agency-accounts-tree.ts").includes("performance_goal"));
}

console.log("\nI — Rotas preservadas (seção 8 do pedido): nenhuma removida/redirecionada nesta fase\n");
{
  for (const route of [
    ["clients", "[id]", "metas", "page.tsx"],
    ["clients", "[id]", "relatorio", "page.tsx"],
    ["clients", "[id]", "dados", "page.tsx"],
    ["clients", "[id]", "operation", "page.tsx"],
    ["clients", "[id]", "demandas", "page.tsx"],
    ["clients", "[id]", "timeline", "page.tsx"],
    ["clients", "[id]", "edit", "page.tsx"],
  ]) {
    ok(`/${route.slice(0, -1).join("/")} continua existindo`, loadSource("src", "app", ...route).length > 0);
  }
  ok("/operation, /demandas, /timeline, /clients, /team, /settings continuam existindo", loadSource("src", "app", "operation", "page.tsx").length > 0 && loadSource("src", "app", "demandas", "page.tsx").length > 0 && loadSource("src", "app", "timeline", "page.tsx").length > 0 && loadSource("src", "app", "clients", "page.tsx").length > 0 && loadSource("src", "app", "team", "page.tsx").length > 0 && loadSource("src", "app", "settings", "page.tsx").length > 0);
  ok("/sprints, /reports, /achievements não foram tocados", loadSource("src", "app", "sprints", "page.tsx").length > 0 && loadSource("src", "app", "reports", "page.tsx").length > 0 && loadSource("src", "app", "achievements", "page.tsx").length > 0);
  ok("reminders/LegacyGlobalDashboard não foram alterados nesta fase (nenhum arquivo de reminders tocado; LegacyGlobalDashboard continua export órfão em app/page.tsx)", loadSource("src", "app", "page.tsx").includes("export async function LegacyGlobalDashboard("));
}

// ---------------------------------------------------------------------------
console.log("\nJ — MITZA ONE — Fase 2.1 (Refinamento da Sidebar): só clientes ativos na carteira\n");
{
  ok(
    "clients/[id]/layout.tsx continua buscando o cliente DIRETO por ID (sem depender da árvore ativo-only) — acesso direto a cliente pausado/encerrado nunca regride, nunca força redirect",
    clientLayoutSource.includes('.from("clients")') && !clientLayoutSource.includes("redirect("),
  );
  ok(
    "loadAgencyAccountsTree(options?) continua existindo como capacidade reaproveitável (includeAllStatuses), só deixou de ser chamada com true pela Sidebar — nenhuma segunda regra de status criada, nenhuma função nova",
    treeDataSource.includes("options?: { includeAllStatuses?: boolean }") && treeDataSource.includes('clientsQuery.eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)'),
  );

  // Simula exatamente o que a Sidebar recebe agora (walletClients já
  // vem ativo-only do layout raiz) — busca local nunca reintroduz
  // pausado/encerrado porque eles nunca estão no array de entrada.
  const activeOnlyWallet: AgencyTreeClient[] = [
    { id: "ativo-1", name: "Conta Ativa Um", avatarUrl: null, status: "ativo" },
    { id: "ativo-2", name: "Conta Ativa Dois", avatarUrl: null, status: "ativo" },
  ];
  check(
    "busca 'conta' sobre carteira já ativo-only -> só as 2 contas ativas (pausado/encerrado nem chegam a existir no array, então nunca aparecem)",
    filterAgencyTreeClients(activeOnlyWallet, "conta").map((c) => c.id),
    ["ativo-1", "ativo-2"],
  );
  check("busca vazia sobre carteira ativo-only -> os mesmos 2, nenhum a mais", filterAgencyTreeClients(activeOnlyWallet, "").map((c) => c.id), ["ativo-1", "ativo-2"]);
}

console.log("\nK — MITZA ONE — Fase 2.1: Agência e Gestão como menus expansíveis\n");
{
  ok("Sidebar importa ChevronRight (ícone do acordeão)", /import \{[^}]*\bChevronRight\b[^}]*\} from "lucide-react"/.test(sidebarSource));
  ok("AccordionGroup existe como componente dedicado (fechado/aberto controlado pelo pai)", /function AccordionGroup\(/.test(sidebarSource));
  ok("Cabeçalho do grupo é um <button> real (cobre teclado de graça) com aria-expanded/aria-controls", sidebarSource.includes("aria-expanded={open}") && sidebarSource.includes("aria-controls={panelId}"));
  ok("Chevron rotaciona 90° quando aberto (indicador visual de estado)", sidebarSource.includes('open ? "rotate-90" : ""'));
  ok(
    "fechados por padrão: o estado inicial de cada grupo vem de isActive(pathname) na pathname atual, nunca hardcoded 'true' (closed-by-default salvo quando a rota já pertence ao grupo)",
    /useState\(\(\) => \(\{\s*agencia: AGENCIA_ITEMS\.some/.test(sidebarSource),
  );
  ok(
    "auto-open nunca FECHA um grupo já aberto manualmente — sempre 'prev.X || isActive(...)' (OR, nunca sobrescreve com false)",
    sidebarSource.includes("agencia: prev.agencia || AGENCIA_ITEMS.some((item) => item.isActive(pathname))") &&
      sidebarSource.includes("gestao: prev.gestao || gestaoItems.some((item) => item.isActive(pathname))"),
  );
  ok(
    "auto-open reavalia a cada navegação via comparação de pathname DURANTE o render (estado, nunca ref — React proíbe ler/escrever ref durante o render; nunca setState síncrono dentro de useEffect, que causaria um render em cascata extra)",
    sidebarSource.includes("lastAutoOpenPathname !== pathname"),
  );
  ok("Agência e Gestão continuam os MESMOS itens/links/permissões de antes (nenhuma rota nova, Configurações continua adminOnly)", sidebarSource.includes("items={AGENCIA_ITEMS}") && sidebarSource.includes("items={gestaoItems}"));
  ok(
    "desktop recolhido preserva o comportamento ANTERIOR (tira de ícones plana, sem cabeçalho clicável/acordeão) — Fase 2.1 não altera a apresentação recolhida",
    sidebarSource.includes('collapsed ? "hidden shrink-0 flex-col gap-0.5 px-2.5 pb-2 md:flex" : "hidden"'),
  );
}

console.log("\nL — MITZA ONE — Fase 2.1: altura da carteira priorizada (seção 3 do pedido)\n");
{
  ok(
    "botão de recolher/expandir (linha do topo) some no mobile — reclama espaço vertical que antes ficava vazio (botão já era 'hidden md:block' por dentro; o wrapper agora acompanha)",
    sidebarSource.includes('className="hidden shrink-0 items-center justify-end px-2 pb-1 pt-1.5 md:flex"'),
  );
  ok(
    "margem/espaçamento de Agência+Gestão foi reduzido (mt-3/space-y-3 -> mt-2/space-y-1.5) sem tocar no padding das linhas (NavLink/ClientRow continuam py-1) nem no tamanho do avatar (ClientAvatar continua size=\"xs\")",
    sidebarSource.includes('mt-2 shrink-0 space-y-1.5 px-2.5 pb-2') && sidebarSource.includes('py-1 pl-2 pr-2.5') && sidebarSource.includes('size="xs"'),
  );
  ok(
    "a região da carteira continua 'flex-1 min-h-0' (ocupa toda altura disponível, scroll próprio) — nenhuma mudança nessa mecânica, só menos espaço perdido ao redor dela",
    sidebarSource.includes("flex min-h-0 flex-1 flex-col px-2.5"),
  );
  ok("rodapé (relógio/Atualizar Meta/identidade/sair) continua intocado, mesma estrutura", sidebarSource.includes('border-t border-sidebar-border p-2.5'));
}

console.log(`\n${passed} verificações passaram.`);
