"use client";

import { useScreenMemory } from "@/lib/screen-memory-client";
import {
  buildSprintsContextKey,
  SPRINTS_CONTEXT_STORAGE_KEY,
  SPRINTS_CONTEXT_VERSION,
  type SprintsContextKeyParams,
} from "./context-memory";

/** Categorias de `<details id="{prefix}{id}">` que a tela Sprints lembra —
 * constante de módulo (referência estável entre renders, ver doc de
 * `useScreenMemory`). */
const SPRINTS_MEMORY_PREFIXES = ["client-", "sprint-", "comments-"];

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/13), expandida
 * pela "MITZA Interaction Engine v1" (Parte 3 — Context Memory 2.0) e
 * consolidada pela "MITZA Interaction Engine v1.5": esta função virou uma
 * instância fina de `useScreenMemory` (`@/lib/screen-memory-client`) — a
 * mecânica de restaurar/observar expansões e scroll não vive mais aqui,
 * só a configuração específica da tela Sprints (chave de armazenamento,
 * versão, categorias `client-`/`sprint-`/`comments-`). Montado uma vez em
 * `/sprints`; não renderiza nada.
 */
export function SprintsContextMemory(params: SprintsContextKeyParams) {
  const contextKey = buildSprintsContextKey(params);

  useScreenMemory({
    storageKey: SPRINTS_CONTEXT_STORAGE_KEY,
    version: SPRINTS_CONTEXT_VERSION,
    contextKey,
    prefixes: SPRINTS_MEMORY_PREFIXES,
  });

  return null;
}
