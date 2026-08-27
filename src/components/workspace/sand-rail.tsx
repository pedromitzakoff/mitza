/**
 * Rail vertical em areia (`--sand`) — miniatura da assinatura KOFF que já
 * aparece no item ativo da Sidebar (`ACTIVE_INDICATOR_RAIL_CLASSES`,
 * `components/ui/active-indicator.ts`) e no título "Desempenho da agência"
 * (`SectionHeader`, prop `accent`). Mesma cor/token (`--sand`) e mesma
 * espessura aproximada (2-3px) — técnica diferente de propósito: aqueles
 * dois usam `border-l` (o rail ocupa a altura INTEIRA do elemento, flush na
 * borda); aqui o controle (botão/select) é mais alto que o texto dentro
 * dele, então o rail precisa ser CURTO e centralizado verticalmente, com
 * respiro das bordas — só um elemento posicionado consegue isso, um
 * `border-l` não.
 *
 * `pointer-events-none` — nunca intercepta o clique do controle por baixo.
 * Quem usa precisa de um ancestral `relative` (o próprio controle, não um
 * wrapper externo — o rail deve se mover/escalar junto com ele) e padding à
 * esquerda suficiente pro texto não sobrepor o rail (~1rem costuma bastar
 * pro respiro ficar parecido com o das outras duas aplicações).
 */
export function SandRail() {
  return <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-sand" />;
}
