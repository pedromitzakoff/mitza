"use client";

import { useState } from "react";
import { ACCOUNT_REVIEW_DIAGNOSES, ACCOUNT_REVIEW_DIAGNOSIS_LABEL } from "@/lib/account-reviews";
import type { AccountReviewDiagnosis } from "@/lib/supabase/database.types";

/**
 * DIAGNÓSTICO por chips (Etapa "Histórico de Decisões Operacionais", seção
 * 3/6 do pedido) — seleção única, mesmo padrão visual/de estado autocontido
 * de `OptimizationQuickPicker` (estado próprio, grava num input hidden
 * `diagnosis`, o servidor sempre revalida contra `ACCOUNT_REVIEW_DIAGNOSES`
 * antes de confiar). Usado tanto pela revisão manual da conta
 * (`RecordAccountReviewDrawer`) quanto pela execução rápida da recorrência
 * "Otimização" (`RegisterExecutionForm`) — uma seleção só, dois formulários.
 */
export function DiagnosisPicker() {
  const [diagnosis, setDiagnosis] = useState<AccountReviewDiagnosis | "">("");

  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name="diagnosis" value={diagnosis} />
      <div className="flex flex-wrap gap-1.5">
        {ACCOUNT_REVIEW_DIAGNOSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDiagnosis(option)}
            aria-pressed={diagnosis === option}
            className={`mitza-pressable rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              diagnosis === option
                ? "border-brand bg-brand text-white"
                : "border-border text-muted-foreground hover:border-brand hover:text-brand"
            }`}
          >
            {ACCOUNT_REVIEW_DIAGNOSIS_LABEL[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
