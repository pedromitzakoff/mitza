"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateTimeWithYear } from "@/lib/format";
import {
  copyClientUpdateAction,
  markClientUpdateSentAction,
  markClientUpdateUnsentAction,
  updateClientUpdateContentAction,
} from "./client-update-actions";

const AUTOSAVE_DEBOUNCE_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * "ATUALIZAÇÃO PARA O CLIENTE" (Etapa 59) — segundo componente client-side
 * do app (depois de `RecordAccountReviewDrawer`, mesma justificativa: texto
 * editável com autosave debounced e clipboard não têm como ser um form
 * nativo com Server Action + redirect). Vive dentro do
 * `AccountReviewDetailDrawer`, já existente — não é um drawer novo.
 */
export function ClientUpdateEditor({
  clientUpdateId,
  clientId,
  initialContent,
  initialSentAt,
  initialSentByName,
}: {
  clientUpdateId: string;
  clientId: string;
  initialContent: string;
  initialSentAt: string | null;
  initialSentByName: string | null;
}) {
  const [content, setContent] = useState(initialContent);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [sentByName, setSentByName] = useState(initialSentByName);
  const [showSentConfirm, setShowSentConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleContentChange(value: string) {
    setContent(value);
    setSaveState("saving");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const result = await updateClientUpdateContentAction(clientUpdateId, clientId, value);
      setSaveState(result.ok ? "saved" : "error");
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
    await copyClientUpdateAction(clientUpdateId, clientId);
  }

  async function handleConfirmSent() {
    const result = await markClientUpdateSentAction(clientUpdateId, clientId);
    if (result.ok) {
      setSentAt(result.sentAt ?? null);
      setSentByName(result.sentByName ?? null);
      setShowSentConfirm(false);
    }
  }

  async function handleMarkUnsent() {
    const result = await markClientUpdateUnsentAction(clientUpdateId, clientId);
    if (result.ok) {
      setSentAt(null);
      setSentByName(null);
      setShowMenu(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground">
          {saveState === "saving" && "Salvando..."}
          {saveState === "saved" && "Salvo"}
          {saveState === "error" && <span className="text-red-600 dark:text-red-400">Erro ao salvar</span>}
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        rows={9}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:border-zinc-500"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Copiar texto
        </button>

        {!sentAt && !showSentConfirm && (
          <button
            type="button"
            onClick={() => setShowSentConfirm(true)}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            Marcar como enviada
          </button>
        )}

        {copyFeedback && <span className="text-xs text-muted-foreground">Texto copiado</span>}
      </div>

      {!sentAt && showSentConfirm && (
        <div className="rounded-md border border-border bg-zinc-50 p-2.5 text-xs dark:bg-zinc-900/40">
          <p className="font-medium text-foreground">Confirmar envio da atualização?</p>
          <p className="mt-0.5 text-muted-foreground">A atualização será registrada como comunicada ao cliente.</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmSent}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover"
            >
              Confirmar envio
            </button>
            <button
              type="button"
              onClick={() => setShowSentConfirm(false)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sentAt && (
        <div className="relative flex items-center justify-between gap-2 text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">
            Enviada em {formatDateTimeWithYear(sentAt)}
            {sentByName && ` por ${sentByName}`}
          </span>
          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Mais opções"
          >
            ⋯
          </button>
          {showMenu && (
            <div className="absolute right-0 top-6 z-10 rounded-md border border-border bg-card p-1 shadow-lg">
              <button
                type="button"
                onClick={handleMarkUnsent}
                className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Marcar como não enviada
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
