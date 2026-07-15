/**
 * Dimensões do App Shell centralizadas aqui — nenhum outro arquivo deve
 * "chutar" um valor de altura/largura da Sidebar por conta própria. Classes
 * Tailwind precisam ser strings estáticas (o compilador não resolve valor
 * dinâmico), então centralizar é isso: um único lugar pra trocar o valor e
 * propagar pros componentes que dependem dele.
 *
 * Etapa Global UX Refinement 1.0: a Top Bar global foi removida (Decisão
 * 012 — "A Sidebar é o único elemento estrutural fixo"). Não existe mais
 * altura de Top Bar a descontar de nada — a Sidebar ocupa a viewport
 * inteira, em qualquer breakpoint.
 */

export const SIDEBAR_EXPANDED_WIDTH_CLASS = "md:w-60";
export const SIDEBAR_COLLAPSED_WIDTH_CLASS = "md:w-16";

/** Altura da sidebar (mobile e desktop): a viewport inteira — ela tem
 * scroll próprio (overflow-y-auto) na região de navegação se os itens não
 * couberem. `dvh` (não `vh`) porque `vh` inclui a área atrás de barras de
 * navegador/toolbars dinâmicas, deixando uma folga visível abaixo da
 * sidebar em algumas viewports (bug já corrigido na Etapa 25; continua
 * valendo agora que não há mais Top Bar). */
export const SIDEBAR_HEIGHT_CLASS = "h-dvh";
