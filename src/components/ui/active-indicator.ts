/**
 * KOFF Active Indicator — Design System oficial (Etapa "Identidade Visual
 * KOFF"). O padrão de seleção/navegação ESTRUTURAL da marca: barra
 * vertical fina (~3px) na lateral esquerda, bloco grafite sólido e texto
 * off-white forte quando ativo; hover sempre mais fraco que o ativo (nunca
 * confundido com ele), disabled sempre claramente diferente de ambos.
 * Nasceu como a solução do item ativo da Sidebar (Visão Geral/Operação/
 * Timeline/Conquistas) e é formalizado aqui pra virar uma linguagem
 * repetível, em vez de um efeito que cada tela nova reinventa com valores
 * levemente diferentes.
 *
 * Reservado pra seleção/navegação ESTRUTURAL (aba ativa, item de menu
 * selecionado, eventualmente um card/painel em estado ativo) — nunca em
 * botões, KPIs, alertas/status, inputs, progress bars ou qualquer
 * elemento decorativo: é a assinatura visual mais sutil da marca (a
 * "Marca KOFF é expressiva, Produto KOFF é silencioso"), perde força se
 * vazar pra todo lugar. Usar com parcimônia.
 *
 * As classes abaixo assumem a superfície FIXA da Sidebar (ver JSDoc de
 * `Sidebar` em `app/sidebar.tsx`) e consomem só os tokens `--sidebar-*`
 * (`globals.css`) — nunca um valor solto. Nome ON_DARK (v1, preto) → ON_SAND
 * (v2, areia) → ON_SIDEBAR (v3, grafite quente) → `ACTIVE_INDICATOR_SIDEBAR_*`
 * (v4, areia de novo, agora com texto off-white): a cor de fundo real da
 * Sidebar já mudou três vezes desde que este arquivo nasceu, e um nome
 * amarrado à cor do momento vira resíduo a cada iteração — por isso o nome
 * final descreve ONDE é usado (a Sidebar), não a cor de fundo dela. Se essa
 * cor mudar de novo, só o valor dos tokens em `globals.css` precisa mudar,
 * nunca este arquivo.
 *
 * Etapa "Sidebar Areia + Ativo Grafite — v4": terceira tentativa de
 * equilíbrio pra esta mesma Sidebar. v1 era areia com texto grafite (pouco
 * contraste); v2 inverteu pra fundo grafite com areia só de assinatura
 * (perdeu personalidade); v4 volta a areia como superfície, mas com
 * texto/ícone off-white (nunca mais grafite sobre areia) e reserva o
 * grafite pro bloco do item ativo — `bg-sidebar-active-surface` volta a
 * ser um bloco 100% sólido (não mais um overlay translúcido, que só fazia
 * sentido quando a própria superfície já era grafite). O rail
 * (`--sidebar-active-rail`) continua `--sand`, só que agora é um tom mais
 * CLARO que a superfície ao redor (antes era o oposto) — o mesmo papel de
 * sempre (assinatura no elemento mais "editorial" da Sidebar), só invertido
 * em relação a quem é mais claro que quem.
 *
 * Cada consumidor combina estas classes com seu próprio layout (flex,
 * padding, tamanho de fonte, ícone) — isto aqui é só o miolo do estado,
 * nunca um componente de item de navegação pronto. Mesmo padrão de
 * fragmento de classe reutilizável já usado em `status-registry.ts`
 * (`SUCCESS`/`WARNING`/...) e `settings-shell.tsx`
 * (`SETTINGS_SECONDARY_BUTTON_CLASSES`) — string exportada, não
 * abstração de componente.
 */
export const ACTIVE_INDICATOR_RAIL_CLASSES = "border-l-[3px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)]";

export const ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES =
  "border-sidebar-active-rail bg-sidebar-active-surface font-semibold text-sidebar-active-foreground";

export const ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES =
  "border-transparent font-normal text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground";
