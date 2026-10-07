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

console.log("\n1 — MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes) substitui os 7 módulos fixos (Fase 4.6) por navegação por CLIENTE — histórico preservado, assertivas atualizadas\n");
{
  // MITZA ONE — Fase 2: a lista única de 7 módulos (Fase 4.6, substituta
  // da dualidade Carteira×Cliente desta Fase 1) foi substituída por
  // navegação por CLIENTE — a Sidebar virou a carteira (busca + lista),
  // seguida de uma área "Agência" (ferramentas transversais: Demandas/
  // Operação/Timeline globais) e "Gestão" (Clientes/Equipe/
  // Configurações). Cobertura completa em test-mitza-one-fase2-sidebar.ts;
  // aqui só confirma que os 7 módulos deixaram de existir como conceito
  // na Sidebar — nenhum deles some do produto (rotas preservadas,
  // seção 8 do pedido da Fase 2), só deixam de ter item próprio aqui.
  ok("Sidebar não define mais MODULES (dashboard/metas/performance/dados como itens de navegação)", !/\{ key: "dashboard", label: "Dashboard"/.test(sidebarSource) && !/\{ key: "metas", label: "Metas"/.test(sidebarSource));
  ok("Operação continua acessível — agora um link GLOBAL fixo na área Agência (nunca por cliente, ver Fase 2)", /label: "Operação", href: "\/operation"/.test(sidebarSource));
  ok("Demandas continua acessível — mesmo padrão (link global fixo)", /label: "Demandas", href: "\/demandas"/.test(sidebarSource));
  ok("Timeline continua acessível — mesmo padrão (link global fixo)", /label: "Timeline", href: "\/timeline"/.test(sidebarSource));
  ok('eyebrow "Carteira" não existe mais como label — a carteira agora é a lista de clientes diretamente, sem rótulo "Carteira" acima', !/>\s*Carteira\s*</.test(sidebarSource));
  ok('eyebrow "Gestão" continua — Clientes/Equipe/Configurações, agora dentro da área "Agência"', />\s*Gestão\s*</.test(sidebarSource));
}

console.log("\n2 — Carteira de clientes (MITZA ONE — Fase 2): busca + lista rolável substituem os antigos grupos Growth/Execução\n");
{
  ok('eyebrow "Growth"/"Execução" não existem mais (não há mais agrupamento por módulo)', !/>\s*Growth\s*</.test(sidebarSource) && !/>\s*Execução\s*</.test(sidebarSource));
  ok('eyebrow "Agência" existe (ferramentas transversais)', />\s*Agência\s*</.test(sidebarSource));
  ok("Sidebar renderiza um campo de busca de cliente (input controlado, filtro local)", sidebarSource.includes('placeholder="Buscar cliente...') && sidebarSource.includes("onChange={(e) => setSearch(e.target.value)}"));
  ok("ClientRow usa ClientAvatar (mesmo componente já usado na Operação/árvore de contas) — nenhum avatar novo", sidebarSource.includes("<ClientAvatar name={client.name} imageUrl={client.avatarUrl}"));
  ok("Sidebar recolhida nunca lista todos os clientes como ícones (seção 5 do pedido) — versão compacta só mostra o cliente atual + gatilho de busca", sidebarSource.includes('collapsed ? "hidden flex-col items-center gap-1.5 px-2.5 md:flex" : "hidden"'));
}

console.log("\n3 — ClientRow reaproveita o núcleo único de navegação do workspace — não reconstrói nada\n");
{
  ok(
    "ClientRow importa buildWorkspaceHref/resolveActiveClientIdFromPathname de lib/client-workspace-nav (núcleo único, intocado — mesmas funções já usadas por anterior/próximo/GlobalScopeSelect antes desta fase)",
    sidebarSource.includes('import { buildWorkspaceHref, resolveActiveClientIdFromPathname } from "@/lib/client-workspace-nav"'),
  );
  ok(
    "ClientRow monta o href SEMPRE com suffix '' (cockpit, nunca replica sub-rota legada) + month preservado — nenhuma segunda forma de montar URL",
    /const href = buildWorkspaceHref\(client\.id, "", month\)/.test(sidebarSource),
  );
  ok("estado ativo compara o ID do cliente (resolveActiveClientIdFromPathname) contra client.id, nunca contra pathname bruto nem contra o NOME (seguro mesmo com nomes repetidos)", /const active = client\.id === activeClientId/.test(sidebarSource));
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

console.log("\n9 — Todos os shells da Fase 1 evoluíram pra conteúdo funcional: Metas (Fase 2), Dados (Fase 5), Timeline (Fase 6) — ver suites próprias\n");
{
  const metasSource = loadSource("src", "app", "clients", "[id]", "metas", "page.tsx");
  const dadosSource = loadSource("src", "app", "clients", "[id]", "dados", "page.tsx");
  const timelineSource = loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx");

  // Etapa "MEGA FACELIFT — Fase 2: Metas": o shell vazio desta fase foi
  // substituído por conteúdo funcional real — a checagem de que ainda é só
  // um placeholder não se aplica mais aqui (ver suite própria da Fase 2).
  ok("Metas usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", metasSource.includes("<WorkspaceContainer>"));
  ok("Metas não é mais o placeholder da Fase 1 (evoluiu na Fase 2)", !metasSource.includes("Área de metas do cliente."));

  // Etapa "MEGA FACELIFT — Fase 5: Dados": idem, shell vazio substituído por
  // conteúdo funcional real (fontes/qualidade dos dados) — ver suite própria
  // (test-mega-facelift-fase5-dados.ts).
  ok("Dados usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", dadosSource.includes("<WorkspaceContainer>"));
  ok("Dados não é mais o placeholder da Fase 1 (evoluiu na Fase 5)", !dadosSource.includes("Infraestrutura de dados do cliente."));

  // Etapa "MEGA FACELIFT — Fase 6: Timeline": idem, shell vazio substituído
  // por conteúdo funcional real (memória do Growth do cliente) — ver suite
  // própria (test-mega-facelift-fase6-timeline.ts).
  ok("Timeline usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", timelineSource.includes("<WorkspaceContainer>"));
  ok("Timeline não é mais o placeholder da Fase 1 (evoluiu na Fase 6)", !timelineSource.includes("Histórico do Growth deste cliente."));
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
