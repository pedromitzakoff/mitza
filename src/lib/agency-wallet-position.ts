/**
 * Posição fracionária (`clients.wallet_position`) — inserir um cliente
 * entre dois outros só reescreve a própria linha (média dos vizinhos),
 * nunca renumera a pasta inteira. `WALLET_POSITION_GAP` é o espaçamento
 * inicial (múltiplos de 1000) usado no backfill e ao inserir no fim de
 * uma pasta; `MIN_POSITION_GAP` é o limiar de segurança — abaixo dele, a
 * pasta precisa ser renumerada (nunca a cada drag, só quando o espaço
 * entre vizinhos ficar pequeno demais depois de muitas inserções no
 * mesmo intervalo).
 */
export const WALLET_POSITION_GAP = 1000;
export const MIN_POSITION_GAP = 1;

/**
 * Posição pra inserir um cliente entre `prev` (vizinho anterior, `null` =
 * inserir no topo) e `next` (vizinho posterior, `null` = inserir no fim).
 * Pasta vazia (os dois `null`) começa no primeiro múltiplo de 1000.
 */
export function computeInsertPosition(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return WALLET_POSITION_GAP;
  if (prev === null) return next! / 2;
  if (next === null) return prev + WALLET_POSITION_GAP;
  return (prev + next) / 2;
}

/** `true` quando o espaço entre os dois vizinhos ficou pequeno demais pra
 * continuar inserindo por média sem perder precisão numérica. */
export function needsNormalization(prev: number | null, next: number | null): boolean {
  if (prev === null || next === null) return false;
  return next - prev < MIN_POSITION_GAP;
}

/** Posições renumeradas (múltiplos de `WALLET_POSITION_GAP`) pra uma
 * pasta com `count` clientes, na ordem em que devem aparecer. */
export function buildNormalizedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * WALLET_POSITION_GAP);
}
