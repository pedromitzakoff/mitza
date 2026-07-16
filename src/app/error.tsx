"use client";

import { useEffect } from "react";

/**
 * Error boundary raiz — cobre qualquer rota sem `error.tsx` próprio (ex.:
 * /sprints, /clients/[id]). Etapa "Critical Fix — Sprints Consolidated
 * View" (Parte 5): antes exibia `error.message` diretamente — em produção,
 * quando um Server Component lança uma exceção, o Next.js REDIGE a
 * mensagem real por segurança e substitui `error.message` por um texto
 * técnico em inglês genérico ("An error occurred in the Server Components
 * render..."), que este componente estava repassando direto pro gestor.
 * Agora a mensagem visível é sempre fixa e em português; o detalhe técnico
 * (mensagem real, disponível em desenvolvimento, e `error.digest` — o
 * identificador que o Next.js gera pra correlacionar com o log do
 * servidor) vai só pro `console.error`, nunca pra tela.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[erro de render]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">Não foi possível carregar esta página</h1>
      <p className="text-sm text-muted-foreground">
        Tente novamente. Se o problema continuar, avise o time responsável.
      </p>
      {error.digest && <p className="text-xs text-muted-foreground">Código de referência: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
      >
        Tentar novamente
      </button>
    </div>
  );
}
