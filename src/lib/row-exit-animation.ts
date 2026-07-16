"use client";

import { useState } from "react";

/** Duração padrão da animação de saída — mesma de `--motion-standard`
 * (globals.css) e da classe `.mitza-row-exit`/`.mitza-row-exit-active`.
 * Quem chama pode passar outra duração desde que ajuste a classe CSS
 * correspondente também. */
export const DEFAULT_EXIT_DURATION_MS = 220;

/**
 * Etapa "MITZA Interaction Engine v1.5" — extraído de `task-row.tsx`
 * (excluir tarefa: linha encolhe/esmaece antes de sumir da lista, nunca
 * instantaneamente). Generaliza a mecânica de "toca a animação de saída,
 * espera ela terminar, só então executa a remoção de fato (otimista ou
 * não)" pra qualquer lista futura da plataforma que precise do mesmo
 * microinteração (Parte 6 do "MITZA Interaction Engine v1": "nunca
 * desaparecer instantaneamente").
 *
 * Uso típico: aplicar `isLeaving ? "mitza-row-exit-active" : ""` junto de
 * `mitza-row-exit` (sempre presente) no elemento que deve encolher, e
 * chamar `exitThenRun` no clique de confirmação — a remoção real (dispatch
 * otimista + Server Action) só roda depois da transição CSS terminar.
 */
export function useRowExitAnimation(durationMs: number = DEFAULT_EXIT_DURATION_MS) {
  const [isLeaving, setIsLeaving] = useState(false);

  function startExit() {
    setIsLeaving(true);
  }

  function cancelExit() {
    setIsLeaving(false);
  }

  async function waitForExit() {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  return { isLeaving, startExit, cancelExit, waitForExit };
}
