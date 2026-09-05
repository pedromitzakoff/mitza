"use client";

import { useState, useTransition } from "react";
import { generateReportShareLinkAction, revokeReportShareLinkAction } from "./report-share-link-actions";

const BUTTON_CLASSES =
  "mitza-pressable inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50";

/**
 * Etapa "Link Externo V1" — painel "Link do cliente" dentro de "Informações
 * da conta" (`account-info-drawer.tsx`).
 *
 * UX de segurança deliberada: `report_share_links` só guarda o HASH do
 * token, nunca o valor bruto — então a URL só existe em memória do
 * navegador no instante em que acaba de ser gerada (`revealedUrl`, estado
 * local, nunca persistido em nenhum storage). Fechar o drawer/recarregar a
 * página perde o texto pra sempre; a única forma de "recuperar" é "Gerar
 * novo link", que revoga o anterior e mostra um novo. Isso é intencional —
 * nunca enfraquecer a segurança (ex.: guardar o token em claro) só pra
 * permitir reexibição depois.
 */
export function ReportShareLinkPanel({
  clientId,
  initialActive,
  initialCreatedAtLabel,
}: {
  clientId: string;
  initialActive: boolean;
  /** Já formatado (`formatRelativeDateTime`) por quem chama — `null` sem
   * link ativo. */
  initialCreatedAtLabel: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(initialActive);
  const [createdAtLabel, setCreatedAtLabel] = useState(initialCreatedAtLabel);
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
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
      setRevealedUrl(result.url);
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
      setRevealedUrl(null);
    });
  }

  async function handleCopy() {
    if (!revealedUrl) return;
    try {
      await navigator.clipboard.writeText(revealedUrl);
      setCopyLabel("Copiado!");
      setTimeout(() => setCopyLabel("Copiar link"), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente — selecione e copie o link manualmente.");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {revealedUrl ? (
        <>
          <p className="text-xs text-overview-text-muted">
            Copie agora — por segurança, este link não pode ser exibido de novo depois de sair desta tela.
          </p>
          <div className="rounded-md border border-overview-border bg-overview-surface-hover px-2 py-1.5">
            <code className="block truncate text-xs text-overview-text-primary">{revealedUrl}</code>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCopy} className={BUTTON_CLASSES}>
              {copyLabel}
            </button>
            <button type="button" onClick={handleRevoke} disabled={isPending} className={BUTTON_CLASSES}>
              Revogar
            </button>
          </div>
        </>
      ) : active ? (
        <>
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
