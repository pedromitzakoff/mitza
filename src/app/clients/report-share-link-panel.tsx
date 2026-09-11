"use client";

import { useState, useTransition } from "react";
import { generateReportShareLinkAction, revokeReportShareLinkAction } from "./report-share-link-actions";

const BUTTON_CLASSES =
  "mitza-pressable inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50";

/**
 * Etapa "Link Externo V1" — painel "Link do cliente" dentro de "Informações
 * da conta" (`account-info-drawer.tsx`).
 *
 * Etapa "Link Externo — token recuperável" (pedido explícito do usuário,
 * decisão consciente de trade-off de segurança — ver o módulo central do
 * token, que decide o que é persistido, nunca este painel):
 * o token bruto passou a ser persistido, então a URL fica sempre visível
 * enquanto o link estiver ativo — nunca mais "só aparece uma vez, perdeu
 * precisa gerar outro". `initialUrl` chega pronto de `getReportShareLinkStatus`
 * (Server Component, `[id]/page.tsx`); "Gerar novo link"/"Gerar link"
 * atualizam esse valor local depois da Server Action, sem precisar recarregar
 * a página. Único caso em que o valor pode faltar mesmo com `active === true`:
 * um link gerado ANTES desta etapa (linha antiga sem `token` persistido) —
 * aí a única saída é gerar um novo (mesmo fluxo de sempre).
 */
export function ReportShareLinkPanel({
  clientId,
  initialActive,
  initialCreatedAtLabel,
  initialUrl,
}: {
  clientId: string;
  initialActive: boolean;
  /** Já formatado (`formatRelativeDateTime`) por quem chama — `null` sem
   * link ativo. */
  initialCreatedAtLabel: string | null;
  /** URL completa do link ativo, pronta pra exibir — `null` sem link ativo
   * ou pra um link antigo sem valor persistido (ver doc acima). */
  initialUrl: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(initialActive);
  const [createdAtLabel, setCreatedAtLabel] = useState(initialCreatedAtLabel);
  const [url, setUrl] = useState(initialUrl);
  const [copyLabel, setCopyLabel] = useState("Copiar link");
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateReportShareLinkAction(clientId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setUrl(result.url);
      setCopyLabel("Copiar link");
      setActive(true);
      setCreatedAtLabel("agora");
    });
  }

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeReportShareLinkAction(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setActive(false);
      setCreatedAtLabel(null);
      setUrl(null);
    });
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyLabel("Copiado!");
      setTimeout(() => setCopyLabel("Copiar link"), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente — selecione e copie o link manualmente.");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {url ? (
        <>
          {createdAtLabel && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-overview-text-muted">Link ativo desde</span>
              <span className="text-sm font-medium text-overview-text-primary">{createdAtLabel}</span>
            </div>
          )}
          <div className="rounded-md border border-overview-border bg-overview-surface-hover px-2 py-1.5">
            <code className="block truncate text-xs text-overview-text-primary">{url}</code>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCopy} className={BUTTON_CLASSES}>
              {copyLabel}
            </button>
            <button type="button" onClick={handleGenerate} disabled={isPending} className={BUTTON_CLASSES}>
              Gerar novo link
            </button>
            <button type="button" onClick={handleRevoke} disabled={isPending} className={BUTTON_CLASSES}>
              Revogar
            </button>
          </div>
        </>
      ) : active ? (
        <>
          {/* Link ativo mas sem valor persistido (gerado antes da Etapa
              "Link Externo — token recuperável") — único caso em que ainda
              não dá pra reexibir; "Gerar novo link" resolve de vez. */}
          <p className="text-xs text-overview-text-muted">
            Este link foi gerado antes de o valor ficar salvo pra reexibição — gere um novo pra poder vê-lo de novo daqui em diante.
          </p>
          {createdAtLabel && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-overview-text-muted">Link ativo desde</span>
              <span className="text-sm font-medium text-overview-text-primary">{createdAtLabel}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={handleGenerate} disabled={isPending} className={BUTTON_CLASSES}>
              Gerar novo link
            </button>
            <button type="button" onClick={handleRevoke} disabled={isPending} className={BUTTON_CLASSES}>
              Revogar
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={handleGenerate} disabled={isPending} className={BUTTON_CLASSES}>
          Gerar link
        </button>
      )}
      {error && <p className="text-xs text-overview-danger">{error}</p>}
    </div>
  );
}
