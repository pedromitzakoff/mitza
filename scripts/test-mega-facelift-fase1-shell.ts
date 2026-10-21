/**
 * Testes da Etapa "MEGA FACELIFT — Fase 1: Novo Shell da Growth Infra" —
 * cobre a reorganização da Sidebar (Carteira × Cliente) e o núcleo de
 * navegação do workspace do cliente. Fase 1 é só ARQUITETURA DE
 * NAVEGAÇÃO — nenhum cálculo, schema, diagnóstico ou integração muda aqui;
 * a maior parte dos testes é estrutural (sem Supabase real neste
 * ambiente), mesmo padrão já usado por `test-client-workspace.ts`.
 *
 * KOFF Analytics — Etapa 1.8: `WORKSPACE_SECTION_SUFFIXES`/
 * `resolveReplicableSuffix` (e tudo que dependia deles — a Sidebar, desde
 * "MITZA ONE — Fase 2", já trocava de cliente SEMPRE pro Dashboard,
 * `buildWorkspaceHref(clientId, "", month)`, nunca replicando sub-rota —
 * essas funções já estavam sem consumidor real) foram removidos junto com
 * o restante do sistema de "módulos" (`lib/client-workspace-nav.ts`), que
 * só sobrevivia pra sustentar Operação/`GlobalScopeSelect`, ambos
 * removidos nesta etapa. Os testes que dependiam deles, ou da rota
 * `/operation`, saíram — o que resta aqui é o que ainda está vivo:
 * `buildWorkspaceHref`/`resolveCurrentSuffix`/`resolveActiveClientIdFromPathname`.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase1-shell.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorkspaceHref, resolveCurrentSuffix } from "../src/lib/client-workspace-nav";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const sidebarSource = loadSource("src", "app", "sidebar.tsx");

console.log("\n1 — Carteira de clientes (MITZA ONE — Fase 2): busca + lista rolável substituem os antigos grupos Growth/Execução\n");
{
  ok('eyebrow "Growth"/"Execução" não existem mais (não há mais agrupamento por módulo)', !/>\s*Growth\s*</.test(sidebarSource) && !/>\s*Execução\s*</.test(sidebarSource));
  ok(
    'grupo "Agência" não existe mais (Demandas, seu último item, foi removida na Etapa 1.6 da reestruturação KOFF Analytics)',
    !sidebarSource.includes('label="Agência"'),
  );
  ok("Sidebar renderiza um campo de busca de cliente (input controlado, filtro local)", sidebarSource.includes('placeholder="Buscar cliente...') && sidebarSource.includes("onChange={(e) => setSearch(e.target.value)}"));
  ok("ClientRow usa ClientAvatar (mesmo componente já usado na árvore de contas) — nenhum avatar novo", sidebarSource.includes("<ClientAvatar name={client.name} imageUrl={client.avatarUrl}"));
  ok("Sidebar recolhida nunca lista todos os clientes como ícones (seção 5 do pedido) — versão compacta só mostra o cliente atual + gatilho de busca", sidebarSource.includes('collapsed ? "hidden flex-col items-center gap-1.5 px-2.5 md:flex" : "hidden"'));
}

console.log("\n2 — ClientRow reaproveita o núcleo único de navegação do workspace — não reconstrói nada\n");
{
  ok(
    "ClientRow importa buildWorkspaceHref/resolveActiveClientIdFromPathname de lib/client-workspace-nav (núcleo único, intocado)",
    sidebarSource.includes('import { buildWorkspaceHref, resolveActiveClientIdFromPathname } from "@/lib/client-workspace-nav"'),
  );
  ok(
    "ClientRow monta o href SEMPRE com suffix '' (cockpit, nunca replica sub-rota legada) + month preservado — nenhuma segunda forma de montar URL",
    /const href = buildWorkspaceHref\(client\.id, "", month\)/.test(sidebarSource),
  );
  ok("estado ativo compara o ID do cliente (resolveActiveClientIdFromPathname) contra client.id, nunca contra pathname bruto nem contra o NOME (seguro mesmo com nomes repetidos)", /const active = client\.id === activeClientId/.test(sidebarSource));
}

console.log("\n3 — Árvore 'Contas da Agência': continua existindo, agora montada em /clients — não removida silenciosamente, nunca deletada\n");
{
  ok("Sidebar não renderiza mais a árvore (linha antiga removida)", !sidebarSource.includes("{agencyTree}"));
  ok("Sidebar não recebe mais a prop agencyTree (plumbing removido junto, só o que esta fase causou)", !sidebarSource.includes("agencyTree"));
  const clientsPageSource = loadSource("src", "app", "clients", "page.tsx");
  ok("a árvore continua existindo e agora é importada por /clients/page.tsx, nunca deletada", clientsPageSource.includes('import { AgencyAccountsTree } from "../agency-accounts-tree"') && clientsPageSource.includes("<AgencyAccountsTree />"));
  ok("agency-accounts-tree.tsx continua no disco, intocado", loadSource("src", "app", "agency-accounts-tree.tsx").includes("export async function AgencyAccountsTree"));
}

console.log("\n4 — resolveCurrentSuffix identifica corretamente a seção atual do workspace, pros módulos que sobrevivem (Dashboard/Metas/Performance/Dados)\n");
{
  const scenarios: { label: string; path: string; suffix: string }[] = [
    { label: "Dashboard", path: "/clients/leonardo", suffix: "" },
    { label: "Metas", path: "/clients/leonardo/metas", suffix: "/metas" },
    { label: "Performance", path: "/clients/leonardo/relatorio", suffix: "/relatorio" },
    { label: "Dados", path: "/clients/leonardo/dados", suffix: "/dados" },
  ];
  for (const scenario of scenarios) {
    const current = resolveCurrentSuffix(scenario.path, "leonardo");
    ok(`${scenario.label}: resolveCurrentSuffix identifica o sufixo correto ("${scenario.suffix}")`, current === scenario.suffix);
  }
}

console.log("\n5 — Preservação de ?month= ao montar o href do workspace\n");
{
  ok("month preservado trocando de Dashboard para Performance do MESMO cliente", buildWorkspaceHref("leonardo", "/relatorio", "2026-08") === "/clients/leonardo/relatorio?month=2026-08");
  ok("month preservado trocando de cliente mantendo Metas", buildWorkspaceHref("pet-fast", "/metas", "2026-08") === "/clients/pet-fast/metas?month=2026-08");
  ok(
    "Sidebar lê month via searchParams (SidebarMonthParam/onMonth) — nenhum header global novo com mês/objetivo/canal",
    sidebarSource.includes("onMonth={(month) =>") && sidebarSource.includes('searchParams.get("month")'),
  );
}

console.log("\n6 — Shells da Fase 1 que sobrevivem evoluíram pra conteúdo funcional: Metas (Fase 2), Dados (Fase 5)\n");
{
  const metasSource = loadSource("src", "app", "clients", "[id]", "metas", "page.tsx");
  const dadosSource = loadSource("src", "app", "clients", "[id]", "dados", "page.tsx");

  ok("Metas usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", metasSource.includes("<WorkspaceContainer>"));
  ok("Metas não é mais o placeholder da Fase 1 (evoluiu na Fase 2)", !metasSource.includes("Área de metas do cliente."));
  ok("Dados usa WorkspaceContainer (mesma largura do resto do workspace, nenhum max-width solto novo)", dadosSource.includes("<WorkspaceContainer>"));
  ok("Dados não é mais o placeholder da Fase 1 (evoluiu na Fase 5)", !dadosSource.includes("Infraestrutura de dados do cliente."));
}

console.log(`\n${passed} verificações passaram.`);
