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

console.log("\n1 — Carteira: os 4 itens globais continuam intactos (nenhuma duplicação acidental removida)\n");
{
  ok("Visão Geral (Carteira) → /", /label: "Visão Geral", href: "\/"/.test(sidebarSource));
  ok("Operação global (Carteira) → /operation", /label: "Operação",\s*\n\s*href: "\/operation"/.test(sidebarSource));
  ok("Demandas global (Carteira) → /demandas", sidebarSource.includes('label: "Demandas"') && sidebarSource.includes('href: "/demandas"'));
  ok("Timeline global (Carteira) → /timeline", sidebarSource.includes('label: "Timeline"') && sidebarSource.includes('href: "/timeline"'));
  ok('eyebrow "Carteira" visível acima dos 4 itens globais', />\s*Carteira\s*</.test(sidebarSource));
  ok('eyebrow "Administração" continua intacta (Equipe/Configurações)', />\s*Administração\s*</.test(sidebarSource));
}

console.log("\n2 — Cliente: os 7 módulos da Growth Infra, agrupados Growth/Execução\n");
{
  ok("CLIENT_MODULE_ITEMS define Dashboard (sufixo vazio, grupo growth)", /\{ label: "Dashboard", suffix: "", icon: LayoutDashboard, group: "growth" \}/.test(sidebarSource));
  ok("CLIENT_MODULE_ITEMS define Metas (/metas, grupo growth)", /\{ label: "Metas", suffix: "\/metas", icon: Target, group: "growth" \}/.test(sidebarSource));
  ok(
    "CLIENT_MODULE_ITEMS define Performance (rota técnica /relatorio intacta, só o RÓTULO é novo, grupo growth)",
    /\{ label: "Performance", suffix: "\/relatorio", icon: BarChart3, group: "growth" \}/.test(sidebarSource),
  );
  ok("CLIENT_MODULE_ITEMS define Dados (/dados, grupo growth)", /\{ label: "Dados", suffix: "\/dados", icon: Database, group: "growth" \}/.test(sidebarSource));
  ok("CLIENT_MODULE_ITEMS define Operação (/operation, grupo execucao)", /\{ label: "Operação", suffix: "\/operation", icon: ListChecks, group: "execucao" \}/.test(sidebarSource));
  ok("CLIENT_MODULE_ITEMS define Demandas (/demandas, grupo execucao)", /\{ label: "Demandas", suffix: "\/demandas", icon: ClipboardList, group: "execucao" \}/.test(sidebarSource));
  ok("CLIENT_MODULE_ITEMS define Timeline (/timeline, grupo execucao)", /\{ label: "Timeline", suffix: "\/timeline", icon: History, group: "execucao" \}/.test(sidebarSource));

  ok('bloco "Cliente" só renderiza quando há cliente ativo na rota (activeClientId)', sidebarSource.includes("{activeClientId && ("));
  ok('eyebrow "Cliente" presente dentro do bloco condicional', />\s*Cliente\s*</.test(sidebarSource));
  ok('eyebrow "Growth" presente (subgrupo dentro do bloco Cliente)', />\s*Growth\s*</.test(sidebarSource));
  ok('eyebrow "Execução" presente (subgrupo dentro do bloco Cliente)', />\s*Execução\s*</.test(sidebarSource));
  ok(
    'destaque visual do bloco Cliente usa token de design EXISTENTE (`sand-subtle`, já usado como "superfície selecionada" em outras telas) — nenhuma cor nova inventada',
    sidebarSource.includes("bg-sand-subtle"),
  );
}

console.log("\n3 — ClientModuleLink reaproveita o mecanismo existente (buildWorkspaceHref, resolveCurrentSuffix) — não reconstrói nada\n");
{
  ok("ClientModuleLink importa buildWorkspaceHref/resolveCurrentSuffix de lib/client-workspace-nav (núcleo já existente)", sidebarSource.includes('import { buildWorkspaceHref, resolveActiveClientIdFromPathname, resolveCurrentSuffix } from "@/lib/client-workspace-nav"'));
  ok("ClientModuleLink monta o href com buildWorkspaceHref (preserva ?month=, nunca uma segunda forma de montar URL)", /const href = buildWorkspaceHref\(clientId, item\.suffix, month\)/.test(sidebarSource));
  ok("estado ativo compara contra o SUFIXO resolvido (resolveCurrentSuffix), não contra pathname bruto", /const active = item\.suffix === currentSuffix/.test(sidebarSource));
}

console.log("\n4 — Árvore 'Contas da Agência': continua montada na Sidebar nesta fase (não removida silenciosamente)\n");
{
  ok("agencyTree continua renderizado na Sidebar, sem mudança de comportamento", sidebarSource.includes("<div className={collapsed ? \"md:hidden\" : \"\"}>{agencyTree}</div>"));
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
  ok(
    "Sidebar lê month via searchParams (mesmo mecanismo de 'mode' já existente) — nenhum header global novo com mês/objetivo/canal",
    sidebarSource.includes('onMode={(mode, month) =>') && sidebarSource.includes("searchParams.get(\"month\")"),
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
