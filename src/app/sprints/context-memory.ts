/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/12/13) — memória
 * de contexto da tela Sprints. Mês, visão e filtros já são preservados pela
 * URL (nada a fazer ali — ver auditoria do relatório desta etapa); o que
 * falta é o que a URL não guarda hoje: qual cliente/sprint estava
 * expandido e a posição de scroll. Guardado em `sessionStorage` (estado
 * temporário de navegação, nunca dado de negócio — Parte 7 do pedido:
 * "não persistir no banco").
 *
 * Funções puras (sem `window`/`sessionStorage` aqui dentro dos helpers de
 * chave) pra serem testáveis sem precisar de DOM.
 */

export const SPRINTS_CONTEXT_STORAGE_KEY = "mitza:sprints-context";
export const SPRINTS_CONTEXT_VERSION = 1;

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
  expandedClientId: string | null;
  expandedSprintId: string | null;
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
      expandedClientId: parsed.expandedClientId ?? null,
      expandedSprintId: parsed.expandedSprintId ?? null,
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
      expandedClientId: current?.expandedClientId ?? null,
      expandedSprintId: current?.expandedSprintId ?? null,
      scrollY: current?.scrollY ?? 0,
      ...patch,
    };
    sessionStorage.setItem(SPRINTS_CONTEXT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage indisponível (modo privado etc.) — sem memória de
    // contexto, sem quebrar a navegação.
  }
}
