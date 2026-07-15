"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";
import { computeMonthlyBudgetPlan, type MonthlyBudgetPlanSprintInput } from "@/lib/monthly-budget";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { applyMonthlyBudgetChangeAction } from "./monthly-budget-actions";
import { useToast } from "@/app/toast-provider";

type BudgetScenario = "aumento" | "reducao_normal" | "reducao_abaixo_realizado";

const SCENARIO_CONFIRM_COPY: Record<BudgetScenario, string> = {
  aumento:
    "O orçamento vai aumentar. O que já foi investido não muda — só o saldo restante do mês é recalculado e redistribuído entre a sprint atual e as sprints futuras.",
  reducao_normal:
    "O orçamento vai diminuir. O que já foi investido não muda — só o saldo restante do mês é recalculado e redistribuído entre a sprint atual e as sprints futuras.",
  reducao_abaixo_realizado:
    "EXCEDENTE: o novo orçamento é menor do que o que já foi investido este mês. Não sobra saldo pra distribuir — nenhuma sprint atual ou futura recebe planejamento até o próximo ajuste, e o total investido vai ficar acima do novo valor informado. Não é um erro nem é bloqueado — é só o reflexo do que já foi gasto.",
};

const SCENARIO_LABEL: Record<BudgetScenario, string> = {
  aumento: "Aumento de orçamento",
  reducao_normal: "Redução de orçamento",
  reducao_abaixo_realizado: "Redução abaixo do já investido",
};

/**
 * Editor de orçamento mensal (Etapa 66) — a prévia usa exatamente
 * `computeMonthlyBudgetPlan`, a mesma função central que decide o
 * "planejamento restante" exibido em "Investimento do mês" e em cada
 * `SprintCard`, nunca uma segunda conta própria deste componente (o motivo
 * de existir `computeMonthlyBudgetRedistribution` antes desta etapa). O
 * "orçamento atual" (`currentMonthlyBudget`) e o "já investido"
 * (`monthActual`) vêm prontos de quem chama — nunca recalculados aqui a
 * partir de `sprint_planned_allocations`/`daily_spend`.
 */
export function MonthlyBudgetEditor({
  clientId,
  monthParam,
  monthLabel,
  sprints,
  monthRange,
  effectiveDate,
  currentMonthlyBudget,
  monthActual,
}: {
  clientId: string;
  monthParam: string;
  monthLabel: string;
  sprints: MonthlyBudgetPlanSprintInput[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string;
  currentMonthlyBudget: number;
  monthActual: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [display, setDisplay] = useState(() => formatMoneyDisplay(currentMonthlyBudget));
  const [reason, setReason] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, startApplyTransition] = useTransition();
  const { showToast } = useToast();
  const newBudget = parseMoneyInput(display) ?? 0;

  const currentPlan = useMemo(
    () => computeMonthlyBudgetPlan({ monthlyBudget: currentMonthlyBudget, monthActual, monthRange, effectiveDate, sprints }),
    [currentMonthlyBudget, monthActual, monthRange, effectiveDate, sprints],
  );
  const newPlan = useMemo(
    () => computeMonthlyBudgetPlan({ monthlyBudget: newBudget, monthActual, monthRange, effectiveDate, sprints }),
    [newBudget, monthActual, monthRange, effectiveDate, sprints],
  );

  const scenario: BudgetScenario =
    monthActual > newBudget ? "reducao_abaixo_realizado" : newBudget >= currentMonthlyBudget ? "aumento" : "reducao_normal";

  // Interaction Delight 1.0 — Focus Continuity: devolve o foco pro botão que
  // abriu o editor quando ele fecha (nunca no primeiro render, só na
  // transição true → false).
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        className="mitza-pressable text-xs font-medium text-brand hover:underline"
      >
        Editar orçamento
      </button>
    );
  }

  const close = () => {
    setIsOpen(false);
    setConfirmStep(false);
    setDisplay(formatMoneyDisplay(currentMonthlyBudget));
    setReason("");
    setApplyError(null);
  };

  function handleApply() {
    setApplyError(null);
    startApplyTransition(async () => {
      const result = await applyMonthlyBudgetChangeAction(clientId, monthParam, newBudget, reason.trim() || null);
      if (result.error) {
        setApplyError(result.error);
        return;
      }
      showToast("Orçamento do mês atualizado.");
      close();
    });
  }

  return (
    <>
      <div className="mitza-backdrop-in fixed inset-0 z-40 cursor-pointer bg-black/30" onClick={close} aria-hidden />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Orçamento de {monthLabel}</h2>
          <button
            type="button"
            onClick={close}
            className="mitza-pressable shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </button>
        </div>

        {!confirmStep ? (
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Novo orçamento do mês
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={display}
                  onChange={(event) => setDisplay(event.target.value)}
                  onBlur={() => setDisplay(formatMoneyDisplay(newBudget))}
                  autoFocus
                  className="w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Orçamento atual: {formatCurrency(currentMonthlyBudget)}
              </p>
            </div>

            <div className="rounded-md border border-border bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
              <p className="font-semibold text-foreground">Prévia do impacto</p>
              <dl className="mt-1.5 flex flex-col gap-1">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Já investido este mês</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(monthActual)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Saldo restante atual</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(currentPlan.remainingBudget)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Saldo restante novo</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(newPlan.remainingBudget)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1">
                  <dt className="font-medium text-foreground">Orçamento do mês</dt>
                  <dd className="tabular-nums font-medium text-foreground">{formatCurrency(newBudget)}</dd>
                </div>
              </dl>

              {newPlan.isBudgetReached && (
                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  {newPlan.overageAmount > 0
                    ? `Excedente: o que já foi investido é ${formatCurrency(newPlan.overageAmount)} maior que o novo orçamento. Nenhuma sprint recebe planejamento até o próximo ajuste.`
                    : "Orçamento exatamente atingido pelo que já foi investido. Nenhuma sprint recebe planejamento até o próximo ajuste."}
                </p>
              )}

              <p className="mt-2 font-medium text-foreground">Sprints afetadas</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {sprints.map((sprint) => (
                  <li key={sprint.sprintId} className="flex justify-between tabular-nums">
                    <span className="text-muted-foreground">
                      {formatSprintPeriodLabel(sprint.startDate, sprint.endDate)}
                    </span>
                    <span className="text-foreground">
                      {formatCurrency(currentPlan.sprintPlans.get(sprint.sprintId)?.remainingPlanned ?? 0)} →{" "}
                      {formatCurrency(newPlan.sprintPlans.get(sprint.sprintId)?.remainingPlanned ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(true)}
                className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={close}
                className="mitza-pressable text-sm text-muted-foreground hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-md border border-border bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
              <p className="font-semibold text-foreground">{SCENARIO_LABEL[scenario]}</p>
              <p className="mt-1 text-foreground">{SCENARIO_CONFIRM_COPY[scenario]}</p>
              <p className="mt-2 tabular-nums text-foreground">
                {formatCurrency(currentMonthlyBudget)} → {formatCurrency(newBudget)}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="budget-reason" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Motivo da alteração (opcional)
                </label>
                <textarea
                  id="budget-reason"
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Ex.: Cliente aprovou aumento de investimento para campanha promocional."
                  className="mt-1 w-full resize-none rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500 dark:bg-zinc-900"
                />
              </div>

              {applyError && (
                <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                  {applyError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={isApplying}
                  className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isApplying ? "Confirmando..." : "Confirmar alteração"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmStep(false)}
                  disabled={isApplying}
                  className="mitza-pressable text-sm text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
