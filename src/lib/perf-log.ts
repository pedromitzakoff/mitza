/**
 * Instrumentação temporária de performance (Navigation Performance &
 * Perceived Speed 1.0) — só timestamps e logs no servidor, nunca dados
 * pessoais/tokens/cookies. Vive num módulo próprio (não um Server
 * Component) porque a regra de pureza do React Compiler bloqueia chamar
 * `performance.now()` direto dentro do corpo de uma página. Remover
 * depois de confirmado o ganho em produção.
 */
export function perfNow(): number {
  return performance.now();
}

export function perfLog(label: string, startMs: number): void {
  console.log(`[perf] ${label} — ${(perfNow() - startMs).toFixed(0)}ms`);
}
