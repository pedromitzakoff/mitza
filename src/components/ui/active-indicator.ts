/**
 * KOFF Active Indicator — Design System oficial (Etapa "Identidade Visual
 * KOFF"). O padrão de seleção/navegação ESTRUTURAL da marca: barra
 * vertical fina (~3px) no token `--sand` na lateral esquerda, fundo
 * grafite sutil e texto branco forte quando ativo; hover sempre mais
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
 * As classes abaixo assumem uma superfície escura FIXA (ex.: a Sidebar,
 * `bg-black`, que não acompanha claro/escuro do resto da app) — "fundo
 * grafite sutil" aqui é literalmente "um pouco mais claro que o preto"
 * (`bg-white/10`). Uma futura aplicação sobre superfície clara (a maioria
 * do produto) precisaria da lógica inversa (um pouco mais ESCURO que o
 * branco) — valores próprios, ainda sem uma segunda aplicação real que
 * justifique generalizar agora (ver relatório da Etapa "KOFF Sidebar
 * Polish" pros candidatos cogitados).
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

export const ACTIVE_INDICATOR_ON_DARK_ACTIVE_CLASSES = "border-sand bg-white/10 font-semibold text-white";

export const ACTIVE_INDICATOR_ON_DARK_INACTIVE_CLASSES =
  "border-transparent font-medium text-zinc-300 hover:bg-white/5 hover:text-zinc-100";
