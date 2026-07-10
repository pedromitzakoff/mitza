/** Converte texto digitado em pt-BR ("1000", "12500,50", "12.500,50") num
 * número válido — ponto é separador de milhar, vírgula é decimal, igual ao
 * que qualquer pessoa digitaria naturalmente. Nunca retorna NaN/Infinity/
 * negativo: qualquer entrada inválida vira null pra quem chama decidir o
 * fallback. */
export function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);

  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function formatMoneyDisplay(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
