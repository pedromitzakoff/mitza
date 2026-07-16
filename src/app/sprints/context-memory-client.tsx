"use client";

import { useEffect, useRef } from "react";
import {
  buildSprintsContextKey,
  loadSprintsContext,
  saveSprintsContext,
  type SprintsContextKeyParams,
} from "./context-memory";

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/13) — montado uma
 * vez na página `/sprints`. Não renderiza nada: só (1) restaura, uma única
 * vez por montagem, o último cliente/sprint expandido e a posição de
 * scroll salvos pra este MESMO contexto (mês/visão/filtros — ver
 * `buildSprintsContextKey`), e (2) fica ouvindo togglings de `<details
 * id="client-*"|"sprint-*">` e o scroll da página pra manter essa memória
 * atualizada enquanto o usuário trabalha.
 *
 * Trabalha em cima do DOM (não de estado React) de propósito: os cards de
 * cliente/sprint são `<details>` nativos, renderizados por Server
 * Components — não há um estado React "único" de abertura pra controlar
 * daqui. `document.getElementById`/`.open` é o mesmo tipo de manipulação
 * imperativa pós-montagem já usado em `scroll-restore.tsx`.
 */
export function SprintsContextMemory(params: SprintsContextKeyParams) {
  const contextKey = buildSprintsContextKey(params);
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Restaura só uma vez por contextKey (Parte 8: "restaurar a posição
    // uma única vez") — troca de mês/filtro monta um contextKey novo, o
    // que permite restaurar de novo se o usuário voltar pro contexto
    // anterior, mas nunca reaplica repetidamente no MESMO contexto.
    if (restoredKeyRef.current === contextKey) return;
    restoredKeyRef.current = contextKey;

    const saved = loadSprintsContext(contextKey);
    if (!saved) return;

    // Parte 9: só reabre se o elemento existir no recorte atual (cliente
    // fora do filtro, sprint que não existe mais etc.) — senão ignora
    // silenciosamente, sem gerar erro.
    let didExpand = false;
    if (saved.expandedClientId) {
      const clientDetails = document.getElementById(`client-${saved.expandedClientId}`);
      if (clientDetails instanceof HTMLDetailsElement) {
        clientDetails.open = true;
        didExpand = true;
      }
    }
    if (saved.expandedSprintId) {
      const sprintDetails = document.getElementById(`sprint-${saved.expandedSprintId}`);
      if (sprintDetails instanceof HTMLDetailsElement) {
        sprintDetails.open = true;
        didExpand = true;
      }
    }

    // Scroll só depois das expansões (abrir `<details>` muda a altura da
    // página) — dois frames de espera pro navegador terminar o layout
    // antes de rolar, pra não saltar pra posição errada (Parte 8: "evitar
    // animação ou salto estranho").
    const scrollToSaved = () => window.scrollTo(0, saved.scrollY);
    if (didExpand) {
      requestAnimationFrame(() => requestAnimationFrame(scrollToSaved));
    } else {
      scrollToSaved();
    }
  }, [contextKey]);

  useEffect(() => {
    function handleToggle(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;

      if (target.id.startsWith("client-")) {
        const id = target.id.slice("client-".length);
        if (target.open) {
          saveSprintsContext(contextKey, { expandedClientId: id });
        } else if (loadSprintsContext(contextKey)?.expandedClientId === id) {
          // Só limpa se ESTE era o cliente lembrado — fechar um segundo
          // card aberto não deve apagar a memória do primeiro (Parte 9
          // aceita guardar só "o último", não uma pilha completa, mas
          // fechar um card que não era o lembrado não deveria contar como
          // "fechou o lembrado").
          saveSprintsContext(contextKey, { expandedClientId: null });
        }
      } else if (target.id.startsWith("sprint-")) {
        const id = target.id.slice("sprint-".length);
        if (target.open) {
          saveSprintsContext(contextKey, { expandedSprintId: id });
        } else if (loadSprintsContext(contextKey)?.expandedSprintId === id) {
          saveSprintsContext(contextKey, { expandedSprintId: null });
        }
      }
    }

    // `toggle` não borbulha em `<details>` — um listener em fase de
    // CAPTURA (`true`) intercepta o evento em qualquer nível da árvore de
    // qualquer forma, funcionando como delegação sem precisar de um
    // listener por card (Parte 13: uma fonte só, reutilizável).
    document.addEventListener("toggle", handleToggle, true);

    let scrollFrame: number | null = null;
    function handleScroll() {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        saveSprintsContext(contextKey, { scrollY: window.scrollY });
      });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      document.removeEventListener("toggle", handleToggle, true);
      window.removeEventListener("scroll", handleScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
  }, [contextKey]);

  return null;
}
