import Link from "next/link";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import { computeExpectedPct } from "@/lib/financial-period";
import type { OperationalSummary } from "@/lib/account-priority";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";

/** Rótulo compacto da situação financeira — mesma classificação central
 * (`SpendStatus`), só um texto na chave "ritmo" (em vez de "bateu meta"),
 * porque aqui o período costuma estar em andamento, nunca fechado. */
export const PERIOD_STATUS_LABEL: Record<FinancialPeriodSummary["status"], string> = {
  dentro: "No ritmo",
  acima: "Acima do ritmo",
  abaixo: "Abaixo do ritmo",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
  em_andamento: "Em andamento",
};

const OPERATIONAL_TONE_CLASSES = {
  critical: "font-medium text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  neutral: "text-muted-foreground",
} as const;

/**
 * Resumo fechado único de uma conta na tela Sprints — reaproveitado pelas
 * três visões (Sprint atual, Mensal Consolidado, Mensal Por sprints), só
 * trocando o período (`summary`, já resolvido por `resolveSprintPeriodSummary`/
 * `resolveMonthPeriodSummary`) e o texto operacional (`operational`, já
 * decidido por `operationalSummary`). Regra "card fechado = decisão": nome,
 * período, % investido, situação financeira, UMA informação operacional e a
 * barra — nunca lista de alertas nem diferença em reais aqui (isso fica no
 * card aberto).
 *
 * Sprint UX 2.0 (Decisão 009, docs/DECISIONS.md): a regra acima foi ajustada
 * pra incluir tarefas pendentes/concluídas e contagem de otimizações do
 * período — o gestor precisa dessas duas contagens pra decidir onde agir sem
 * precisar expandir até a sprint. `tasksTotal`/`optimizationCount` são
 * opcionais só por retrocompatibilidade de tipo; todo chamador real desta
 * etapa em diante sempre os informa.
 *
 * Etapa 67, seção 7: quando `summary.kind === "sprint"` (visão "Sprint
 * atual"), nunca mostra "Esperado X%" nem o marcador da barra — a sprint
 * atual não tem mais nenhum veredito de ritmo (o `summary.status` já vem
 * como "em_andamento" de `classifySprintSpendStatus`, nunca Acima/Abaixo).
 * A visão "Mensal Consolidado" (`summary.kind === "month"`) continua
 * mostrando o esperado e o marcador normalmente, agora com a fórmula central
 * de calendário (`computeMonthlyExpectedToDateByCalendar`).
 */
export function AccountCardSummary({
  clientId,
  clientName,
  managerName,
  periodLabel,
  summary,
  operational,
  monthTemporalStatus,
  tasksDone,
  tasksTotal,
  optimizationCount,
}: {
  clientId: string;
  clientName: string;
  managerName: string | null;
  periodLabel: string;
  summary: FinancialPeriodSummary;
  operational: OperationalSummary;
  /** Etapa 68, seção 16 — só relevante pra `summary.kind === "month"`
   * (Mensal Consolidado): troca o texto do marcador quando o mês navegado
   * não é o corrente. `undefined` = mês corrente. */
  monthTemporalStatus?: MonthTemporalStatus;
  /** Tarefas do período em foco (sprint atual ou mês, conforme a visão) —
   * `tasksTotal` 0 mostra "Sem tarefas no período" em vez de "0/0 tarefas". */
  tasksDone?: number;
  tasksTotal?: number;
  /** Otimizações registradas (account_reviews) no período em foco. */
  optimizationCount?: number;
}) {
  const isSprintKind = summary.kind === "sprint";
  const investedPct = summary.pct !== null ? Math.round(summary.pct) : null;
  const expectedPct = !isSprintKind && summary.planned > 0 ? Math.round(computeExpectedPct(summary)) : null;

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

        {(tasksTotal !== undefined || optimizationCount !== undefined) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {tasksTotal !== undefined && (
              <span className="tabular-nums">
                {tasksTotal === 0 ? "Sem tarefas no período" : `${tasksDone ?? 0}/${tasksTotal} tarefas`}
              </span>
            )}
            {optimizationCount !== undefined && (
              <span className="tabular-nums">
                {optimizationCount === 0
                  ? "Sem otimizações no período"
                  : `${optimizationCount} otimizaç${optimizationCount === 1 ? "ão" : "ões"}`}
              </span>
            )}
          </div>
        )}

        <div className="mt-1.5">
          {summary.planned > 0 ? (
            <AgencyInvestmentBar
              summary={summary}
              showExpectedMarker={!isSprintKind}
              monthTemporalStatus={isSprintKind ? undefined : monthTemporalStatus}
            />
          ) : (
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          )}
        </div>
      </div>
    </summary>
  );
}
