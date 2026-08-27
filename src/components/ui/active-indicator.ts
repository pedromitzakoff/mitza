/**
 * KOFF Active Indicator — Design System oficial (Etapa "Identidade Visual
 * KOFF"). O padrão de seleção/navegação ESTRUTURAL da marca: barra
 * vertical fina (~3px) na lateral esquerda, fundo ligeiramente mais claro
 * que a superfície e texto off-white forte quando ativo; hover sempre mais
 * fraco que o ativo (nunca confundido com ele), disabled sempre
 * claramente diferente de ambos. Nasceu como a solução do item ativo da
 * Sidebar (Visão Geral/Operação/Timeline/Conquistas) e é formalizado aqui
 * pra virar uma linguagem repetível, em vez de um efeito que cada tela
 * nova reinventa com valores levemente diferentes.
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
 * (`globals.css`) — nunca um valor solto. Nome trocado de ON_DARK (v1,
 * preto) pra ON_SAND (v2, areia) pra ON_SIDEBAR (v3, grafite quente com
 * areia só de assinatura): a cor de fundo real da Sidebar já mudou duas
 * vezes desde que este arquivo nasceu, e um nome amarrado à cor do momento
 * vira resíduo a cada iteração. `ACTIVE_INDICATOR_SIDEBAR_*` sempre vai
 * estar certo porque descreve ONDE é usado (a Sidebar), não a cor de fundo
 * dela — se essa cor mudar nas próximas etapas, só o valor dos tokens em
 * `globals.css` precisa mudar, nunca este arquivo.
 *
 * Etapa "Sidebar Grafite Quente — v2": o bloco sólido do ativo (v2 da
 * areia, `bg-sidebar-active-surface` = grafite 100%) virou "grafite sobre
 * grafite" com a nova superfície — passa a ser um overlay off-white bem
 * sutil (`--sidebar-active-surface`, ~9%) em vez de um bloco opaco. O rail
 * (`--sidebar-active-rail`) passa a ser literalmente `--sand` — a
 * assinatura da marca concentrada no elemento mais "editorial" da
 * Sidebar, único lugar onde a cor cheia aparece.
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
