/**
 * KOFF Active Indicator — Design System oficial (Etapa "Identidade Visual
 * KOFF"). O padrão de seleção/navegação ESTRUTURAL da marca: barra
 * vertical fina (~3px) na lateral esquerda, bloco grafite sólido e texto
 * off-white quando ativo; hover sempre mais fraco que o ativo (nunca
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
 * As classes abaixo assumem a superfície FIXA da Sidebar (areia,
 * `--sidebar-surface` — não acompanha claro/escuro do resto da app, ver
 * JSDoc de `Sidebar` em `app/sidebar.tsx`). Etapa "Sidebar Areia —
 * Identidade KOFF": migrado de fundo preto pra areia — grafite deixou de
 * ser "um pouco mais claro que o preto" (`bg-white/10`) e passou a ser a
 * cor de CONTRASTE em si (bloco sólido `--sidebar-active-surface` + texto
 * `--sidebar-active-foreground`, off-white quente). Nome trocado de
 * ON_DARK pra ON_SAND porque não sobrou nenhuma superfície escura na
 * Sidebar pra justificar o nome antigo — único consumidor continua sendo
 * `app/sidebar.tsx`.
 *
 * Rail mantido (não removido automaticamente com a virada de superfície),
 * mas em contraste bem sutil (`--sidebar-active-rail`, off-white a 40% de
 * opacidade) — o bloco grafite sólido já é o sinal primário e reconhecível
 * em menos de 1 segundo; o rail só reforça a assinatura já estabelecida do
 * Active Indicator sem competir com o bloco nem parecer decoração extra.
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

export const ACTIVE_INDICATOR_ON_SAND_ACTIVE_CLASSES =
  "border-sidebar-active-rail bg-sidebar-active-surface font-semibold text-sidebar-active-foreground";

export const ACTIVE_INDICATOR_ON_SAND_INACTIVE_CLASSES =
  "border-transparent font-normal text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground";
