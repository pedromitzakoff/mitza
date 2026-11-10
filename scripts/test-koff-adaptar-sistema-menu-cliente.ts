/**
 * Testes da Etapa "KOFF Analytics — Adaptar o sistema" (pedido explícito
 * do usuário, a partir de uma referência visual, com o ajuste de
 * arquitetura pedido na rodada seguinte): menu lateral do cliente com 4
 * itens (Dashboard/Campanhas/Anúncios/Metas), substituindo a Carteira
 * enquanto dentro do workspace de um cliente — "Contas" deixou de ser
 * item de menu e virou o `ClientSwitcher` no topo (seletor de cliente,
 * nunca uma rota), que também permite voltar à Carteira (`/clients`, que
 * por sua vez já limpa o cliente ativo — mesma fonte de verdade de
 * sempre, `resolveActiveClientIdFromPathname`).
 *
 * `buildClientNavItems` é puro — testável sem DOM/router, mesmo o arquivo
 * tendo "use client" (só relevante pro bundler do Next, nunca pra
 * importar/chamar uma função pura via tsx).
 *
 * Rodar: npx tsx scripts/test-koff-adaptar-sistema-menu-cliente.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildClientNavItems } from "../src/app/sidebar";
import { resolveActiveClientIdFromPathname } from "../src/lib/client-workspace-nav";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

// ---------------------------------------------------------------------------
console.log("\nA — buildClientNavItems: os 4 itens, na ordem certa, escopados ao cliente\n");
{
  const items = buildClientNavItems("client-1", "2026-11");

  ok("exatamente 4 itens — 'Contas' não é mais item de menu", items.length === 4);
  ok("ordem: Dashboard, Campanhas, Anúncios, Metas", items.map((i) => i.label).join(",") === "Dashboard,Campanhas,Anúncios,Metas");
  ok("Dashboard aponta pra raiz do workspace do cliente, preservando o mês", items[0].href === "/clients/client-1?month=2026-11");
  ok("Campanhas aponta pra /clients/client-1/campanhas", items[1].href === "/clients/client-1/campanhas?month=2026-11");
  ok("Anúncios aponta pra /clients/client-1/anuncios", items[2].href === "/clients/client-1/anuncios?month=2026-11");
  ok("Metas aponta pra /clients/client-1/metas (rota já existia)", items[3].href === "/clients/client-1/metas?month=2026-11");

  ok("Dashboard ativo só na raiz exata do cliente, nunca em sub-rotas", items[0].isActive("/clients/client-1") && !items[0].isActive("/clients/client-1/campanhas"));
  ok("Campanhas ativo em qualquer sub-rota de /campanhas", items[1].isActive("/clients/client-1/campanhas") && items[1].isActive("/clients/client-1/campanhas/x"));
  ok("Campanhas de um cliente NUNCA fica ativo na rota de outro cliente", !items[1].isActive("/clients/client-2/campanhas"));

  const noMonth = buildClientNavItems("client-1", null);
  ok("sem mês selecionado, os links não carregam ?month= nenhum (nunca um valor fabricado)", noMonth[0].href === "/clients/client-1" && noMonth[1].href === "/clients/client-1/campanhas");
}

// ---------------------------------------------------------------------------
console.log("\nB — '/clients' (destino do ClientSwitcher) devolve ao estado de Carteira sozinho (mesma fonte de verdade)\n");
{
  ok("'/clients' nunca é reconhecido como workspace de cliente — resolveActiveClientIdFromPathname some, a Carteira reaparece", resolveActiveClientIdFromPathname("/clients") === null);
  ok("dentro de um cliente, o id é reconhecido normalmente (comportamento de sempre, intocado)", resolveActiveClientIdFromPathname("/clients/client-1/campanhas") === "client-1");
}

// ---------------------------------------------------------------------------
console.log("\nC — checagem estrutural: a Sidebar troca Carteira por menu do cliente, nunca os dois ao mesmo tempo; ClientSwitcher no topo\n");
{
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");
  ok(
    "a troca é condicionada a activeClientId (nunca um estado próprio duplicado) — if/else exclusivo entre menu do cliente e Carteira",
    /activeClientId \? \(/.test(sidebarSource) && sidebarSource.includes("buildClientNavItems(activeClientId, month)"),
  );
  ok(
    "o ClientSwitcher substitui a marca no topo, nas duas apresentações (expandida e recolhida)",
    /function ClientSwitcher/.test(sidebarSource) &&
      sidebarSource.includes('<ClientSwitcher activeClient={activeClient} walletClients={walletClients} month={month} presentation="full" />') &&
      sidebarSource.includes('<ClientSwitcher activeClient={activeClient} walletClients={walletClients} month={month} presentation="compact" />'),
  );
  ok(
    "o switcher deixa trocar de cliente (link escopado por buildWorkspaceHref) e voltar à Carteira (link fixo pra /clients)",
    sidebarSource.includes('href={buildWorkspaceHref(client.id, "", month)}') && /href="\/clients"/.test(sidebarSource),
  );
  ok("'Contas' não existe mais como label de NavItem do cliente", !/label: "Contas"/.test(sidebarSource));
}

// ---------------------------------------------------------------------------
console.log("\nD — as páginas de Campanhas/Anúncios reaproveitam a MESMA Camada 1 oficial, nunca uma segunda agregação\n");
{
  const loaderSource = loadSource("src", "lib", "cockpit-exploration-page-data.ts");
  ok("reaproveita buildPerformanceReportData (Camada 1 oficial do Relatório)", loaderSource.includes("buildPerformanceReportData(supabase, clientId"));
  ok("aplica o MESMO filtro global já usado no Cockpit (nunca uma segunda lógica de filtro)", loaderSource.includes("resolveCockpitFilterState") && loaderSource.includes("filterCampaignSummaries"));

  const campanhasSource = loadSource("src", "app", "clients", "[id]", "campanhas", "page.tsx");
  const anunciosSource = loadSource("src", "app", "clients", "[id]", "anuncios", "page.tsx");
  ok("página de Campanhas abre na aba certa", campanhasSource.includes('initialLevel="campaigns"'));
  ok("página de Anúncios abre na aba certa", anunciosSource.includes('initialLevel="ads"'));
  ok(
    "as duas páginas reaproveitam o MESMO componente de exploração (nunca uma tabela nova/duplicada)",
    campanhasSource.includes("<CockpitAdExplorationSection") && anunciosSource.includes("<CockpitAdExplorationSection"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
