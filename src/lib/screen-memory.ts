/**
 * Etapa "MITZA Interaction Engine v1.5" — generalizado a partir de
 * `src/app/sprints/context-memory.ts` (que só sabia lidar com o formato
 * específico da tela Sprints: clientes/sprints/comentários expandidos).
 * Qualquer tela futura que precise lembrar "o que estava expandido" e "por
 * onde a página estava rolada" entre navegações usa este módulo — a tela
 * Sprints virou só a primeira instância dele, não o dono da lógica.
 *
 * Funções puras (sem `window`/`sessionStorage` nos helpers de chave) pra
 * serem testáveis sem precisar de DOM.
 */

export interface ScreenMemoryState {
  v: number;
  contextKey: string;
  /** Um conjunto de ids por categoria (prefixo de `id` do `<details>`) —
   * ex.: `{ "client-": ["a", "c"], "sprint-": ["s1"] }`. Cada categoria é
   * independente: uma tela pode ter quantas quiser. */
  expanded: Record<string, string[]>;
  scrollY: number;
}

/**
 * Uma única string determinística a partir de tudo que já é filtro
 * explícito na URL da tela — dois contextos só "combinam" se cada parte for
 * idêntica. Trocar qualquer filtro já produz uma chave diferente, o que
 * invalida sozinho scroll/expansão salvos de outro contexto (nunca um
 * contexto antigo sobrescrevendo uma escolha nova) sem precisar de lógica
 * de invalidação separada por campo. A ordem das partes é decidida por quem
 * chama — precisa ser sempre a mesma ordem entre save/load do mesmo uso.
 */
export function buildContextKey(...parts: (string | undefined)[]): string {
  return parts.map((part) => part ?? "").join("|");
}

export function loadScreenMemory(storageKey: string, version: number, contextKey: string): ScreenMemoryState | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScreenMemoryState>;
    if (parsed.v !== version) return null;
    if (parsed.contextKey !== contextKey) return null;
    return {
      v: parsed.v,
      contextKey: parsed.contextKey,
      expanded: parsed.expanded && typeof parsed.expanded === "object" ? parsed.expanded : {},
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
    };
  } catch {
    return null;
  }
}

export function saveScreenMemory(
  storageKey: string,
  version: number,
  contextKey: string,
  patch: Partial<Omit<ScreenMemoryState, "v" | "contextKey">>,
) {
  try {
    const current = loadScreenMemory(storageKey, version, contextKey);
    const next: ScreenMemoryState = {
      v: version,
      contextKey,
      expanded: current?.expanded ?? {},
      scrollY: current?.scrollY ?? 0,
      ...patch,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // sessionStorage indisponível (modo privado etc.) — sem memória de
    // contexto, sem quebrar a navegação.
  }
}

/** Adiciona `id` ao conjunto (sem duplicar) — usado quando um `<details>` abre. */
export function addToSet(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** Remove `id` do conjunto — usado quando um `<details>` fecha. */
export function removeFromSet(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : ids;
}
