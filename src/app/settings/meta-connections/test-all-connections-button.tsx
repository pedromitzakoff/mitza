"use client";

import { useState, useTransition } from "react";
import { testAllMetaConnectionsAction, type ConnectionTestResult } from "./actions";

/**
 * "Testar todas as conexões" — testa TODAS as fontes `meta_api` habilitadas
 * de uma vez (em vez de abrir "Gerenciar" cliente por cliente só pra
 * descobrir quem tem permissão faltando na Meta, achado real: Vaapty SBC).
 * Resultado fica só nesta página (estado local, nunca gravado) — reflete o
 * estado da Meta NESTE momento, pode mudar entre um teste e outro se
 * alguém ajustar a permissão do lado de lá.
 */
export function TestAllConnectionsButton() {
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<ConnectionTestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const outcome = await testAllMetaConnectionsAction();
      if ("error" in outcome) {
        setError(outcome.error);
        return;
      }
      setResults(outcome.results);
    });
  }

  const failedCount = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div className="mb-4 flex flex-col gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="mitza-pressable self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Testando conexões…" : "Testar todas as conexões"}
      </button>

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}

      {results && (
        <div className="rounded-lg border border-border">
          <p className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
            {results.length === 0
              ? "Nenhuma conexão meta_api habilitada pra testar ainda."
              : failedCount === 0
                ? `Todas as ${results.length} conexões testadas estão OK agora.`
                : `${failedCount} de ${results.length} conexões com problema agora.`}
          </p>
          {results.length > 0 && (
            <ul className="divide-y divide-border">
              {results.map((result) => (
                <li key={result.clientId} className="flex flex-col gap-1 px-4 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{result.clientName}</span>
                    <span className={result.ok ? "text-emerald-700 dark:text-emerald-300" : "font-medium text-red-700 dark:text-red-300"}>
                      {result.ok ? "OK" : "Erro"}
                    </span>
                  </div>
                  {!result.ok && result.error && <p className="text-xs text-red-700 dark:text-red-300">{result.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
