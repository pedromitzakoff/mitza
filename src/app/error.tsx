"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">Não foi possível carregar a Visão Geral</h1>
      <p className="text-sm text-muted-foreground">
        {error.message || "Ocorreu um erro inesperado ao buscar os dados da agência."}
      </p>
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
