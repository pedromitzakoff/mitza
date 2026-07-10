"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";
import {
  computeMonthlyBudgetRedistribution,
  type MonthlyBudgetScenario,
  type MonthlyBudgetSprintInput,
} from "@/lib/monthly-budget";
import { applyMonthlyBudgetChangeAction } from "./monthly-budget-actions";

const SCENARIO_CONFIRM_COPY: Record<MonthlyBudgetScenario, string> = {
  aumento:
    "O orçamento vai aumentar. O planejamento já consolidado até hoje não muda — só os dias futuros do mês recebem o novo saldo, distribuído igualmente entre eles.",
  reducao_normal:
    "O orçamento vai diminuir. O planejamento já consolidado até hoje não muda — só os dias futuros do mês são recalculados com o novo saldo, distribuído igualmente entre eles.",
  reducao_abaixo_consolidado:
    "EXCEDENTE HISTÓRICO: o novo orçamento é menor do que o que já foi consolidado até hoje. Nenhum dia futuro vai receber planejamento até o próximo ajuste, e o total do mês vai ficar acima do novo valor informado. Não é um erro nem é bloqueado — é só o reflexo do que já foi investido.",
};

const SCENARIO_LABEL: Record<MonthlyBudgetScenario, string> = {
  aumento: "Aumento de orçamento",
  reducao_normal: "Redução de orçamento",
  reducao_abaixo_consolidado: "Redução abaixo do consolidado",
};

export function MonthlyBudgetEditor({
  clientId,
  monthParam,
  monthLabel,
  sprints,
  currentAllocations,
  monthRange,
  effectiveDate,
}: {
  clientId: string;
  monthParam: string;
  monthLabel: string;
  sprints: (MonthlyBudgetSprintInput & { sprintNumber: number })[];
  currentAllocations: { date: string; amount: number }[];
  monthRange: { firstDay: string; lastDay: string };
  effectiveDate: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const previousTotal = useMemo(
    () => currentAllocations.reduce((sum, row) => sum + row.amount, 0),
    [currentAllocations],
  );
  const [display, setDisplay] = useState(() => formatMoneyDisplay(previousTotal));
  const newBudget = parseMoneyInput(display) ?? 0;

  const allocationsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of currentAllocations) map.set(row.date, row.amount);
    return map;
  }, [currentAllocations]);

  const preview = useMemo(
    () =>
      computeMonthlyBudgetRedistribution({
        sprints,
        currentAllocations: allocationsMap,
        monthRange,
        effectiveDate,
        newBudget,
      }),
    [sprints, allocationsMap, monthRange, effectiveDate, newBudget],
  );

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-xs font-medium text-brand hover:underline"
      >
        Editar orçamento
      </button>
    );
  }

  const close = () => {
    setIsOpen(false);
    setConfirmStep(false);
    setDisplay(formatMoneyDisplay(previousTotal));
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Orçamento de {monthLabel}</h2>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
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
                  className="w-full rounded-md border border-border px-2 py-1.5 text-sm text-foreground outline-none focus:border-zinc-500 dark:bg-zinc-900"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Orçamento atual: {formatCurrency(previousTotal)}
              </p>
            </div>

            <div className="rounded-md border border-border bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
              <p className="font-semibold text-foreground">Prévia do impacto</p>
              <dl className="mt-1.5 flex flex-col gap-1">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Planejamento preservado até hoje</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(preview.consolidatedAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Saldo futuro atual</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(preview.previousFutureAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Saldo futuro novo</dt>
                  <dd className="tabular-nums text-foreground">{formatCurrency(preview.futureBudgetAvailable)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1">
                  <dt className="font-medium text-foreground">Total do mês resultante</dt>
                  <dd className="tabular-nums font-medium text-foreground">{formatCurrency(preview.resultingTotal)}</dd>
                </div>
              </dl>

              {preview.isBelowConsolidated && (
                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  Excedente histórico: o consolidado até hoje já é maior que o novo orçamento. Nenhum dia futuro
                  recebe planejamento até o próximo ajuste.
                </p>
              )}

              <p className="mt-2 font-medium text-foreground">Sprints afetadas</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {preview.sprintPreviews.map((sprint, index) => (
                  <li key={sprint.sprintId} className="flex justify-between tabular-nums">
                    <span className="text-muted-foreground">Sprint {index + 1}</span>
                    <span className="text-foreground">
                      {formatCurrency(sprint.previousPlannedSpend)} → {formatCurrency(sprint.newPlannedSpend)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(true)}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={close}
                className="text-sm text-muted-foreground hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-md border border-border bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
              <p className="font-semibold text-foreground">{SCENARIO_LABEL[preview.scenario]}</p>
              <p className="mt-1 text-foreground">{SCENARIO_CONFIRM_COPY[preview.scenario]}</p>
              <p className="mt-2 tabular-nums text-foreground">
                {formatCurrency(previousTotal)} → {formatCurrency(newBudget)}
              </p>
            </div>

            <form
              action={applyMonthlyBudgetChangeAction.bind(null, clientId, monthParam)}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="new_budget" value={newBudget} />
              <button
                type="submit"
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Confirmar alteração
              </button>
              <button
                type="button"
                onClick={() => setConfirmStep(false)}
                className="text-sm text-muted-foreground hover:underline"
              >
                Voltar
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
