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
 * decidido por `operationalSummary`).
 *
 * Etapa "Painel Operacional 1.0" (aproximação de UX a partir de uma segunda
 * referência visual — painel operacional denso): revisa a Decisão 009
 * ("card fechado também mostra tarefas e otimizações"). A situação
 * financeira deixou de ter coluna própria — agora é um selo dentro da
 * própria célula de Investimento (as duas respondem "como está o dinheiro
 * desta conta?", nunca precisaram de duas colunas). Tarefas e Otimizações
 * (2 colunas) viraram "Progresso" (1 coluna: barra + fração de tarefas
 * concluídas) — a contagem de otimizações saiu da leitura de 3 segundos:
 * ela não muda uma decisão imediata da mesma forma que "tem trabalho
 * pendente?" muda, e continua disponível um nível abaixo (dentro da
 * própria Sprint) pra quem quiser investigar. Ver Decisão 020 em
 * `docs/DECISIONS.md` (supersede parcialmente a 009).
 *
 * Sprint UX 2.0 Fase 2 (Decisão 011: "Sprint é uma árvore operacional" — a
 * mesma lógica de densidade vale pro cliente): o card fechado do cliente é
 * uma ÚNICA linha. O marcador de "esperado até hoje" e a legenda de cores
 * da barra somem do card fechado (`showExpectedMarker=false
 * showLegend=false` — nenhuma conta muda, só a apresentação): essa
 * informação continua disponível no card aberto. O texto operacional só
 * aparece quando não é neutro ("Em dia" some — já é o que o selo de
 * status comunica; só atenção/crítico aparecem).
 */
export function AccountCardSummary({
  clientId,
  clientName,
  managerName,
  summary,
  operational,
  tasksDone,
  tasksTotal,
}: {
  clientId: string;
  clientName: string;
  managerName: string | null;
  summary: FinancialPeriodSummary;
  operational: OperationalSummary;
  /** Etapa 68, seção 16 — mantido por compatibilidade de chamada; não é
   * mais repassado à barra (Fase 2 sempre usa a versão sem marcador no card
   * fechado), mas os chamadores continuam podendo passar sem erro. */
  monthTemporalStatus?: MonthTemporalStatus;
  /** Tarefas do período em foco (sprint atual ou mês, conforme a visão) —
   * alimenta a coluna "Progresso" (barra + fração). `tasksTotal` 0 mostra
   * "—" (nada a progredir), nunca "0/0". */
  tasksDone?: number;
  tasksTotal?: number;
}) {
  const investedPct = summary.pct !== null ? Math.round(summary.pct) : null;
  const progressPct = tasksTotal && tasksTotal > 0 ? ((tasksDone ?? 0) / tasksTotal) * 100 : null;

  const statusBadge = investedPct !== null && (
    <span
      className={`mt-0.5 block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES[summary.status]}`}
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
          {managerName && <span className="text-muted-foreground">· {managerName}</span>}
          {investedPct !== null ? (
            <>
              <span className="tabular-nums text-muted-foreground">{investedPct}% investido</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES[summary.status]}`}>
                {PERIOD_STATUS_LABEL[summary.status]}
              </span>
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
            {/* Etapa "Sprint Workspace MVP Finalization 2.0" (Parte 1):
                cliente e gestor na mesma linha — antes eram 2 linhas
                empilhadas (nome + gestor embaixo), agora "Cliente · Gestor"
                truncando junto como uma frase só (nunca dois truncamentos
                independentes brigando por espaço). O peso visual
                permanece diferente (nome em negrito, gestor discreto) só
                que lado a lado. `title` cobre o texto completo quando
                truncar. */}
            <p
              className="truncate text-sm"
              title={managerName ? `${clientName} · ${managerName}` : clientName}
            >
              <Link href={`/clients/${clientId}`} className="font-semibold text-foreground hover:underline">
                {clientName}
              </Link>
              {managerName && <span className="text-[11px] font-normal text-muted-foreground"> · {managerName}</span>}
            </p>
          </div>

          <div className="min-w-0">
            {investedPct !== null ? (
              <>
                <p className="truncate text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(summary.actual)} / {formatCurrency(summary.planned)}
                </p>
                <div className="mt-0.5">
                  <AgencyInvestmentBar summary={summary} showExpectedMarker={false} showLegend={false} />
                </div>
                {statusBadge}
              </>
            ) : (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SPEND_STATUS_BADGE_CLASSES.sem_meta}`}>
                Sem planejamento
              </span>
            )}
          </div>

          <div className="min-w-0">
            {progressPct !== null ? (
              <>
                <span className="truncate text-xs tabular-nums text-muted-foreground">
                  {tasksDone ?? 0}/{tasksTotal}
                </span>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="truncate text-xs text-muted-foreground">—</span>
            )}
          </div>
        </div>

        {operational.tone !== "neutral" && (
          <p className={`mt-0.5 text-xs ${OPERATIONAL_TONE_CLASSES[operational.tone]}`}>{operational.text}</p>
        )}
      </div>
    </summary>
  );
}
