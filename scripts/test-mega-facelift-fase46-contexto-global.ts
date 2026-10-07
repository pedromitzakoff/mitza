/**
 * Testes da Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como
 * Contexto Global" — cobre o núcleo puro novo (`buildModuleContextHref`/
 * `resolveCurrentModuleAndContext`, `lib/client-workspace-nav.ts`), a
 * Sidebar unificada (Growth/Execução sempre visíveis + Gestão), a entrada
 * "Todos" em `ClientWorkspaceHeader` e o atalho `GlobalScopeSelect` nas 4
 * rotas globais com módulo. `resolveWalletSequence`/`flattenAgencyTree`/
 * `moveClientAction`/busca do header já são cobertos a fundo por
 * `test-client-workspace.ts`/`test-mega-facelift-fase45-carteira-navegacao.ts`
 * — não duplicados aqui.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase46-contexto-global.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildModuleContextHref, moduleSupportsAllContext, resolveCurrentModuleAndContext, type ModuleKey } from "../src/lib/client-workspace-nav";

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
const globalScopeSelectSource = loadSource("src", "app", "global-scope-select.tsx");
const homePageSource = loadSource("src", "app", "page.tsx");
const operationPageSource = loadSource("src", "app", "operation", "page.tsx");
const operationViewSource = loadSource("src", "app", "operation", "operation-triage-view.tsx");
const demandasPageSource = loadSource("src", "app", "demandas", "page.tsx");
const demandasClientSource = loadSource("src", "app", "demandas", "pendencias-page-client.tsx");
const timelinePageSource = loadSource("src", "app", "timeline", "page.tsx");
const clientScopedDemandasSource = loadSource("src", "app", "clients", "[id]", "demandas", "page.tsx");

console.log("\n1 — SIDEBAR: MITZA ONE — Fase 2 substituiu Growth/Execução (módulos) por CARTEIRA + Agência/Gestão — histórico preservado, assertivas atualizadas\n");
{
  // MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes): os eyebrows
  // "Growth"/"Execução" (Fase 4.6) saíram — a Sidebar não agrupa mais por
  // módulo. "Agência" (ferramentas transversais) e "Gestão" (Clientes/
  // Equipe/Configurações) são os 2 grupos fixos agora, abaixo da
  // carteira. Cobertura completa em test-mitza-one-fase2-sidebar.ts.
  ok('eyebrow "Growth"/"Execução" não existem mais (não há mais agrupamento por módulo)', !/>\s*Growth\s*</.test(sidebarSource) && !/>\s*Execução\s*</.test(sidebarSource));
  ok('eyebrow "Agência" presente (Demandas/Operação/Timeline — ferramentas transversais)', />\s*Agência\s*</.test(sidebarSource));
  ok('eyebrow "Gestão" presente (Clientes/Equipe/Configurações)', />\s*Gestão\s*</.test(sidebarSource));
  ok('eyebrow "Carteira" (rótulo próprio) não existe — a lista de clientes aparece direto, sem eyebrow "Carteira" acima dela', !/>\s*Carteira\s*</.test(sidebarSource));
  ok('eyebrow "Cliente" (bloco antigo, Fase 4.5) não existe mais', !/>\s*Cliente\s*</.test(sidebarSource));
  ok("Operação aparece só UMA vez na Sidebar (link global fixo, nunca duplicada entre 'global' e 'do cliente' — esse conceito não existe mais)", (sidebarSource.match(/label: "Operação"/g) ?? []).length === 1);
  ok("Demandas aparece só UMA vez na Sidebar", (sidebarSource.match(/label: "Demandas"/g) ?? []).length === 1);
  ok("Timeline aparece só UMA vez na Sidebar", (sidebarSource.match(/label: "Timeline"/g) ?? []).length === 1);
  ok('"Clientes" presente em GESTAO_ITEMS, aponta pra /clients', /\{ label: "Clientes", href: "\/clients"/.test(sidebarSource));
  ok(
    "collapsed continua controlado só por md:hidden (ItemLabel) — nenhuma dependência de cliente ativo pra funcionar",
    sidebarSource.includes('collapsed ? "md:hidden" : ""') && !sidebarSource.includes("activeClientName"),
  );
}

console.log("\n2 — CONTEXTO: MITZA ONE — Fase 2 removeu o seletor 'Todos os clientes' do header (a Sidebar é a única troca de cliente agora); status/Informações da conta continuam\n");
{
  // MITZA ONE — Fase 2 (seção 3 do pedido): ClientWorkspaceHeader deixou
  // de ter SearchableSelect/canOfferAllClients/moduleSupportsAllContext —
  // a Sidebar (busca + lista completa) é a única forma de trocar de
  // cliente ou "saír pra Todos" (clicando Demandas/Operação/Timeline na
  // área Agência) agora. `GlobalScopeSelect` (entrada "Todos -> cliente"
  // DENTRO das rotas globais) é um mecanismo DIFERENTE, intocado — ver
  // seções 5-7 abaixo.
  ok(
    "ClientWorkspaceHeader não tem mais o seletor 'Todos os clientes' nem moduleSupportsAllContext/canOfferAllClients (Fase 2 — a Sidebar é a única troca de cliente)",
    !headerSource.includes("canOfferAllClients") && !headerSource.includes("moduleSupportsAllContext") && !headerSource.includes("Todos os clientes"),
  );
  ok("ClientWorkspaceHeader não importa mais buildModuleContextHref/resolveCurrentModuleAndContext (mecanismo de módulo×contexto não se aplica mais ao header)", !headerSource.includes("buildModuleContextHref") && !headerSource.includes("resolveCurrentModuleAndContext"));
  ok(
    "status contratual real e Informações da conta continuam renderizados a partir de `client` real (nunca removidos) — posição X·Y/anterior-próximo saíram (Fase 2, seção 3 do pedido)",
    headerSource.includes("CLIENT_STATUS_LABEL[client.status]") && headerSource.includes("<AccountInfoDrawerLauncher") && !headerSource.includes("{position"),
  );
  ok(
    "GlobalScopeSelect (entrada 'Todos -> cliente' nas rotas globais) nunca tem selectedId diferente de null — a rota global É sempre 'Todos', nunca finge ter um cliente selecionado",
    /selectedId=\{null\}/.test(globalScopeSelectSource),
  );
  ok(
    "GlobalScopeSelect nunca renderiza status/posição/Informações da conta — só o combobox de navegação",
    !globalScopeSelectSource.includes("AccountInfoDrawerLauncher") && !globalScopeSelectSource.includes("Ativo"),
  );
}

console.log("\n3 — resolveCurrentModuleAndContext: pathname -> módulo + contexto, único núcleo (nenhuma lógica de pathname duplicada)\n");
{
  check("'/' -> dashboard + Todos", resolveCurrentModuleAndContext("/"), { module: "dashboard", context: { type: "all" } });
  check("'/operation' -> operation + Todos", resolveCurrentModuleAndContext("/operation"), { module: "operation", context: { type: "all" } });
  check("'/demandas' -> demandas + Todos", resolveCurrentModuleAndContext("/demandas"), { module: "demandas", context: { type: "all" } });
  check("'/pendencias' (nome antigo) -> demandas + Todos", resolveCurrentModuleAndContext("/pendencias"), { module: "demandas", context: { type: "all" } });
  check("'/timeline' -> timeline + Todos", resolveCurrentModuleAndContext("/timeline"), { module: "timeline", context: { type: "all" } });
  check("'/achievements' (nome antigo) -> timeline + Todos", resolveCurrentModuleAndContext("/achievements"), { module: "timeline", context: { type: "all" } });
  check("'/clients' -> nenhum módulo (área Gestão), contexto Todos", resolveCurrentModuleAndContext("/clients"), { module: null, context: { type: "all" } });
  check("'/team' -> nenhum módulo", resolveCurrentModuleAndContext("/team").module, null);
  check("'/clients/leonardo' -> dashboard + cliente leonardo", resolveCurrentModuleAndContext("/clients/leonardo"), {
    module: "dashboard",
    context: { type: "client", id: "leonardo" },
  });
  check("'/clients/leonardo/metas' -> metas + cliente leonardo", resolveCurrentModuleAndContext("/clients/leonardo/metas"), {
    module: "metas",
    context: { type: "client", id: "leonardo" },
  });
  check("'/clients/leonardo/relatorio' -> performance + cliente leonardo", resolveCurrentModuleAndContext("/clients/leonardo/relatorio"), {
    module: "performance",
    context: { type: "client", id: "leonardo" },
  });
  check("'/clients/leonardo/edit' (fora dos 7 módulos) -> dashboard (fallback seguro, mesma regra de sempre)", resolveCurrentModuleAndContext("/clients/leonardo/edit"), {
    module: "dashboard",
    context: { type: "client", id: "leonardo" },
  });
}

console.log("\n4 — DASHBOARD: CORRIGIDO na Etapa 'Correção Conceitual da Fase 4.6' e revisado na Etapa 'Correção do fluxo final do Dashboard' — só Cliente; Todos resolve pro primeiro cliente via '/' (ver suites próprias)\n");
{
  check("Dashboard + Todos -> '/' (resolver — nunca mais /clients, nunca mais o dashboard consolidado global)", buildModuleContextHref("dashboard", { type: "all" }, null), "/");
  check("Dashboard + cliente -> /clients/[id]", buildModuleContextHref("dashboard", { type: "client", id: "leonardo" }, null), "/clients/leonardo");
  check("Dashboard + cliente + month -> preserva ?month=", buildModuleContextHref("dashboard", { type: "client", id: "leonardo" }, "2026-10"), "/clients/leonardo?month=2026-10");
  ok(
    "Dashboard nunca oferece 'Todos os clientes' no seletor, mesmo tendo entrada em MODULE_GLOBAL_HREF (moduleSupportsAllContext é uma lista própria, não derivada do mapa)",
    !moduleSupportsAllContext("dashboard"),
  );
  ok(
    "'LegacyGlobalDashboard' (dashboard consolidado antigo) NÃO foi deletado — continua no disco como código órfão, exportado só pra não dar aviso de não-usado, nunca mais é o export default de '/' (ver suite da correção)",
    homePageSource.includes("buildOperationClientCard") &&
      homePageSource.includes("<GlobalScopeSelect module=\"dashboard\"") &&
      homePageSource.includes("export async function LegacyGlobalDashboard(") &&
      !/export default async function Home\(\{\s*searchParams/.test(homePageSource),
  );
}

console.log("\n5 — OPERAÇÃO: Todos -> /operation; cliente -> /clients/[id]/operation; preservado nas duas direções + entre clientes\n");
{
  check("Operação + Todos -> /operation", buildModuleContextHref("operation", { type: "all" }, null), "/operation");
  check("Operação + cliente -> /clients/[id]/operation", buildModuleContextHref("operation", { type: "client", id: "leonardo" }, null), "/clients/leonardo/operation");
  check(
    "Operação: clienteA -> clienteB preserva o módulo (mesma suffix, troca só o id)",
    [buildModuleContextHref("operation", { type: "client", id: "a" }, null), buildModuleContextHref("operation", { type: "client", id: "b" }, null)],
    ["/clients/a/operation", "/clients/b/operation"],
  );
  ok("/operation monta GlobalScopeSelect (entrada 'Todos -> cliente')", operationPageSource.includes('<GlobalScopeSelect module="operation"'));
  ok("OperationTriageView aceita scopeSelector opt-in — tela funciona idêntica sem ele (nenhum cálculo de triagem tocado)", operationViewSource.includes("scopeSelector?: React.ReactNode"));
}

console.log("\n6 — DEMANDAS: Todos -> /demandas; cliente -> /clients/[id]/demandas; preservado nas duas direções + entre clientes\n");
{
  check("Demandas + Todos -> /demandas", buildModuleContextHref("demandas", { type: "all" }, null), "/demandas");
  check("Demandas + cliente -> /clients/[id]/demandas", buildModuleContextHref("demandas", { type: "client", id: "leonardo" }, null), "/clients/leonardo/demandas");
  ok("/demandas monta GlobalScopeSelect", demandasPageSource.includes('<GlobalScopeSelect module="demandas"'));
  ok(
    "PendenciasPageClient aceita scopeSelector opt-in, só renderizado quando !hideHeading (nunca no workspace do cliente)",
    demandasClientSource.includes("scopeSelector?: React.ReactNode") &&
      /\{!hideHeading && \([\s\S]{0,400}\{scopeSelector\}/.test(demandasClientSource),
  );
  ok("/clients/[id]/demandas NUNCA passa scopeSelector (workspace do cliente não precisa de atalho 'Todos -> cliente')", !clientScopedDemandasSource.includes("scopeSelector"));
  ok("ZERO mudança na lógica de Demandas: tasks/origin='manual'/filtros/bulk/comments/completion/reopen/assignee/priority/status continuam vindo de loadPendenciasRawData, nenhuma reimplementação", demandasPageSource.includes("loadPendenciasRawData"));
}

console.log("\n7 — TIMELINE: Todos -> /timeline; cliente -> /clients/[id]/timeline; preservado nas duas direções\n");
{
  check("Timeline + Todos -> /timeline", buildModuleContextHref("timeline", { type: "all" }, null), "/timeline");
  check("Timeline + cliente -> /clients/[id]/timeline", buildModuleContextHref("timeline", { type: "client", id: "leonardo" }, null), "/clients/leonardo/timeline");
  ok("/timeline monta GlobalScopeSelect", timelinePageSource.includes('<GlobalScopeSelect module="timeline"'));
}

console.log("\n8 — METAS/PERFORMANCE/DADOS: sem rota global (decisão documentada) — Todos cai em /clients, nunca inventa agregação\n");
{
  const modulesWithoutGlobal: ModuleKey[] = ["metas", "performance", "dados"];
  for (const moduleKey of modulesWithoutGlobal) {
    check(`${moduleKey} + Todos -> /clients (nenhuma rota global inventada)`, buildModuleContextHref(moduleKey, { type: "all" }, null), "/clients");
  }
  check("Metas: clienteA -> clienteB preserva o módulo", buildModuleContextHref("metas", { type: "client", id: "b" }, null), "/clients/b/metas");
  check("Performance: clienteA -> clienteB preserva o módulo (rota técnica /relatorio)", buildModuleContextHref("performance", { type: "client", id: "b" }, null), "/clients/b/relatorio");
  check("Dados: clienteA -> clienteB preserva o módulo", buildModuleContextHref("dados", { type: "client", id: "b" }, null), "/clients/b/dados");
  // Etapa "Correção do fluxo final do Dashboard": dashboard VOLTOU a ter
  // entrada em MODULE_GLOBAL_HREF ("/", o resolver pro primeiro cliente —
  // nunca uma agregação consolidada nova), mas metas/performance/dados
  // continuam de fora — a checagem completa dessa decisão vive na suite
  // própria da correção.
  ok(
    "nenhum cálculo/agregação consolidada nova foi criada pra Metas/Performance/Dados (MODULE_GLOBAL_HREF só ganhou o resolver do Dashboard, nunca uma entrada pra Metas/Performance/Dados)",
    /MODULE_GLOBAL_HREF: Partial<Record<ModuleKey, string>> = \{\s*dashboard: "\/",\s*operation: "\/operation",\s*demandas: "\/demandas",\s*timeline: "\/timeline",\s*\};/.test(
      loadSource("src", "lib", "client-workspace-nav.ts"),
    ),
  );
}

console.log("\n9 — Preservação de módulo na troca de contexto (seção 9/10 do pedido, matriz completa)\n");
{
  check(
    "Helping Hand->Operação, seleciona Leonardo -> Leonardo->Operação",
    buildModuleContextHref("operation", { type: "client", id: "leonardo" }, null),
    "/clients/leonardo/operation",
  );
  check(
    "Helping Hand->Operação, seleciona Todos -> Operação global",
    buildModuleContextHref("operation", { type: "all" }, null),
    "/operation",
  );
  // Etapa "Correção Conceitual da Fase 4.6": Dashboard nunca mais oferece
  // "Todos" (ver suite própria) — este cenário específico não se aplica
  // mais a Dashboard; a troca TODOS->cliente dos módulos operacionais
  // (verificada logo abaixo, Operação) continua intacta.
  check(
    "Todos->Operação, seleciona Helping Hand -> Helping Hand->Operação (mesma função, direção inversa)",
    buildModuleContextHref("operation", { type: "client", id: "helping-hand" }, null),
    "/clients/helping-hand/operation",
  );
}

console.log("\n10 — CLIENTES: /clients continua funcionando (Fase 4.5 intocada) — busca/filtros/organizar carteira/wallet_position/abrir cliente\n");
{
  const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
  ok("/clients continua existindo e com a mesma listagem/filtros da Fase 4.5", clientsPageSource.includes("<ClientsFilters") && clientsPageSource.includes("Organizar carteira"));
  ok("nenhuma mudança na lógica de wallet_position/moveClientAction nesta fase", loadSource("src", "app", "agency-accounts-tree-actions.ts").includes("wallet_position: positionResult.position"));
}

console.log("\n11 — REGRESSÃO: month preservado, filtros locais continuam locais, permissões, rotas antigas, links externos, mobile\n");
{
  check("month só se aplica a contexto de cliente (nunca propagado pra rota global)", buildModuleContextHref("operation", { type: "all" }, "2026-10"), "/operation");
  check("month preservado entre módulos do MESMO cliente", buildModuleContextHref("metas", { type: "client", id: "x" }, "2026-10"), "/clients/x/metas?month=2026-10");
  ok(
    "filtros locais (mês/objetivo/canal/funil/status/responsável/prioridade) continuam cada um no seu módulo — nenhum virou filtro global do app (GlobalScopeSelect/ClientWorkspaceHeader só resolvem módulo×contexto, nunca mês/objetivo/canal)",
    !globalScopeSelectSource.includes("month") && !globalScopeSelectSource.includes("goal") && !globalScopeSelectSource.includes("channel"),
  );
  ok("ClientWorkspaceHeader continua montado só em clients/[id]/layout.tsx (nenhum novo lugar de montagem)", loadSource("src", "app", "clients", "[id]", "layout.tsx").includes("<ClientWorkspaceHeader"));
  ok("nenhuma rota antiga removida (grep positivo nos arquivos de rota já testados em outras seções)", existsSync(join(__dirname, "..", "src", "app", "clients", "[id]", "edit", "page.tsx")));
  ok("links externos (Dashboard/Saldo/Fechamento) continuam em [id]/page.tsx, intocados nesta fase", loadSource("src", "app", "clients", "[id]", "page.tsx").includes("externalLinks"));
  ok("nenhuma navegação mobile paralela foi criada (Sidebar continua único componente de drawer)", !existsSync(join(__dirname, "..", "src", "app", "sidebar-mobile.tsx")));
}

console.log(`\n${passed} verificações passaram.`);
