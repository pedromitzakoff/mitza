"use client";

import { useEffect, useRef } from "react";
import { addToSet, loadScreenMemory, removeFromSet, saveScreenMemory } from "./screen-memory";

/**
 * Etapa "MITZA Interaction Engine v1.5" — generalizado a partir de
 * `SprintsContextMemory` (`src/app/sprints/context-memory-client.tsx`).
 * Não renderiza nada: só (1) restaura, uma única vez por montagem, tudo
 * que estava expandido (em qualquer das categorias de `prefixes`) e a
 * posição de scroll salvos pra este MESMO `contextKey`, e (2) fica ouvindo
 * togglings de `<details id="{prefix}{id}">` e o scroll da página pra
 * manter essa memória atualizada enquanto o usuário trabalha.
 *
 * Cada categoria é um conjunto (`string[]` sem duplicatas, via
 * `addToSet`/`removeFromSet`) — abrir vários itens ao mesmo tempo e voltar
 * depois reabre todos, não só o último. A posição de scroll é restaurada
 * DEPOIS de reabrir tudo (abrir `<details>` muda a altura da página).
 *
 * Trabalha em cima do DOM (não de estado React) de propósito: os cards que
 * este hook observa normalmente são `<details>` nativos renderizados por
 * Server Components — não há um estado React "único" de abertura pra
 * controlar daqui. `document.getElementById`/`.open` é o mesmo tipo de
 * manipulação imperativa pós-montagem já usado em `scroll-restore.tsx`.
 *
 * `prefixes` deve ser uma referência estável entre renders (uma constante
 * de módulo, não um array literal recriado a cada render) — o hook usa
 * `prefixes.join(",")` como dependência de efeito pra não se importar com
 * identidade do array, só com o conteúdo, mas passar sempre a mesma
 * constante evita qualquer ambiguidade.
 */
export function useScreenMemory({
  storageKey,
  version,
  contextKey,
  prefixes,
}: {
  storageKey: string;
  version: number;
  contextKey: string;
  prefixes: string[];
}) {
  const restoredKeyRef = useRef<string | null>(null);
  const prefixesKey = prefixes.join(",");

  useEffect(() => {
    // Restaura só uma vez por contextKey — troca de mês/filtro monta um
    // contextKey novo, o que permite restaurar de novo se o usuário voltar
    // pro contexto anterior, mas nunca reaplica repetidamente no MESMO
    // contexto.
    if (restoredKeyRef.current === contextKey) return;
    restoredKeyRef.current = contextKey;

    const saved = loadScreenMemory(storageKey, version, contextKey);
    if (!saved) return;

    // Só reabre o que ainda existir no recorte atual (item fora do filtro,
    // removido etc.) — senão ignora silenciosamente, sem gerar erro.
    let didExpand = false;
    for (const prefix of prefixes) {
      for (const id of saved.expanded[prefix] ?? []) {
        const details = document.getElementById(`${prefix}${id}`);
        if (details instanceof HTMLDetailsElement) {
          details.open = true;
          didExpand = true;
        }
      }
    }

    // Scroll só depois das expansões — dois frames de espera pro navegador
    // terminar o layout antes de rolar, pra não saltar pra posição errada.
    const scrollToSaved = () => window.scrollTo(0, saved.scrollY);
    if (didExpand) {
      requestAnimationFrame(() => requestAnimationFrame(scrollToSaved));
    } else {
      scrollToSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixesKey representa `prefixes` de forma estável
  }, [contextKey, storageKey, version, prefixesKey]);

  useEffect(() => {
    function handleToggle(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;

      const prefix = prefixes.find((candidate) => target.id.startsWith(candidate));
      if (!prefix) return;

      const id = target.id.slice(prefix.length);
      const current = loadScreenMemory(storageKey, version, contextKey);
      const currentSet = current?.expanded[prefix] ?? [];
      const nextSet = target.open ? addToSet(currentSet, id) : removeFromSet(currentSet, id);
      if (nextSet !== currentSet) {
        saveScreenMemory(storageKey, version, contextKey, {
          expanded: { ...(current?.expanded ?? {}), [prefix]: nextSet },
        });
      }
    }

    // `toggle` não borbulha em `<details>` — um listener em fase de
    // CAPTURA (`true`) intercepta o evento em qualquer nível da árvore de
    // qualquer forma, funcionando como delegação sem precisar de um
    // listener por card.
    document.addEventListener("toggle", handleToggle, true);

    let scrollFrame: number | null = null;
    function handleScroll() {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        saveScreenMemory(storageKey, version, contextKey, { scrollY: window.scrollY });
      });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      document.removeEventListener("toggle", handleToggle, true);
      window.removeEventListener("scroll", handleScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixesKey representa `prefixes` de forma estável
  }, [contextKey, storageKey, version, prefixesKey]);
}
