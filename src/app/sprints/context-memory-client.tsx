"use client";

import { useEffect, useRef } from "react";
import {
  addToSet,
  buildSprintsContextKey,
  loadSprintsContext,
  removeFromSet,
  saveSprintsContext,
  type SprintsContextKeyParams,
} from "./context-memory";

const ID_PREFIXES = [
  { prefix: "client-", field: "expandedClientIds" as const },
  { prefix: "sprint-", field: "expandedSprintIds" as const },
  { prefix: "comments-", field: "expandedCommentIds" as const },
];

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 6-9/13), expandida
 * pela etapa "MITZA Interaction Engine v1" (Parte 3 — "Context Memory
 * 2.0"). Montado uma vez na página `/sprints`. Não renderiza nada: só (1)
 * restaura, uma única vez por montagem, TODOS os clientes/sprints/
 * comentários que estavam expandidos e a posição de scroll salvos pra este
 * MESMO contexto (mês/visão/filtros — ver `buildSprintsContextKey`), e (2)
 * fica ouvindo togglings de `<details id="client-*"|"sprint-*"|"comments-*">`
 * e o scroll da página pra manter essa memória atualizada enquanto o
 * usuário trabalha.
 *
 * Context Memory 2.0: antes só o ÚLTIMO cliente/sprint expandido era
 * lembrado; agora cada categoria é um conjunto (`string[]` sem duplicatas,
 * via `addToSet`/`removeFromSet`) — abrir 3 clientes e 2 sprints ao mesmo
 * tempo e voltar depois reabre os 5, não só o mais recente. "Scroll
 * inteligente": like antes, a posição salva é restaurada DEPOIS de reabrir
 * tudo — se o usuário estava rolado até dentro da 3ª sprint expandida, ela
 * já reabre e a página já cai exatamente lá, não no topo.
 *
 * Trabalha em cima do DOM (não de estado React) de propósito: os cards de
 * cliente/sprint/comentários são `<details>` nativos, renderizados por
 * Server Components — não há um estado React "único" de abertura pra
 * controlar daqui. `document.getElementById`/`.open` é o mesmo tipo de
 * manipulação imperativa pós-montagem já usado em `scroll-restore.tsx`.
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

    // Parte 9: só reabre o que ainda existir no recorte atual (cliente
    // fora do filtro, sprint que não existe mais etc.) — senão ignora
    // silenciosamente, sem gerar erro.
    let didExpand = false;
    const allIds = [
      ...saved.expandedClientIds.map((id) => `client-${id}`),
      ...saved.expandedSprintIds.map((id) => `sprint-${id}`),
      ...saved.expandedCommentIds.map((id) => `comments-${id}`),
    ];
    for (const domId of allIds) {
      const details = document.getElementById(domId);
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
        didExpand = true;
      }
    }

    // Scroll só depois das expansões (abrir vários `<details>` muda a
    // altura da página) — dois frames de espera pro navegador terminar o
    // layout antes de rolar, pra não saltar pra posição errada (Parte 8:
    // "evitar animação ou salto estranho").
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

      const match = ID_PREFIXES.find(({ prefix }) => target.id.startsWith(prefix));
      if (!match) return;

      const id = target.id.slice(match.prefix.length);
      const current = loadSprintsContext(contextKey);
      const currentSet = current?.[match.field] ?? [];
      const nextSet = target.open ? addToSet(currentSet, id) : removeFromSet(currentSet, id);
      if (nextSet !== currentSet) {
        saveSprintsContext(contextKey, { [match.field]: nextSet });
      }
    }

    // `toggle` não borbulha em `<details>` — um listener em fase de
    // CAPTURA (`true`) intercepta o evento em qualquer nível da árvore de
    // qualquer forma, funcionando como delegação sem precisar de um
    // listener por card (Parte 11 da etapa anterior: uma fonte só,
    // reutilizável).
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
