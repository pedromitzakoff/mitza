"use client";

import { useState, useTransition } from "react";
import { SubmitButton } from "@/app/submit-button";
import { discoverActionTypesAction } from "./actions";

const inputClasses = "rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500";
const labelClasses = "flex flex-col gap-1 text-sm text-foreground";

/**
 * "Mapeamento de resultados" (ponto 4 do pedido do usuário): nunca presume
 * `action_type` — descobre os valores REAIS recebidos pela conta nos
 * últimos 7 dias (`discoverActionTypesAction`) e só então deixa escolher.
 * O campo manual continua existindo como escape (conta nova sem conversão
 * ainda, ou API indisponível no momento) — mas com aviso explícito pra
 * nunca adivinhar, igual ao `docs/N8N_META_INGESTION_GUIDE.md`.
 */
export function ActionTypePicker({
  accountId,
  saveMappingAction,
}: {
  accountId: string;
  saveMappingAction: (formData: FormData) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [actionTypes, setActionTypes] = useState<string[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [useManual, setUseManual] = useState(false);

  function handleDiscover() {
    setDiscoverError(null);
    startTransition(async () => {
      const result = await discoverActionTypesAction(accountId);
      if (result.error) {
        setDiscoverError(result.error);
        setUseManual(true);
        return;
      }
      setActionTypes(result.actionTypes ?? []);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Novo mapeamento</p>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={isPending}
          className="mitza-pressable rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Buscando na Meta…" : "Descobrir eventos reais (últimos 7 dias)"}
        </button>
      </div>

      {discoverError && <p className="text-xs text-amber-700 dark:text-amber-400">{discoverError}</p>}
      {actionTypes && actionTypes.length > 0 && (
        <p className="text-xs text-muted-foreground">{actionTypes.length} evento(s) encontrado(s) — selecione abaixo.</p>
      )}

      <form action={saveMappingAction} className="flex flex-col gap-3">
        <label className={labelClasses}>
          Objetivo
          <select name="goal" required defaultValue="leads" className={inputClasses}>
            <option value="leads">Leads</option>
            <option value="sales">Vendas</option>
            <option value="followers">Seguidores</option>
          </select>
        </label>

        {actionTypes && actionTypes.length > 0 && !useManual ? (
          <label className={labelClasses}>
            Evento (action_type)
            <select name="action_type" required className={inputClasses}>
              {actionTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className={labelClasses}>
            Evento (action_type) — digite manualmente
            <input name="action_type_manual" required placeholder="ex.: lead" className={inputClasses} />
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Confirme o nome exato no Gerenciador de Anúncios da Meta antes de salvar — nunca adivinhe.
            </span>
          </label>
        )}

        {actionTypes && actionTypes.length > 0 && (
          <button type="button" onClick={() => setUseManual((v) => !v)} className="self-start text-xs text-muted-foreground underline">
            {useManual ? "Usar lista descoberta" : "Digitar manualmente em vez disso"}
          </button>
        )}

        <label className={labelClasses}>
          Evento de valor/receita <span className="text-xs text-muted-foreground">(opcional, só pra Vendas)</span>
          <input name="value_action_type" placeholder="ex.: purchase" className={inputClasses} />
        </label>

        <SubmitButton className="self-start rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover" pendingChildren="Salvando…">
          Salvar mapeamento
        </SubmitButton>
      </form>
    </div>
  );
}
