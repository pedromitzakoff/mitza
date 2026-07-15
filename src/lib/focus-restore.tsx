/**
 * Devolve o foco pro elemento que abriu um drawer (Interaction Delight 1.0)
 * — mesmo espírito de `scroll-restore.tsx`: um valor de módulo (não React
 * state) guarda a referência entre o clique que abre e o fechamento,
 * porque quem abre e quem fecha o drawer normalmente são componentes
 * diferentes, sem uma forma direta de passar isso via prop sem acoplar os
 * dois. Só funciona porque abrir/fechar um drawer nunca é um reload de
 * página de verdade (é sempre navegação client-side ou troca de estado
 * local) — a referência ao elemento DOM continua válida o tempo todo.
 *
 * Piloto desta etapa: usado só no drawer de tarefa (`task-drawer-panel.tsx`,
 * via este módulo) e no editor de orçamento mensal (que é estado local
 * puro, resolvido com um ref próprio, sem precisar deste módulo). Os
 * demais drawers ganharam autofoco na abertura, mas não devolução de foco
 * no fechamento — ver Interaction Audit do relatório desta etapa.
 */
let pendingFocusTarget: HTMLElement | null = null;

export function saveFocusForReturn(element: HTMLElement | null) {
  pendingFocusTarget = element;
}

export function restoreFocusForReturn() {
  const target = pendingFocusTarget;
  pendingFocusTarget = null;
  if (target && document.contains(target)) {
    target.focus();
  }
}
