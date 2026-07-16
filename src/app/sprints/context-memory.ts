/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/12/13), expandida
 * pela etapa "MITZA Interaction Engine v1" (Parte 3 — "Context Memory 2.0")
 * — memória de contexto da tela Sprints. Mês, visão e filtros já são
 * preservados pela URL (nada a fazer ali); o que falta é o que a URL não
 * guarda hoje: quais clientes/sprints/comentários estavam expandidos e a
 * posição de scroll. Guardado em `sessionStorage` (estado temporário de
 * navegação, nunca dado de negócio).
 *
 * Context Memory 2.0: a v1 lembrava só o ÚLTIMO cliente/sprint expandido.
 * Esta versão lembra TODOS os que estavam abertos (conjuntos, não um único
 * id) — o gestor pode ter 3 clientes e 2 sprints abertos ao mesmo tempo, e
 * ao voltar todos devem reaparecer, não só o último. Mudança de formato
 * (de id único pra lista) => versão bump (`v: 2`): um valor salvo no
 * formato antigo nunca é lido por engano como se fosse o novo formato.
 *
 * Funções puras (sem `window`/`sessionStorage` aqui dentro dos helpers de
 * chave) pra serem testáveis sem precisar de DOM.
 */

export const SPRINTS_CONTEXT_STORAGE_KEY = "mitza:sprints-context";
export const SPRINTS_CONTEXT_VERSION = 2;

export interface SprintsContextKeyParams {
  view: string;
  grouping?: string;
  month?: string;
  manager?: string;
  health?: string;
  ritmo?: string;
  tasks?: string;
  optimization?: string;
  activity?: string;
  display?: string;
  client?: string;
}

export interface SprintsContextState {
  v: number;
  contextKey: string;
  expandedClientIds: string[];
  expandedSprintIds: string[];
  expandedCommentIds: string[];
  scrollY: number;
}

/**
 * Uma única string determinística a partir de tudo que já é filtro
 * explícito na URL — dois contextos só "combinam" (Parte 8: "considerar
 * rota, mês, visão, filtros") se cada um desses campos for idêntico. Trocar
 * qualquer filtro já produz uma chave diferente, o que invalida sozinho
 * scroll/expansão salvos de outro contexto (Parte 12: "contexto antigo
 * nunca deve sobrescrever uma escolha nova") sem precisar de lógica de
 * invalidação separada por campo.
 */
export function buildSprintsContextKey(params: SprintsContextKeyParams): string {
  return [
    params.view,
    params.grouping ?? "",
    params.month ?? "",
    params.manager ?? "",
    params.health ?? "",
    params.ritmo ?? "",
    params.tasks ?? "",
    params.optimization ?? "",
    params.activity ?? "",
    params.display ?? "",
    params.client ?? "",
  ].join("|");
}

export function loadSprintsContext(contextKey: string): SprintsContextState | null {
  try {
    const raw = sessionStorage.getItem(SPRINTS_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SprintsContextState>;
    if (parsed.v !== SPRINTS_CONTEXT_VERSION) return null;
    if (parsed.contextKey !== contextKey) return null;
    return {
      v: parsed.v,
      contextKey: parsed.contextKey,
      expandedClientIds: Array.isArray(parsed.expandedClientIds) ? parsed.expandedClientIds : [],
      expandedSprintIds: Array.isArray(parsed.expandedSprintIds) ? parsed.expandedSprintIds : [],
      expandedCommentIds: Array.isArray(parsed.expandedCommentIds) ? parsed.expandedCommentIds : [],
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
    };
  } catch {
    return null;
  }
}

export function saveSprintsContext(contextKey: string, patch: Partial<Omit<SprintsContextState, "v" | "contextKey">>) {
  try {
    const current = loadSprintsContext(contextKey);
    const next: SprintsContextState = {
      v: SPRINTS_CONTEXT_VERSION,
      contextKey,
      expandedClientIds: current?.expandedClientIds ?? [],
      expandedSprintIds: current?.expandedSprintIds ?? [],
      expandedCommentIds: current?.expandedCommentIds ?? [],
      scrollY: current?.scrollY ?? 0,
      ...patch,
    };
    sessionStorage.setItem(SPRINTS_CONTEXT_STORAGE_KEY, JSON.stringify(next));
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
