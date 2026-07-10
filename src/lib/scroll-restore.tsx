"use client";

import { useLayoutEffect } from "react";

/**
 * Preserva o scroll no fluxo "Editar tarefa": esse é o único caso que ainda
 * precisa de uma navegação de verdade (a edição vive numa página própria),
 * então não dá pra evitar o "ida e volta" — mas dá pra restaurar o scroll
 * ANTES do primeiro paint da página de volta (useLayoutEffect), o que evita
 * o "pulo visível" que uma correção pós-jump (setTimeout + scrollTo) teria.
 * Guarda a URL de destino junto com a posição, e só restaura se a página
 * atual bater com ela — evita restaurar scroll errado se o usuário abrir a
 * página de edição direto, numa aba nova, ou navegar por outro caminho.
 */
const STORAGE_KEY = "mitza:scroll-restore";

export function saveScrollForReturn(returnTo: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ url: returnTo, y: window.scrollY }));
  } catch {
    // sessionStorage indisponível (modo privado etc.) — sem restauração, sem quebrar nada.
  }
}

export function ScrollRestoreOnMount() {
  useLayoutEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const { url, y } = JSON.parse(raw) as { url: string; y: number };
      const current = `${window.location.pathname}${window.location.search}`;
      if (url === current) {
        window.scrollTo(0, y);
      }
    } catch {
      // valor inesperado no storage — ignora silenciosamente.
    }
  }, []);

  return null;
}
