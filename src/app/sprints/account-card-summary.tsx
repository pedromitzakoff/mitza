import Link from "next/link";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import type { OperationalSummary } from "@/lib/account-priority";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { formatCurrency } from "@/lib/format";
import { ROW_GRID_CLASSES } from "./row-grid";

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
 *
 * Sprint UX 2.0 Fase 3 (aproximação de UX/densidade a partir de uma
 * referência visual): a linha deixou de ser texto corrido com "·" entre os
 * itens (frase) e virou colunas de verdade (`ROW_GRID_CLASSES`, compartilhado
 * com a linha da sprint em `sprint-card.tsx`) — Cliente/Gestor, Período,
 * Investimento, Tarefas, Otimizações e Status sempre na mesma posição
 * horizontal, em qualquer linha da lista. Isso permite "leitura vertical":
 * bater o olho numa coluna (ex.: Status) e escanear todos os clientes de
 * uma vez, sem depender de quanto texto cada linha tem. A célula de
 * Investimento passou a mostrar Realizado/Planejado em R$ (antes só o %) —
 * cabe numa coluna estreita sem virar "diferença em reais" (não é um delta,
 * são os dois valores brutos, a mesma informação que já existia em % só que
 * também em R$).
 *
 * Etapa "Sprint Workspace Density 1.0": padding do cabeçalho reduzido
 * (`px-2.5 py-1.5` → `px-2 py-1`) — mesma área de clique (o `<summary>`
 * continua ocupando a linha inteira), só menos espaço morto ao redor do
 * conteúdo.
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

  const statusBadge = investedPct !== null && (
    <span
      className={`block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES[summary.status]}`}
    >
      {PERIOD_STATUS_LABEL[summary.status]}
    </span>
  );

  return (
    <summary className="flex cursor-pointer list-none items-start gap-2 px-2 py-1">
      <span className="mitza-chevron mt-0.5 shrink-0 text-xs text-muted-foreground group-open:rotate-90">
        ▸
      </span>

      <div className="min-w-0 flex-1">
        {/* Mobile (< sm): texto corrido, mesma linguagem da Fase 2 — a grade
            de colunas da Fase 3 só faz sentido com largura de desktop; abaixo
            de `sm` ela ficaria espremida demais (Princípios Cap. 7: "Desktop
            primeiro... Mobile prioriza consultas/pequenas ações"). */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs sm:hidden">
          <Link href={`/clients/${clientId}`} className="text-sm font-semibold text-foreground hover:underline">
            {clientName}
          </Link>
          {managerName && <span className="text-muted-foreground">{managerName}</span>}
          <span className="text-muted-foreground">{periodLabel}</span>
          {investedPct !== null ? (
            <>
              <span className="tabular-nums text-muted-foreground">{investedPct}% investido</span>
              {statusBadge}
            </>
          ) : (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES.sem_meta}`}>
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
        </div>
        <div className="mt-1 sm:hidden">
          {summary.planned > 0 ? (
            <AgencyInvestmentBar summary={summary} showExpectedMarker={false} showLegend={false} />
          ) : (
            <div className="h-1 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          )}
        </div>

        {/* Desktop (sm+): colunas de verdade — mesmo grid da linha da sprint
            (`ROW_GRID_CLASSES`), pra a árvore Cliente → Sprint parecer uma
            única tabela contínua (ver doc do componente acima). */}
        <div className={`px-0 ${ROW_GRID_CLASSES}`}>
          <span aria-hidden="true" />
          <div className="min-w-0">
            <Link
              href={`/clients/${clientId}`}
              className="block truncate text-sm font-semibold text-foreground hover:underline"
            >
              {clientName}
            </Link>
            {managerName && <p className="truncate text-[11px] text-muted-foreground">{managerName}</p>}
          </div>

          <span className="truncate text-xs text-muted-foreground">{periodLabel}</span>

          <div className="min-w-0">
            {investedPct !== null ? (
              <>
                <p className="truncate text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(summary.actual)} / {formatCurrency(summary.planned)}
                </p>
                <div className="mt-0.5">
                  <AgencyInvestmentBar summary={summary} showExpectedMarker={false} showLegend={false} />
                </div>
              </>
            ) : (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES.sem_meta}`}>
                Sem planejamento
              </span>
            )}
          </div>

          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {tasksTotal !== undefined ? (tasksTotal === 0 ? "—" : `${tasksDone ?? 0}/${tasksTotal}`) : ""}
          </span>

          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {optimizationCount !== undefined ? (optimizationCount === 0 ? "—" : optimizationCount) : ""}
          </span>

          <div className="min-w-0">{statusBadge}</div>
        </div>

        {operational.tone !== "neutral" && (
          <p className={`mt-0.5 text-xs ${OPERATIONAL_TONE_CLASSES[operational.tone]}`}>{operational.text}</p>
        )}
      </div>
    </summary>
  );
}
