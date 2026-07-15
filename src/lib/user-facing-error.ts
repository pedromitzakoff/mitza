/**
 * Camada de tradução de erros — User Feedback Resolution 1.0 (Bug 2):
 * nunca deixa uma mensagem técnica (nome de variável de ambiente, erro
 * cru do Supabase/Meta, id interno) chegar até a tela do gestor. O erro
 * real continua registrado no log do servidor (console.error) — só a
 * mensagem amigável é devolvida pra UI.
 */
export function toUserFacingError(error: unknown, userMessage: string): string {
  console.error(`[erro interno] ${userMessage}`, error);
  return userMessage;
}
