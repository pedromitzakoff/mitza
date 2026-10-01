/**
 * Testes da Etapa "MEGA FACELIFT — Fase 1: Novo Shell da Growth Infra" —
 * cobre a reorganização da Sidebar (Carteira × Cliente, com Growth/
 * Execução dentro de Cliente), os 3 shells novos (Metas/Dados/Timeline do
 * cliente) e a generalização de `WORKSPACE_SECTION_SUFFIXES` pra 7
 * módulos. Fase 1 é só ARQUITETURA DE NAVEGAÇÃO — nenhum cálculo,
 * schema, diagnóstico ou integração muda aqui; a maior parte dos testes é
 * estrutural (sem Supabase real neste ambiente), mesmo padrão já usado
 * por `test-client-workspace.ts`.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase1-shell.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const sidebarSource = loadSource("src", "app", "sidebar.tsx");

console.log("\n1 — Carteira/Cliente (Fase 1) foram substituídos por módulos fixos (Fase 4.6) — histórico preservado, assertivas atualizadas\n");
{
  // Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como
  // Contexto Global": a dualidade "Carteira" (4 itens globais) ×
  // "Cliente" (7 módulos condicionais a activeClientId) desta Fase 1 foi
  // substituída por UMA lista única de 7 módulos SEMPRE visíveis
  // (MODULES, sidebar.tsx) — cobertura completa em
  // test-mega-facelift-fase46-contexto-global.ts. Aqui só confirma que a
  // intenção original da Fase 1 ("Visão Geral/Operação/Demandas/Timeline
  // acessíveis globalmente" + "Dashboard/Metas/Performance/Dados/Operação/
  // Demandas/Timeline acessíveis dentro do cliente") continua coberta,
  // agora por um mecanismo único.
  ok("Visão Geral virou Dashboard + contexto Todos (MODULES[0], mapeia pra / via buildModuleContextHref)", /\{ key: "dashboard", label: "Dashboard"/.test(sidebarSource));
  ok("Operação continua acessível global (/operation) e por cliente, mesmo módulo único", /\{ key: "operation", label: "Operação"/.test(sidebarSource));
  ok("Demandas continua acessível global (/demandas) e por cliente, mesmo módulo único", /\{ key: "demandas", label: "Demandas"/.test(sidebarSource));
  ok("Timeline continua acessível global (/timeline) e por cliente, mesmo módulo único", /\{ key: "timeline", label: "Timeline"/.test(sidebarSource));
  ok('eyebrow "Carteira" não existe mais (módulos não são mais "globais" separados de "do cliente")', !/>\s*Carteira\s*</.test(sidebarSource));
  ok('eyebrow "Gestão" (antes "Administração") continua — Equipe/Configurações, agora com Clientes junto', />\s*Gestão\s*</.test(sidebarSource));
}

console.log("\n2 — Os 7 módulos da Growth Infra, agrupados Growth/Execução — SEMPRE visíveis (Fase 4.6), não mais condicionais a um cliente ativo\n");
{
  ok("MODULES define Dashboard (módulo growth)", /\{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "growth" \}/.test(sidebarSource));
  ok("MODULES define Metas (módulo growth)", /\{ key: "metas", label: "Metas", icon: Target, group: "growth" \}/.test(sidebarSource));
  ok(
    "MODULES define Performance (rota técnica /relatorio intacta, só o RÓTULO é novo, módulo growth)",
    /\{ key: "performance", label: "Performance", icon: BarChart3, group: "growth" \}/.test(sidebarSource),
  );
  ok("MODULES define Dados (módulo growth)", /\{ key: "dados", label: "Dados", icon: Database, group: "growth" \}/.test(sidebarSource));
  ok("MODULES define Operação (módulo execucao)", /\{ key: "operation", label: "Operação", icon: ListChecks, group: "execucao" \}/.test(sidebarSource));
  ok("MODULES define Demandas (módulo execucao)", /\{ key: "demandas", label: "Demandas", icon: ClipboardList, group: "execucao" \}/.test(sidebarSource));
  ok("MODULES define Timeline (módulo execucao)", /\{ key: "timeline", label: "Timeline", icon: History, group: "execucao" \}/.test(sidebarSource));

  // Fase 4.6 (seção 18 do pedido): "não criar bloco destacado de
  // CLIENTE", "não mostrar nome do cliente dentro da sidebar" — o bloco
  // condicional/eyebrow "Cliente"/superfície sand-subtle da Fase 1 saiu
  // por completo; Growth/Execução ficam direto no corpo da nav.
  ok("bloco condicional 'Cliente' (activeClientId && (...)) não existe mais — módulos sempre renderizam", !sidebarSource.includes("{activeClientId &&"));
  ok('eyebrow "Cliente" não existe mais dentro da Sidebar', !/>\s*Cliente\s*</.test(sidebarSource));
  ok('eyebrow "Growth" continua, agora no corpo principal (não mais dentro de um bloco condicional)', />\s*Growth\s*</.test(sidebarSource));
  ok('eyebrow "Execução" continua, agora no corpo principal (não mais dentro de um bloco condicional)', />\s*Execução\s*</.test(sidebarSource));
  ok("superfície sand-subtle do antigo bloco 'Cliente' saiu junto — nenhuma cor nova em seu lugar", !sidebarSource.includes("bg-sand-subtle"));
}

console.log("\n3 — ModuleLink (sucessor de ClientModuleLink) reaproveita o núcleo único de módulo×contexto — não reconstrói nada\n");
{
  ok(
    "ModuleLink importa buildModuleContextHref/resolveCurrentModuleAndContext de lib/client-workspace-nav (núcleo único, Fase 4.6)",
    sidebarSource.includes('import { buildModuleContextHref, resolveCurrentModuleAndContext, type AppContext, type ModuleKey } from "@/lib/client-workspace-nav"'),
  );
  ok(
    "ModuleLink monta o href com buildModuleContextHref (preserva ?month= só no contexto de cliente, nunca uma segunda forma de montar URL)",
    /const href = buildModuleContextHref\(item\.key, context, month\)/.test(sidebarSource),
  );
  ok("estado ativo compara o MÓDULO resolvido (currentModule) contra a key do item, não contra pathname bruto", /const active = item\.key === currentModule/.test(sidebarSource));
}

console.log("\n4 — Árvore 'Contas da Agência': Fase 1 a mantinha montada na Sidebar; Fase 4.5 ('Navegação da Carteira') a realocou pra /clients — não removida silenciosamente, nunca deletada\n");
{
  // Etapa "MEGA FACELIFT — Fase 4.5: Navegação da Carteira" (seção 3 do
  // pedido): a árvore deixou de ocupar a Sidebar permanentemente — ver
  // cobertura completa em test-mega-facelift-fase45-carteira.ts. Aqui só
  // confirma que a Sidebar não tenta mais renderizá-la (nem a prop
  // `agencyTree`, removida de Sidebar/SidebarContent/AppShell) e que o
  // componente em si (`agency-accounts-tree.tsx`) continua existindo e
  // sendo usado — agora como import de `/clients/page.tsx`.
  ok("Sidebar não renderiza mais a árvore (linha antiga removida)", !sidebarSource.includes("{agencyTree}"));
  ok("Sidebar não recebe mais a prop agencyTree (plumbing removido junto, só o que esta fase causou)", !sidebarSource.includes("agencyTree"));
  const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
  ok("a árvore continua existindo e agora é importada por /clients/page.tsx, nunca deletada", clientsPageSource.includes('import { AgencyAccountsTree } from "../agency-accounts-tree"') && clientsPageSource.includes("<AgencyAccountsTree />"));
  ok("agency-accounts-tree.tsx continua no disco, intocado", loadSource("src", "app", "agency-accounts-tree.tsx").includes("export async function AgencyAccountsTree"));
}

console.log("\n5 — WORKSPACE_SECTION_SUFFIXES generalizado pra 7 módulos; '/edit' deixou de ser replicável (mudança de comportamento explícita, não uma remoção de funcionalidade)\n");
{
  check("os 7 sufixos reconhecidos, na ordem Dashboard/Metas/Performance/Dados/Operação/Demandas/Timeline", WORKSPACE_SECTION_SUFFIXES, [
    "",
    "/metas",
    "/relatorio",
    "/dados",
    "/operation",
    "/demandas",
    "/timeline",
  ]);
  check("'/edit' não é mais replicado ao trocar de cliente (cai pro Dashboard, mesma regra de qualquer rota fora da lista)", resolveReplicableSuffix("/edit"), "");
  ok("a rota /clients/[id]/edit em si não foi tocada nesta fase (segue existindo)", existsSync(join(__dirname, "..", "src", "app", "clients", "[id]", "edit", "page.tsx")));
}

console.log("\n6 — Trocar de cliente preserva a dimensão atual, para cada um dos 7 módulos (simulação ponta a ponta)\n");
{
  const scenarios: { label: string; path: string; suffix: string }[] = [
    { label: "Dashboard", path: "/clients/leonardo", suffix: "" },
    { label: "Metas", path: "/clients/leonardo/metas", suffix: "/metas" },
    { label: "Performance", path: "/clients/leonardo/relatorio", suffix: "/relatorio" },
    { label: "Dados", path: "/clients/leonardo/dados", suffix: "/dados" },
    { label: "Operação", path: "/clients/leonardo/operation", suffix: "/operation" },
    { label: "Demandas", path: "/clients/leonardo/demandas", suffix: "/demandas" },
    { label: "Timeline", path: "/clients/leonardo/timeline", suffix: "/timeline" },
  ];

  for (const scenario of scenarios) {
    const current = resolveCurrentSuffix(scenario.path, "leonardo");
    check(`${scenario.label}: resolveCurrentSuffix identifica o módulo atual corretamente`, current, scenario.suffix);
    const replicable = resolveReplicableSuffix(current);
    const nextHref = buildWorkspaceHref("pet-fast", replicable, null);
    check(`Leonardo → ${scenario.label}, troca cliente, Pet Fast → ${scenario.label} (mesma dimensão preservada)`, nextHref, `/clients/pet-fast${scenario.suffix}`);
  }
}

console.log("\n7 — Fallback seguro para Dashboard quando a rota não é um dos 7 módulos reconhecidos\n");
{
  const legacyScenarios = ["/clients/leonardo/tasks/new", "/clients/leonardo/edit"];
  for (const path of legacyScenarios) {
    const current = resolveCurrentSuffix(path, "leonardo");
    const replicable = resolveReplicableSuffix(current);
    const nextHref = buildWorkspaceHref("pet-fast", replicable, null);
    check(`'${path}' (fora dos 7 módulos) → trocar de cliente cai pro Dashboard de Pet Fast`, nextHref, "/clients/pet-fast");
  }
}

console.log("\n8 — Preservação de ?month= ao trocar de módulo/cliente (contexto local, nunca promovido a header global)\n");
{
  check("month preservado trocando de Dashboard para Performance do MESMO cliente", buildWorkspaceHref("leonardo", "/relatorio", "2026-08"), "/clients/leonardo/relatorio?month=2026-08");
  check("month preservado trocando de cliente mantendo Metas", buildWorkspaceHref("pet-fast", "/metas", "2026-08"), "/clients/pet-fast/metas?month=2026-08");
  // Fase 4.6: "mode" (nunca consumido por nenhum item de nav) foi removido
  // junto da consolidação dos módulos fixos — `SidebarMonthParam`/`onMonth`
  // é o sucessor direto, só com `month` (o único parâmetro que a Sidebar
  // de fato precisa pra montar os hrefs dos módulos).
  ok(
    "Sidebar lê month via searchParams (SidebarMonthParam/onMonth) — nenhum header global novo com mês/objetivo/canal",
    sidebarSource.includes("onMonth={(month) =>") && sidebarSource.includes('searchParams.get("month")'),
  );
}

console.log("\n9 — Shells restantes (Dados/Timeline) seguem sem conteúdo funcional; Metas evoluiu na Fase 2 (ver test-mega-facelift-fase2-metas.ts)\n");
{
  const metasSource = loadSource("src", "app", "clients", "[id]", "metas", "page.tsx");
  const dadosSource = loadSource("src", "app", "clients", "[id]", "dados", "page.tsx");
  const timelineSource = loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx");

  // Etapa "MEGA FACELIFT — Fase 2: Metas": o shell vazio desta fase foi
  // substituído por conteúdo funcional real — a checagem de que ainda é só
  // um placeholder não se aplica mais aqui (ver suite própria da Fase 2).
  ok("Metas usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", metasSource.includes("<WorkspaceContainer>"));
  ok("Metas não é mais o placeholder da Fase 1 (evoluiu na Fase 2)", !metasSource.includes("Área de metas do cliente."));

  ok("Dados usa WorkspaceContainer", dadosSource.includes("<WorkspaceContainer>"));
  ok("Dados mostra o placeholder esperado nesta fase", dadosSource.includes("Infraestrutura de dados do cliente."));

  ok("Timeline usa WorkspaceContainer", timelineSource.includes("<WorkspaceContainer>"));
  ok("Timeline mostra o placeholder esperado nesta fase", timelineSource.includes("Histórico do Growth deste cliente."));

  ok(
    "Dados/Timeline (ainda shells) não importam lógica de cálculo/diagnóstico/integração — grep negativo por imports de lib pesada",
    !/from "@\/lib\/(client-goals|client-plan|metric-diagnostics|account-health-engine|stract-sync|import-sources)"/.test(dadosSource + timelineSource),
  );
}

console.log("\n10 — Rotas existentes (Performance/Operação/Demandas) permanecem tecnicamente intactas — só o RÓTULO muda na navegação\n");
{
  const relatorioSource = loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx");
  const operationSource = loadSource("src", "app", "clients", "[id]", "operation", "page.tsx");
  const demandasSource = loadSource("src", "app", "clients", "[id]", "demandas", "page.tsx");

  ok("/relatorio não foi renomeada tecnicamente — rota/arquivo intactos", existsSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "page.tsx")));
  ok("/relatorio continua usando a mesma largura compartilhada de sempre", relatorioSource.includes("WORKSPACE_CONTENT_MAX_WIDTH_CLASS"));
  ok("/clients/[id]/operation continua intacta (origin='template' preservado)", operationSource.includes("origin='template'") || operationSource.includes("origin=\"template\""));
  ok("/clients/[id]/demandas continua reaproveitando loadPendenciasRawData (nenhuma segunda implementação)", demandasSource.includes("loadPendenciasRawData(supabase, id)"));

  ok(
    "relatório público (/r/[token]) e geração de PDF não foram tocados nesta fase",
    existsSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx")),
  );
}

console.log(`\n${passed} verificações passaram.`);
