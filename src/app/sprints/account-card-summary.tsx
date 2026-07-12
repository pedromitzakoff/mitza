import Link from "next/link";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import { computeExpectedPct } from "@/lib/financial-period";
import type { OperationalSummary } from "@/lib/account-priority";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";

/** Rótulo compacto da situação financeira — mesma classificação central
 * (`SpendStatus`), só um texto na chave "ritmo" (em vez de "bateu meta"),
 * porque aqui o período costuma estar em andamento, nunca fechado. */
export const PERIOD_STATUS_LABEL: Record<FinancialPeriodSummary["status"], string> = {
  dentro: "No ritmo",
  acima: "Acima do ritmo",
  abaixo: "Abaixo do ritmo",
  sem_meta: "Sem planejamento",
};

const OPERATIONAL_TONE_CLASSES = {
  critical: "font-medium text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  neutral: "text-muted-foreground",
} as const;

/**
 * Resumo fechado único de uma conta na tela Sprints (Etapa 44) — reaproveitado
 * pelas três visões (Sprint atual, Mensal Consolidado, Mensal Por sprints),
 * só trocando o período (`summary`, já resolvido por `resolveSprintPeriodSummary`/
 * `resolveMonthPeriodSummary`) e o texto operacional (`operational`, já
 * decidido por `operationalSummary`). Regra "card fechado = decisão": nome,
 * período, % investido, % esperado, situação financeira, UMA informação
 * operacional e a barra com marcador — nada de lista de alertas, diferença em
 * reais, ou contagem de tarefas concluídas aqui (isso fica no card aberto).
 */
export function AccountCardSummary({
  clientId,
  clientName,
  managerName,
  periodLabel,
  summary,
  operational,
}: {
  clientId: string;
  clientName: string;
  managerName: string | null;
  periodLabel: string;
  summary: FinancialPeriodSummary;
  operational: OperationalSummary;
}) {
  const investedPct = summary.pct !== null ? Math.round(summary.pct) : null;
  const expectedPct = summary.planned > 0 ? Math.round(computeExpectedPct(summary)) : null;

  return (
    <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">
        ▸
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <Link href={`/clients/${clientId}`} className="font-semibold text-foreground hover:underline">
            {clientName}
          </Link>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {managerName && <span>{managerName}</span>}
            <span>{periodLabel}</span>
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {investedPct !== null ? (
            <>
              <span className="tabular-nums text-muted-foreground">{investedPct}% investido</span>
              {expectedPct !== null && (
                <span className="tabular-nums text-muted-foreground">Esperado {expectedPct}%</span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[summary.status]}`}
              >
                {PERIOD_STATUS_LABEL[summary.status]}
              </span>
            </>
          ) : (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Sem planejamento
            </span>
          )}
          <span className={OPERATIONAL_TONE_CLASSES[operational.tone]}>{operational.text}</span>
        </div>

        <div className="mt-1.5">
          {summary.planned > 0 ? (
            <AgencyInvestmentBar planned={summary.planned} actual={summary.actual} expectedToDate={summary.expectedToDate} />
          ) : (
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          )}
        </div>
      </div>
    </summary>
  );
}
