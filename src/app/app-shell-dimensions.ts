/**
 * Dimensões do App Shell centralizadas aqui — nenhum outro arquivo deve
 * "chutar" um valor de altura/largura da Top Bar ou da Sidebar por conta
 * própria. Classes Tailwind precisam ser strings estáticas (o compilador
 * não resolve valor dinâmico), então centralizar é isso: um único lugar
 * pra trocar o valor e propagar pros componentes que dependem dele.
 */

/** Altura da Top Bar — usada pela própria Top Bar e por quem precisa
 * começar exatamente abaixo dela (Sidebar, ClientContextBar). */
export const TOP_BAR_HEIGHT_CLASS = "h-12";
/** Offset sticky/scroll equivalente à altura da Top Bar (mesmo valor
 * numérico de TOP_BAR_HEIGHT_CLASS — se um mudar, o outro acompanha). */
export const TOP_BAR_OFFSET_CLASS = "top-12";
export const TOP_BAR_OFFSET_REM = "3rem";

export const SIDEBAR_EXPANDED_WIDTH_CLASS = "md:w-60";
export const SIDEBAR_COLLAPSED_WIDTH_CLASS = "md:w-16";

/** Altura da sidebar no desktop: o resto do viewport, descontando a Top
 * Bar — ela tem scroll próprio (overflow-y-auto) se os itens não couberem.
 * `dvh` (não `vh`) porque `vh` inclui a área atrás de barras de
 * navegador/toolbars dinâmicas, deixando uma folga visível abaixo da
 * sidebar em algumas viewports. */
export const SIDEBAR_HEIGHT_CLASS = `md:h-[calc(100dvh-${TOP_BAR_OFFSET_REM})]`;

/** Altura mínima do corpo (Sidebar + MainArea) — garante que a linha nunca
 * fique mais baixa que a viewport real em páginas com conteúdo curto
 * (evita uma faixa de fundo diferente aparecendo abaixo da sidebar). */
export const BODY_MIN_HEIGHT_CLASS = `md:min-h-[calc(100dvh-${TOP_BAR_OFFSET_REM})]`;
