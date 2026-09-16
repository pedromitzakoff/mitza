"use client";

import Link from "next/link";
import { DiagnosisPicker } from "./diagnosis-picker";
import { OptimizationQuickPicker } from "./optimization-quick-picker";
import { recordAccountReviewAction } from "./account-review-actions";
import { SubmitButton } from "@/app/submit-button";

/**
 * Registro de revisão operacional (Etapa "Histórico de Decisões
 * Operacionais" — substitui o antigo formulário de 3 perguntas condicionais
 * "por que revisou" → "resultado" → campos condicionais). Três blocos só:
 * DIAGNÓSTICO (o que o gestor encontrou, `DiagnosisPicker`) → AÇÃO (o que
 * ele fez, `OptimizationQuickPicker`, mesmo componente já usado pela
 * recorrência "Otimização" — reaproveitado, nunca duplicado) → OBSERVAÇÃO
 * (opcional). `reason`/`outcome` continuam existindo no banco (histórico),
 * mas deixam de ser perguntados aqui — `recordAccountReviewAction` resolve
 * os dois sozinho (ver o comentário lá). "Conta saudável" + nenhuma ação
 * selecionada é um registro perfeitamente válido — não força nenhuma ação
 * artificial só para salvar.
 *
 * `managers` não é mais usado aqui (o antigo fluxo "criar tarefa a partir da
 * pendência" saiu do formulário rápido — criar uma tarefa continua existindo
 * como funcionalidade genérica do produto, só não é mais um passo deste
 * formulário) — mantido no tipo só pra não obrigar os 2 chamadores
 * (`/clients/[id]/page.tsx`, `/sprints/page.tsx`) a deixar de passar a prop.
 */
export function RecordAccountReviewDrawer({
  clientId,
  closeHref,
  error,
}: {
  clientId: string;
  closeHref: string;
  managers: { id: string; name: string }[];
  error?: string;
}) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-overview-text-primary">Registrar revisão</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
          >
            Fechar
          </Link>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <form action={recordAccountReviewAction.bind(null, clientId, closeHref)} className="mt-4 flex flex-col gap-4">
          <section>
            <p className="text-sm font-medium text-overview-text-primary">Diagnóstico</p>
            <div className="mt-2">
              <DiagnosisPicker />
            </div>
          </section>

          <section className="border-t border-overview-border pt-4">
            <p className="text-sm font-medium text-overview-text-primary">Ação</p>
            <div className="mt-2">
              <OptimizationQuickPicker />
            </div>
          </section>

          <section className="border-t border-overview-border pt-4">
            <label className="flex flex-col gap-1 text-sm text-overview-text-primary">
              Observação <span className="text-xs text-overview-text-secondary">(opcional)</span>
              <textarea
                name="notes"
                rows={2}
                placeholder="Contexto que os chips não explicam"
                className="rounded-md border border-overview-border bg-transparent px-3 py-2 text-sm text-overview-text-primary outline-none focus:border-overview-border-strong"
              />
            </label>
          </section>

          <div className="flex items-center gap-2 border-t border-overview-border pt-4">
            <SubmitButton
              pendingChildren="Salvando..."
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Registrar revisão
            </SubmitButton>
            <Link
              href={closeHref}
              scroll={false}
              className="rounded-md border border-overview-border px-4 py-2 text-sm font-medium text-overview-text-primary hover:bg-overview-surface-hover"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
