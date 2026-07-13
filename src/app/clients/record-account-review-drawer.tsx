"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ACCOUNT_REVIEW_OUTCOME_DESCRIPTION,
  ACCOUNT_REVIEW_OUTCOME_LABEL,
  ACCOUNT_REVIEW_OUTCOMES,
  ACCOUNT_REVIEW_REASON_LABEL,
  ACCOUNT_REVIEW_REASONS,
  OPTIMIZATION_ACTIONS_BY_TYPE,
  OPTIMIZATION_ACTION_LABEL,
  OPTIMIZATION_TYPE_LABEL,
  OPTIMIZATION_TYPES,
  emptyOptimizationDraft,
  type OptimizationDraft,
} from "@/lib/account-reviews";
import type { AccountReviewOutcome, AccountReviewReason } from "@/lib/supabase/database.types";
import { recordAccountReviewAction } from "./account-review-actions";

/**
 * Primeiro formulário verdadeiramente client-side do app (seção 33/10 do
 * pedido) — decisão deliberada: o fluxo tem 3 seções condicionais (motivo →
 * resultado → otimizações/problema) e um repetidor dinâmico de otimizações,
 * que o padrão existente do projeto (`<details>`/`peer` só-CSS) não cobre
 * sem gambiarra. Ainda assim submete por uma única Server Action nativa
 * (`recordAccountReviewAction`), sem chamada de API própria.
 */
export function RecordAccountReviewDrawer({
  clientId,
  closeHref,
  managers,
  error,
}: {
  clientId: string;
  closeHref: string;
  managers: { id: string; name: string }[];
  error?: string;
}) {
  const [reason, setReason] = useState<AccountReviewReason | "">("");
  const [reasonOther, setReasonOther] = useState("");
  const [outcome, setOutcome] = useState<AccountReviewOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [optimizations, setOptimizations] = useState<OptimizationDraft[]>([emptyOptimizationDraft()]);
  const [issueDescription, setIssueDescription] = useState("");
  const [issueCategory, setIssueCategory] = useState("");
  const [createTask, setCreateTask] = useState(false);
  const [taskResponsibleId, setTaskResponsibleId] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  function updateOptimization(index: number, patch: Partial<OptimizationDraft>) {
    setOptimizations((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addOptimization() {
    setOptimizations((rows) => [...rows, emptyOptimizationDraft()]);
  }

  function removeOptimization(index: number) {
    setOptimizations((rows) => rows.filter((_, i) => i !== index));
  }

  const canSave =
    reason !== "" &&
    (reason !== "OTHER" || reasonOther.trim().length > 0) &&
    outcome !== "" &&
    (outcome !== "ISSUE_IDENTIFIED" || issueDescription.trim().length > 0) &&
    (outcome !== "OPTIMIZATION_PERFORMED" || optimizations.length > 0);

  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Registrar análise</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <form action={recordAccountReviewAction.bind(null, clientId, closeHref)} className="mt-4 flex flex-col gap-5">
          <input type="hidden" name="reason" value={reason} />
          <input type="hidden" name="reason_other_description" value={reason === "OTHER" ? reasonOther : ""} />
          <input type="hidden" name="outcome" value={outcome} />
          <input type="hidden" name="notes" value={outcome === "NO_CHANGE" ? notes : ""} />
          <input type="hidden" name="issue_description" value={outcome === "ISSUE_IDENTIFIED" ? issueDescription : ""} />
          <input type="hidden" name="issue_category" value={outcome === "ISSUE_IDENTIFIED" ? issueCategory : ""} />
          {outcome === "ISSUE_IDENTIFIED" && createTask && <input type="hidden" name="create_task" value="on" />}
          <input type="hidden" name="task_responsible_id" value={taskResponsibleId} />
          <input type="hidden" name="task_due_date" value={taskDueDate} />
          <input
            type="hidden"
            name="optimizations_json"
            value={outcome === "OPTIMIZATION_PERFORMED" ? JSON.stringify(optimizations) : "[]"}
          />

          <section>
            <p className="text-sm font-medium text-foreground">Por que você analisou a conta?</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {ACCOUNT_REVIEW_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-md border px-2.5 py-1.5 text-left text-xs font-medium ${
                    reason === r
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  {ACCOUNT_REVIEW_REASON_LABEL[r]}
                </button>
              ))}
            </div>
            {reason === "OTHER" && (
              <input
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
                placeholder="Descreva o motivo"
                className="mt-2 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500"
              />
            )}
          </section>

          {reason !== "" && (
            <section className="border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Qual foi o resultado da análise?</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {ACCOUNT_REVIEW_OUTCOMES.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOutcome(o)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${
                      outcome === o
                        ? "border-brand bg-brand/10"
                        : "border-border hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span className="font-medium text-foreground">{ACCOUNT_REVIEW_OUTCOME_LABEL[o]}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {ACCOUNT_REVIEW_OUTCOME_DESCRIPTION[o]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {outcome === "NO_CHANGE" && (
            <section className="border-t border-border pt-4">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Observação <span className="text-xs text-muted-foreground">(opcional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </label>
            </section>
          )}

          {outcome === "OPTIMIZATION_PERFORMED" && (
            <section className="border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Quais otimizações foram realizadas?</p>
              <div className="mt-2 flex flex-col gap-3">
                {optimizations.map((opt, index) => (
                  <div key={index} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Otimização {index + 1}
                      </span>
                      {optimizations.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeOptimization(index)}
                          className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Tipo
                        <select
                          value={opt.type}
                          onChange={(e) => {
                            const type = e.target.value as OptimizationDraft["type"];
                            updateOptimization(index, { type, action: OPTIMIZATION_ACTIONS_BY_TYPE[type][0] });
                          }}
                          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                        >
                          {OPTIMIZATION_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {OPTIMIZATION_TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Ação realizada
                        <select
                          value={opt.action}
                          onChange={(e) => updateOptimization(index, { action: e.target.value })}
                          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                        >
                          {OPTIMIZATION_ACTIONS_BY_TYPE[opt.type].map((a) => (
                            <option key={a} value={a}>
                              {OPTIMIZATION_ACTION_LABEL[a] ?? a}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
                      O que foi feito? <span className="text-muted-foreground/70">(opcional)</span>
                      <input
                        value={opt.description}
                        onChange={(e) => updateOptimization(index, { description: e.target.value })}
                        className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                    <label className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
                      Por que? <span className="text-muted-foreground/70">(opcional)</span>
                      <input
                        value={opt.reason}
                        onChange={(e) => updateOptimization(index, { reason: e.target.value })}
                        className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                    <label className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
                      Resultado esperado? <span className="text-muted-foreground/70">(opcional)</span>
                      <input
                        value={opt.expectedImpact}
                        onChange={(e) => updateOptimization(index, { expectedImpact: e.target.value })}
                        className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addOptimization}
                className="mt-2 text-xs font-medium text-brand hover:underline"
              >
                + Adicionar outra otimização
              </button>
            </section>
          )}

          {outcome === "ISSUE_IDENTIFIED" && (
            <section className="border-t border-border pt-4">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Descrição do problema <span className="text-red-500">*</span>
                <textarea
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  rows={2}
                  required
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </label>
              <label className="mt-2 flex flex-col gap-1 text-sm text-foreground">
                Categoria <span className="text-xs text-muted-foreground">(opcional)</span>
                <input
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={createTask} onChange={(e) => setCreateTask(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Criar tarefa a partir desta pendência
              </label>
              {createTask && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Responsável
                    <select
                      value={taskResponsibleId}
                      onChange={(e) => setTaskResponsibleId(e.target.value)}
                      className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="">Sem responsável definido</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Prazo sugerido
                    <input
                      type="date"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                      className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                    />
                  </label>
                </div>
              )}
            </section>
          )}

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Salvar análise
            </button>
            <Link
              href={closeHref}
              scroll={false}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
