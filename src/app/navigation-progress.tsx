"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type ProgressState = "idle" | "loading" | "done";

/**
 * Barra fina de progresso percebido — Etapa "Navigation Feedback 1.0".
 * Ponto único de montagem (`layout.tsx`, fora de qualquer página): nunca
 * replicada em Sidebar/Operação/Cliente/Settings/Equipe individualmente.
 *
 * Início ("navegação começou"): intercepta `history.pushState`/
 * `replaceState` — APIs públicas e documentadas pelo próprio Next.js como
 * ponto de integração do App Router — mais `popstate` (voltar/avançar do
 * navegador). Juntos cobrem todo clique em `<Link>`, `router.push`/
 * `replace` e navegação por histórico, sem precisar interceptar cliques.
 * Só sinaliza início se o destino (pathname+search, ignorando hash) for
 * diferente do atual — isso exclui por construção: âncora de mesma
 * página, clique pra URL atual, Cmd/Ctrl+click e `target="_blank"` (nunca
 * chamam pushState nesta aba) e links externos (unload de página, não
 * passam por aqui). Redirect de Server Action usa o mesmo pushState por
 * baixo, então também é coberto — não há como garantir 100% (não é um
 * evento observável diretamente), fica documentado como a exceção.
 *
 * Fim ("nova rota pronta"): `usePathname`/`useSearchParams` só mudam de
 * valor depois que a rota nova já renderizou — o próprio padrão que a
 * documentação do Next.js usa pra detectar conclusão de navegação.
 *
 * Sem motor de progresso: só três estados (idle/loading/done) e duas
 * transições CSS, reaproveitando os tokens de motion já existentes
 * (`--motion-panel`, `--motion-fast`, `--ease-enter`, `--ease-exit`) — a
 * regra global `prefers-reduced-motion` (globals.css) já zera qualquer
 * `transition-duration`, então a barra ainda aparece/some corretamente,
 * só que sem animação.
 */
function NavigationProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = `${pathname}?${searchParams.toString()}`;

  const [state, setState] = useState<ProgressState>("idle");
  const [trackedUrlKey, setTrackedUrlKey] = useState(urlKey);
  const currentUrlRef = useRef(urlKey);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navegação concluída: pathname/searchParams só mudam de valor depois que
  // a rota nova já renderizou — isto é a própria detecção de "chegou".
  // Ajuste de estado durante o render (padrão documentado pelo React pra
  // reagir a uma mudança de valor derivado sem precisar de useEffect
  // dedicado só pra isso) em vez de setState dentro de um efeito.
  if (urlKey !== trackedUrlKey) {
    setTrackedUrlKey(urlKey);
    if (state === "loading") {
      setState("done");
    }
  }

  // Mantém a ref de "URL atual" (lida pelo patch de history abaixo) e
  // cancela um "mostrar barra" pendente assim que a navegação chega — só
  // pode acontecer dentro de um efeito, nunca durante o render.
  useEffect(() => {
    currentUrlRef.current = urlKey;
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  }, [urlKey]);

  // "done" é só um pouso rápido em 100% antes de sumir — evita ir direto de
  // 90% pra invisível, que pareceria um corte abrupto.
  useEffect(() => {
    if (state !== "done") return;
    idleTimeoutRef.current = setTimeout(() => setState("idle"), 200);
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [state]);

  useEffect(() => {
    function startIfNavigatingTo(target: string | URL | null | undefined) {
      if (!target) return;
      const next = new URL(target, window.location.href);
      const nextKey = `${next.pathname}?${next.searchParams.toString()}`;
      if (nextKey === currentUrlRef.current) return;
      // Pequeno atraso só visual: navegação real não espera por isto — se a
      // rota nova chegar antes dos 100ms, o timeout é cancelado no efeito de
      // conclusão acima e a barra nunca chega a aparecer.
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = setTimeout(() => setState("loading"), 100);
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function patchedPushState(...args: Parameters<History["pushState"]>) {
      startIfNavigatingTo(args[2]);
      return originalPushState(...args);
    };
    window.history.replaceState = function patchedReplaceState(...args: Parameters<History["replaceState"]>) {
      startIfNavigatingTo(args[2]);
      return originalReplaceState(...args);
    };

    function handlePopState() {
      startIfNavigatingTo(window.location.href);
    }
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", handlePopState);
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    };
  }, []);

  const isVisible = state !== "idle";
  const widthClass = state === "done" ? "w-full" : state === "loading" ? "w-[90%]" : "w-0";

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[80] h-[2px] bg-brand ${widthClass} ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      style={{
        transitionProperty: "width, opacity",
        transitionDuration: "var(--motion-panel), var(--motion-fast)",
        transitionTimingFunction: "var(--ease-enter), var(--ease-exit)",
      }}
    />
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressBar />
    </Suspense>
  );
}
