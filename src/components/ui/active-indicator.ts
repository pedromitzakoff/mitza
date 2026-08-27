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
 * (`globals.css`) — nunca um valor solto. O fundo real da Sidebar já
 * mudou várias vezes (preto → areia clara → grafite quente → taupe médio →
 * off-white, esta rodada) e um nome amarrado à cor do momento vira resíduo
 * a cada iteração — por isso `ACTIVE_INDICATOR_SIDEBAR_*` descreve ONDE é
 * usado (a Sidebar), não a cor de fundo dela. Se essa cor mudar de novo, só
 * o valor dos tokens em `globals.css` precisa mudar, nunca este arquivo —
 * e de fato não mudou nesta rodada: `bg-sidebar-active-surface` continua o
 * mesmo bloco grafite 100% sólido de sempre.
 *
 * Etapa "Sidebar Off-White + Grafite + Areia Assinatura": a Sidebar deixa
 * de tentar carregar identidade através da SUPERFÍCIE (as 3 rodadas
 * anteriores tentaram areia clara, grafite quente e taupe médio — a
 * primeira ficou lavada, a segunda genérica, a terceira virou uma massa de
 * cor grande demais) e passa a ser off-white, quase a mesma família clara
 * do conteúdo principal. Isso torna o item ativo AINDA mais evidente (bloco
 * grafite sólido sobre uma superfície agora bem mais clara — a maior
 * diferença de contraste que este componente já teve). O rail
 * (`--sidebar-active-rail`, `--sand`) sempre foi um tom intermediário entre
 * grafite e off-white — antes ficava mais claro que a superfície escura ao
 * redor, agora fica mais escuro que a superfície clara ao redor; nos dois
 * casos ele lê como um terceiro acento distinto, nem a cor do bloco nem a
 * da superfície.
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
