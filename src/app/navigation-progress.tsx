"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

type ProgressState = "idle" | "loading" | "done";
type Router = ReturnType<typeof useRouter>;

/**
 * `router` (retorno de `useRouter()`, `next/navigation`) não é estado
 * reativo do React — é o singleton imperativo do App Router
 * (`publicAppRouterInstance`). Envolvemos `push`/`replace` nele pra cobrir
 * navegação PROGRAMÁTICA (filtros que chamam `router.push` num `onChange`,
 * `redirect()` de Server Action — ver comentário completo no efeito de
 * patch abaixo). Esta função só existe pra passar por esse objeto sem o
 * TypeScript carregar o tipo exato de retorno de hook (`Router`) até o
 * ponto de mutação — o app não usa o React Compiler (sem
 * `experimental.reactCompiler` em `next.config.ts`), então mutar estes dois
 * métodos não quebra memoização nenhuma.
 */
function asMutableRouter(router: unknown): Router {
  return router as Router;
}

/**
 * Barra fina de progresso percebido — Etapa "Navigation Feedback 2.0".
 * Ponto único de montagem (`layout.tsx`, fora de qualquer página): nunca
 * replicada em Sidebar/Operação/Cliente/Settings/Equipe individualmente.
 *
 * Reescrita da Etapa 1.0: aquela versão detectava início via
 * `history.pushState`/`replaceState` interceptados. Auditoria (ver sessão)
 * provou, com instrumentação e reprodução isolada usando o App Router real
 * do Next 16, que essa premissa é falsa — `usePathname`/`useSearchParams`
 * podem mudar de valor ANTES (ou no mesmo ciclo) da chamada real a
 * `history.pushState`, porque o próprio `AppRouter` só sincroniza a URL do
 * navegador depois de já ter aplicado a navegação no estado interno.
 * `history.pushState` não é um sinal de INÍCIO — é uma consequência da
 * MESMA transição de estado que também atualiza `usePathname`, então os
 * dois disparam juntos (ordem imprevisível), nunca um "antes" do outro.
 *
 * Segunda tentativa (também descartada nesta mesma auditoria, antes de
 * chegar na versão abaixo): envolver `router.push`/`router.replace`
 * (`useRouter()`) como ÚNICO ponto de início. Funciona pra navegação
 * programática, mas reprodução isolada com `<Link>` real provou que
 * `<Link>` do App Router NÃO chama `router.push`/`replace` — chama
 * `dispatchNavigateAction` diretamente (`next/dist/client/app-dir/link.js`),
 * um atalho interno que passa por cima do objeto público. Ou seja: nenhum
 * clique em `<Link>` jamais teria sido pego só com essa interceptação.
 *
 * Início ("navegação começou") — versão final, três sinais independentes,
 * cada um cobrindo o que os outros dois não cobrem, todos síncronos (não
 * dependem de nenhum efeito React rodar em determinada ordem):
 *
 * 1. Clique em `<a>`/`<Link>`: `document.addEventListener("click", ..., true)`
 *    — fase de CAPTURA, dispara antes de qualquer `onClick` (React só
 *    entrega na fase de bolha). Só lê propriedades públicas do evento/DOM
 *    (botão, teclas modificadoras, `target`, `download`, origem) — as
 *    mesmas exclusões que o próprio `<Link>` aplicaria, replicadas aqui
 *    porque não dá mais pra confiar que ele vai fazer isso por nós. Nunca
 *    chama `preventDefault`/`stopPropagation`: é só observador, não pode
 *    quebrar navegação nenhuma.
 * 2. `router.push`/`router.replace` (`useRouter()`): cobre navegação
 *    programática que não vem de um clique — filtros (`onChange`) e
 *    `redirect()` de Server Action, que usa este mesmo objeto por baixo
 *    (`next/dist/client/components/app-router.js`).
 * 3. `popstate`: voltar/avançar do navegador — não passa por clique nem por
 *    `push`/`replace`.
 *
 * Cada um desses três dispara de forma síncrona, no exato momento em que a
 * navegação é iniciada (clique real, chamada real, evento real do
 * navegador) — nunca como reação atrasada a uma mudança de estado que já
 * aconteceu. Por isso início sempre precede fim por construção, não por
 * sorte de ordenação de efeitos.
 *
 * Só sinaliza início se o destino (pathname+search, ignorando hash) for
 * diferente do atual — isso exclui por construção: âncora de mesma página,
 * clique/chamada pra URL igual. Cmd/Ctrl+click, `target="_blank"`,
 * `download` e links externos são filtrados no próprio `handleClick`
 * (ponto 1 acima).
 *
 * Fim ("nova rota pronta"): continua `usePathname`/`useSearchParams`
 * mudando de valor depois que a rota nova já renderizou — o padrão que a
 * própria documentação do Next.js usa pra detectar conclusão de navegação.
 * Como início agora sempre precede fim pra uma mesma navegação, o efeito
 * que cancela um "mostrar barra" pendente ao detectar a chegada só pode
 * estar cancelando o timer da PRÓPRIA navegação que acabou de chegar — o
 * comportamento certo (evita flash em navegação rápida), não mais uma
 * corrida com resultado imprevisível.
 *
 * Sem motor de progresso: três estados (idle/loading/done) e duas
 * transições CSS, reaproveitando os tokens de motion já existentes
 * (`--motion-panel`, `--motion-fast`, `--ease-enter`, `--ease-exit`) — a
 * regra global `prefers-reduced-motion` (globals.css) já zera qualquer
 * `transition-duration`, então a barra ainda aparece/some corretamente,
 * só que sem animação.
 */
function NavigationProgressBar() {
  const router = useRouter();
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

  // Mantém a ref de "URL atual" (lida pelo início da navegação abaixo) e
  // cancela um "mostrar barra" pendente assim que a navegação chega — seguro
  // porque início sempre precede fim pra uma mesma navegação (ver acima); só
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
      // rota nova chegar antes disso, o timeout é cancelado no efeito de
      // conclusão acima e a barra nunca chega a aparecer.
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = setTimeout(() => setState("loading"), 50);
    }

    // 1) Cliques em `<a>`/`<Link>`: capturados no `document`, fase de
    // captura — dispara ANTES do próprio `onClick` do Link (React só entrega
    // o evento na fase de bolha), então nunca interfere na navegação real
    // (nunca chama `preventDefault`/`stopPropagation`, só observa). Réplica
    // deliberadamente as mesmas exclusões que o próprio `<Link>` do App
    // Router já aplica antes de navegar — clique modificado, `target`
    // diferente de `_self`, `download`, origem diferente — usando só
    // propriedades públicas do evento/DOM, nenhum detalhe interno do Next.
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      startIfNavigatingTo(url);
    }
    document.addEventListener("click", handleClick, true);

    // 2) `router.push`/`router.replace` (`useRouter()`, `next/navigation`):
    // cobre navegação programática que não passa por um clique em `<a>` —
    // filtros que reescrevem a query string (`onChange`, não clique) e
    // `redirect()` de Server Action, que usa este mesmo objeto singleton
    // por baixo (`next/dist/client/components/app-router.js`). Ver doc de
    // `asMutableRouter` acima.
    const mutableRouter = asMutableRouter(router);
    const originalPush = mutableRouter.push.bind(mutableRouter);
    const originalReplace = mutableRouter.replace.bind(mutableRouter);

    mutableRouter.push = (href, options) => {
      startIfNavigatingTo(href);
      return originalPush(href, options);
    };
    mutableRouter.replace = (href, options) => {
      startIfNavigatingTo(href);
      return originalReplace(href, options);
    };

    // 3) Voltar/avançar do navegador: não passa por clique nem por
    // `push`/`replace`, só por este evento nativo.
    function handlePopState() {
      startIfNavigatingTo(window.location.href);
    }
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("click", handleClick, true);
      mutableRouter.push = originalPush;
      mutableRouter.replace = originalReplace;
      window.removeEventListener("popstate", handlePopState);
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    };
  }, [router]);

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
