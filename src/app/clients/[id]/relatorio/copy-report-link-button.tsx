"use client";

import { useState, useTransition } from "react";
import { generateReportShareLinkAction } from "@/app/clients/report-share-link-actions";

const DEFAULT_LABEL = "Copiar link do cliente";
const COPIED_LABEL = "Link copiado";

const BUTTON_CLASSES =
  "mitza-pressable shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-[#6F6B65] transition-colors hover:bg-[#EFE9E0] hover:text-[#17171A] disabled:pointer-events-none disabled:opacity-50 sm:text-sm";

/**
 * "Copiar link do cliente" — ação secundária do cabeçalho do Relatório de
 * Performance (`/clients/[id]/relatorio`, Etapa "Copiar link do cliente no
 * Relatório"). Reaproveita 100% a infraestrutura já existente do link
 * público (`lib/report-share-links.ts` + `report-share-link-actions.ts`,
 * mesma usada pelo painel "Link do cliente" em `account-info-drawer.tsx`) —
 * nenhum token/URL é construído aqui: `initialUrl`/`result.url` sempre vêm
 * prontos de `getReportShareLinkStatus`/`generateReportShareLinkAction`.
 *
 * Sem link ativo ainda, o próprio clique já é a decisão explícita do
 * usuário pra gerar um (`generateReportShareLinkAction`, o MESMO fluxo
 * canônico do painel do drawer) — nunca gera um token silenciosamente fora
 * de um clique. Geração/revogação continuam admin-only
 * (`assertAdminCanAccessClient`, inalterado); se um gestor clicar sem link
 * ativo, o erro de permissão da própria Server Action aparece aqui embaixo,
 * nunca um estado paralelo de autorização.
 */
export function CopyReportLinkButton({ clientId, initialUrl }: { clientId: string; initialUrl: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [error, setError] = useState<string | null>(null);

  async function copyAndShowFeedback(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setLabel(COPIED_LABEL);
      setTimeout(() => setLabel(DEFAULT_LABEL), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente — tente novamente.");
    }
  }

  function handleClick() {
    setError(null);
    if (url) {
      void copyAndShowFeedback(url);
      return;
    }
    startTransition(async () => {
      const result = await generateReportShareLinkAction(clientId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setUrl(result.url);
      await copyAndShowFeedback(result.url);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={handleClick} disabled={isPending} className={BUTTON_CLASSES}>
        {isPending ? "Gerando link…" : label}
      </button>
      {error && <p className="max-w-[16rem] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
