import Link from "next/link";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
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
 * período, % investido, situação financeira, UMA informação operacional,
 * tarefas e otimizações do período (Decisão 009) — nunca lista de alertas
 * nem diferença em reais aqui (isso fica no card aberto).
 *
 * Sprint UX 2.0 Fase 2 (Decisão 011: "Sprint é uma árvore operacional" — a
 * mesma lógica de densidade vale pro cliente): o card fechado do cliente
 * virou uma ÚNICA linha (antes eram 4 linhas empilhadas — nome/período,
 * %/status, tarefas/otimizações, barra). O marcador de "esperado até hoje" e
 * a legenda de cores da barra somem do card fechado (viram um sliver de 1
 * linha, `showExpectedMarker=false showLegend=false` — nenhuma conta muda,
 * só a apresentação): essa informação continua disponível no card aberto
 * (`Diferença pro ritmo esperado`/`MonthInvestmentSummary`). O texto
 * operacional só aparece quando não é neutro ("Em dia" some — já é o que o
 * badge de status comunica; só atenção/crítico aparecem, pra não repetir
 * informação em toda linha saudável).
 */
export function AccountCardSummary({
  clientId,
  clientName,
  managerName,
  periodLabel,
  summary,
  operational,
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
  /** Etapa 68, seção 16 — mantido por compatibilidade de chamada; não é
   * mais repassado à barra (Fase 2 sempre usa a versão sem marcador no card
   * fechado), mas os chamadores continuam podendo passar sem erro. */
  monthTemporalStatus?: MonthTemporalStatus;
  /** Tarefas do período em foco (sprint atual ou mês, conforme a visão) —
   * `tasksTotal` 0 mostra "Sem tarefas no período" em vez de "0/0 tarefas". */
  tasksDone?: number;
  tasksTotal?: number;
  /** Otimizações registradas (account_reviews) no período em foco. */
  optimizationCount?: number;
}) {
  const investedPct = summary.pct !== null ? Math.round(summary.pct) : null;

  return (
    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">▸</span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
          <Link
            href={`/clients/${clientId}`}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            {clientName}
          </Link>
          {managerName && <span className="text-muted-foreground">{managerName}</span>}
          <span className="text-muted-foreground">{periodLabel}</span>

          {investedPct !== null ? (
            <>
              <span className="tabular-nums text-muted-foreground">{investedPct}% investido</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES[summary.status]}`}
              >
                {PERIOD_STATUS_LABEL[summary.status]}
              </span>
            </>
          ) : (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Sem planejamento
            </span>
          )}

          {tasksTotal !== undefined && (
            <span className="tabular-nums text-muted-foreground">
              {tasksTotal === 0 ? "Sem tarefas no período" : `${tasksDone ?? 0}/${tasksTotal} tarefas`}
            </span>
          )}
          {optimizationCount !== undefined && (
            <span className="tabular-nums text-muted-foreground">
              {optimizationCount === 0
                ? "Sem otimizações no período"
                : `${optimizationCount} otimizaç${optimizationCount === 1 ? "ão" : "ões"}`}
            </span>
          )}
          {operational.tone !== "neutral" && (
            <span className={OPERATIONAL_TONE_CLASSES[operational.tone]}>{operational.text}</span>
          )}
        </div>

        <div className="mt-1">
          {summary.planned > 0 ? (
            <AgencyInvestmentBar summary={summary} showExpectedMarker={false} showLegend={false} />
          ) : (
            <div className="h-1 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          )}
        </div>
      </div>
    </summary>
  );
}
