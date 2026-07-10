/** Só dígitos, no máximo 14 — é o formato armazenado no banco. Aceita colar
 * com ou sem pontuação: sempre extrai só os números. */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 14);
}

/** "00.000.000/0000-00" — formata progressivamente, então também serve de
 * máscara durante a digitação (com um CNPJ parcial, só aplica os
 * separadores que já cabem). */
export function formatCnpj(raw: string): string {
  const d = normalizeCnpj(raw);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

/** CNPJ é opcional: vazio é válido. Quando preenchido, exige os 14 dígitos
 * (sem validar dígito verificador — não foi pedido). */
export function isValidCnpjLength(raw: string): boolean {
  const d = normalizeCnpj(raw);
  return d.length === 0 || d.length === 14;
}
