/**
 * Testes da Etapa "Otimização do menu lateral mobile" (pedido explícito do
 * usuário) — checagens ESTRUTURAIS via grep de código-fonte (mesmo padrão
 * das suites anteriores, sem DOM/navegador real neste ambiente).
 *
 * Cobre os 5 pontos do pedido:
 *  A. Topo: seletor de cliente em destaque + botão X (fecha só no mobile,
 *     mesma onClose do toque fora).
 *  B. Gestão: reposicionada pra logo abaixo do seletor, recolhível, itens
 *     logo abaixo do título ao expandir, "Atualizar Meta (todos)" dentro
 *     dela, mesma permissão de admin.
 *  C. Navegação: Dashboard/Campanhas/Anúncios/Metas somem do drawer
 *     mobile (já cobertos pela MobileTabBar), continuam no desktop.
 *  D. Rodapé: perfil/função/Sair continuam; relógio sai do mobile.
 *  E. Telas pequenas: a região rola no mobile; rodapé nunca é empurrado
 *     pra fora por causa de espaçamento fantasma de um filho escondido.
 *
 * Rodar: npx tsx scripts/test-koff-otimizacao-menu-mobile.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// ---------------------------------------------------------------------------
console.log("\nA — Topo: seletor de cliente em destaque + botão X (só mobile, mesma ação do toque fora)\n");
{
  ok("Sidebar importa o ícone X (lucide-react)", /import\s*\{[^}]*\bX\b[^}]*\}\s*from\s*"lucide-react"/.test(sidebarSource));
  ok(
    "ClientSwitcher continua renderizado sem alteração interna (mesmo componente, só embrulhado numa linha com o X)",
    sidebarSource.includes('<ClientSwitcher activeClient={activeClient} walletClients={walletClients} month={month} presentation="full" />'),
  );
  ok(
    "o botão X chama a MESMA onClose do backdrop (nunca uma segunda função de fechar)",
    sidebarSource.includes('onClick={onClose}\n              aria-label="Fechar menu"') || (sidebarSource.includes("onClick={onClose}") && sidebarSource.includes('aria-label="Fechar menu"')),
  );
  ok("o botão X só existe no mobile (md:hidden) — desktop não ganha um botão de fechar novo", /aria-label="Fechar menu"[\s\S]{0,200}md:hidden/.test(sidebarSource));
  ok(
    "SidebarContent recebe onClose como prop nova, passada nos dois pontos de render (fallback do Suspense e SidebarMonthParam)",
    (sidebarSource.match(/onClose=\{onClose\}/g) ?? []).length === 2,
  );
  ok(
    "o toque fora do painel continua fechando (backdrop pré-existente, nunca removido/alterado)",
    sidebarSource.includes('aria-label="Fechar menu"\n          onClick={onClose}\n          className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30 md:hidden"'),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — Gestão: logo abaixo do seletor, recolhível, itens embaixo do título, Atualizar Meta dentro dela, mesma permissão\n");
{
  const mobileBlockMatch = sidebarSource.match(/groupId="gestao-mobile"[\s\S]*?<\/AccordionGroup>/);
  ok("existe uma instância dedicada de Gestão pro mobile (groupId='gestao-mobile', nunca reaproveitando o mesmo id do bloco desktop)", !!mobileBlockMatch);
  const mobileBlock = mobileBlockMatch?.[0] ?? "";

  ok("o bloco mobile de Gestão usa o MESMO estado de abrir/fechar do bloco desktop (openGroups.gestao) — nunca um segundo estado divergente", mobileBlock.includes("open={openGroups.gestao}"));
  ok("o bloco mobile de Gestão usa os MESMOS itens/permissões (gestaoItems, já filtrado por isAdmin em Configurações)", mobileBlock.includes("items={gestaoItems}"));
  ok("'Atualizar Meta (todos)' entra como children do AccordionGroup — aparece DENTRO do painel revelado, junto dos outros itens", mobileBlock.includes("{isAdmin && (") && mobileBlock.includes("Atualizar Meta (todos)"));
  ok("continua a MESMA Server Action (syncAllMetaAction) — nenhuma ação nova criada", mobileBlock.includes("action={syncAllMetaAction}"));
  ok("continua gated por isAdmin — mesma permissão de sempre, nunca liberado pra gestor", mobileBlock.includes("{isAdmin && ("));

  ok(
    "AccordionGroup aceita children e os renderiza DEPOIS dos itens mapeados, dentro do mesmo <nav> revelado ao expandir (nunca um painel paralelo)",
    /\{items\.map\(\(item\) => \([\s\S]*?\)\)\}\s*\{children\}\s*<\/nav>/.test(sidebarSource),
  );

  ok(
    "o bloco mobile de Gestão fica DEPOIS do seletor de cliente e ANTES do nav 'Menu do cliente' (ordem: seletor -> Gestão -> nav oculto no mobile)",
    (() => {
      const switcherIdx = sidebarSource.indexOf('presentation="full" />');
      const mobileGestaoIdx = sidebarSource.indexOf('groupId="gestao-mobile"');
      const clientNavIdx = sidebarSource.indexOf('aria-label="Menu do cliente"');
      return switcherIdx > -1 && mobileGestaoIdx > switcherIdx && clientNavIdx > mobileGestaoIdx;
    })(),
  );

  ok("o bloco mobile de Gestão só existe no mobile (md:hidden) — no desktop Gestão continua só no lugar de sempre", /groupId="gestao-mobile"/.test(sidebarSource) && sidebarSource.includes('<div className="shrink-0 pb-2 md:hidden">'));
  ok(
    "o bloco DESKTOP de Gestão (de sempre) passou a esconder no mobile (hidden, só md:block quando não collapsed) — nunca duplicado visualmente",
    sidebarSource.includes('mt-2 hidden shrink-0 space-y-1.5 px-2.5 pb-2 ${collapsed ? "" : "md:block"}'),
  );
  ok(
    "'Atualizar Meta (todos)' saiu do rodapé no mobile (o <form> de sempre ganhou hidden md:block) — continua existindo tal e qual no desktop",
    sidebarSource.includes('<form action={syncAllMetaAction} className="hidden md:block">'),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — Navegação: Dashboard/Campanhas/Anúncios/Metas somem do drawer mobile (já cobertos pela barra inferior), continuam no desktop\n");
{
  ok(
    "o nav 'Menu do cliente' (Dashboard/Campanhas/Anúncios/Metas) ficou hidden no mobile e só aparece a partir de md (flex)",
    sidebarSource.includes('<nav aria-label="Menu do cliente" className="hidden flex-col gap-0.5 md:flex">'),
  );
  ok("buildClientNavItems continua a MESMA fonte única usada pela MobileTabBar (nenhuma lista nova/divergente)", sidebarSource.includes("export function buildClientNavItems(clientId: string, month: string | null): NavItem[]"));
  const mobileTabBarSource = loadSource("src", "app", "clients", "mobile-tab-bar.tsx");
  ok("MobileTabBar (barra inferior) continua consumindo buildClientNavItems — mesma fonte, cobertura preservada", mobileTabBarSource.includes("buildClientNavItems(clientId, month)"));
}

// ---------------------------------------------------------------------------
console.log("\nD — Rodapé: perfil/função/Sair continuam; data e hora saem do mobile\n");
{
  ok("o relógio (SidebarClock) ganhou um wrapper hidden md:block — só aparece no desktop agora", sidebarSource.includes('<div className="hidden md:block">\n          <SidebarClock collapsed={collapsed} />\n        </div>'));
  ok("perfil (nome + função) continua sem nenhum wrapper de esconder — visível em qualquer largura", /profile\.name\}\{" "\}\s*<span className="font-normal text-sidebar-foreground-muted">/.test(sidebarSource));
  ok("botão Sair (logout) continua sem nenhum wrapper de esconder — acessível em qualquer largura", /<form action=\{logout\}>\s*<Tooltip label="Sair">/.test(sidebarSource));
}

// ---------------------------------------------------------------------------
console.log("\nE — Telas pequenas: scroll interno quando Gestão expande; rodapé nunca fica inacessível\n");
{
  ok(
    "a região do meio (seletor + Gestão mobile + nav) ganhou overflow-y-auto — rola internamente quando o conteúdo (Gestão expandida) excede a altura",
    sidebarSource.includes("flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 md:overflow-visible"),
  );
  ok(
    "no desktop o overflow continua visible (md:overflow-visible) — nenhuma mudança de comportamento lá, só o mobile ganhou scroll",
    sidebarSource.includes("md:overflow-visible"),
  );
  ok(
    "o rodapé é shrink-0 (nunca é comprimido pela região rolável) — continua sempre com altura própria, nunca cortado",
    sidebarSource.includes('<div className="flex shrink-0 flex-col gap-1.5 border-t border-sidebar-border p-2.5">'),
  );
  ok(
    "o rodapé trocou space-y-1.5 por flex flex-col gap-1.5 — gap nunca reserva espaço fantasma pra um filho `hidden` (display:none), ao contrário de space-y (que aplicaria margem mesmo assim)",
    sidebarSource.includes("flex shrink-0 flex-col gap-1.5 border-t"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
