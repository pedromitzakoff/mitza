/** Validação básica de formato de e-mail (não confirma entrega, só formato:
 * algo@algo.algo) — usada onde o e-mail é opcional, então string vazia não
 * passa por aqui. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
