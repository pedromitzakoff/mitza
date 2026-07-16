import { buildContextKey } from "@/lib/screen-memory";

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/12/13), expandida
 * pela etapa "MITZA Interaction Engine v1" (Parte 3 — "Context Memory 2.0")
 * e consolidada pela "MITZA Interaction Engine v1.5" sobre a infraestrutura
 * genérica de `@/lib/screen-memory` — este arquivo agora só descreve o que
 * é ESPECÍFICO da tela Sprints: quais parâmetros formam o contexto (mês,
 * visão, filtros) e em que ordem. Mês/visão/filtros já são preservados pela
 * URL; o que falta é o que a URL não guarda hoje (clientes/sprints/
 * comentários expandidos e a posição de scroll) — isso é tratado por
 * `useScreenMemory` (`@/lib/screen-memory-client`, ver `context-memory-client.tsx`).
 */
export const SPRINTS_CONTEXT_STORAGE_KEY = "mitza:sprints-context";
/** v3: o formato interno mudou de campos fixos (`expandedClientIds`/
 * `expandedSprintIds`/`expandedCommentIds`) pra um dicionário genérico
 * (`expanded: Record<prefixo, ids[]>`, ver `@/lib/screen-memory`) — mesmo
 * dado, forma diferente. Sem o bump, uma entrada `v: 2` salva no formato
 * antigo seria lida como se já estivesse no formato novo (silenciosamente
 * "vazia", já que `expanded` não existiria nela). */
export const SPRINTS_CONTEXT_VERSION = 3;

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

export function buildSprintsContextKey(params: SprintsContextKeyParams): string {
  return buildContextKey(
    params.view,
    params.grouping,
    params.month,
    params.manager,
    params.health,
    params.ritmo,
    params.tasks,
    params.optimization,
    params.activity,
    params.display,
    params.client,
  );
}
