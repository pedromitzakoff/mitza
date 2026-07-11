import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import { resolveMonthPeriodSummary, computeRitmoDiff } from "@/lib/financial-period";
import { SprintCard } from "@/app/clients/sprint-card";

const ACTIVITY_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
};

/** Mesmo texto de ritmo usado em SprintFinancialBar (sprint), aqui reaplicado
 * ao período mensal — nunca compara o realizado com 100% do orçamento antes
 * do mês acabar, sempre com o esperado até a data observada. */
function ritmoText(status: "dentro" | "acima" | "abaixo" | "sem_meta", diffPct: number): string | null {
  if (status === "acima") return `${Math.round(diffPct)} p.p. acima do ritmo`;
  if (status === "abaixo") return `${Math.round(diffPct)} p.p. abaixo do ritmo`;
  if (status === "dentro") return "Dentro do ritmo esperado";
  return null;
}

/**
 * Grupo por cliente na visão "Mensal" da tela Sprints (Etapa 42) — cabeçalho
 * recolhido com o resumo mensal do cliente (orçamento/realizado/%/esperado/
 * ritmo — nunca os valores de uma sprint específica, ver seção 8 do pedido);
 * ao expandir, mostra as sprints do mês usando o mesmo `SprintCard` da
 * página individual do cliente, cada uma começando recolhida por sua vez
 * (dois níveis aqui fazem sentido: um controla "ver as sprints deste
 * cliente", outro controla "ver o detalhe desta sprint específica" — não é
 * a mesma informação duas vezes). Alertas só aparecem dentro do SprintCard
 * da sprint atual (quando ela está neste mês) — não duplicados aqui no
 * resumo, seguindo a mesma regra de "um local só" da visão Sprint atual.
 */
export function SprintMonthlyClientGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
  isAdmin,
  returnTo,
  sprintCommentsById,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  isAdmin: boolean;
  returnTo: string;
  sprintCommentsById: Map<string, CommentItem[]>;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const expectedPct = summary.planned > 0 ? (summary.expectedToDate / summary.planned) * 100 : 0;
  const diffPct = Math.abs((summary.pct ?? 0) - expectedPct);
  const activityLabel = card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel;

  return (
    <details className="group/client rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground transition-transform group-open/client:rotate-90">
          ▸
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <Link href={`/clients/${card.clientId}`} className="font-bold text-foreground hover:underline">
              {card.clientName}
            </Link>
            {primaryManagerName && (
              <span className="shrink-0 text-xs text-muted-foreground">{primaryManagerName}</span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">{monthLabel}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(summary.actual)} / {formatCurrency(summary.planned)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {summary.pct !== null ? `${Math.round(summary.pct)}% realizado no mês` : "Sem orçamento mensal"}
            </span>
            {summary.planned > 0 && (
              <span className="tabular-nums text-muted-foreground">
                Esperado até hoje no mês: {Math.round(expectedPct)}%
              </span>
            )}
            <span className={ACTIVITY_TEXT_CLASSES[card.activityStatus]}>Última atividade: {activityLabel}</span>
          </div>

          {summary.planned > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ritmoText(summary.status, diffPct)}
              {" · "}
              Diferença pro ritmo esperado no mês: {formatCurrency(diff)}
            </p>
          )}
        </div>
      </summary>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        {card.monthSprints.length > 0 ? (
          card.monthSprints.map((sprint, index) => {
            const isCurrent = sprint.temporalStatus === "atual";
            return (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                sprintNumber={index + 1}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={card.clientId}
                isAdmin={isAdmin}
                tasks={card.monthSprintTasks[sprint.sprintId] ?? []}
                executionLabel={isCurrent ? card.sprintExecutionLabel : null}
                executionSeverity={isCurrent ? (card.sprintExecutionInfo?.severity ?? null) : null}
                alerts={isCurrent ? card.alerts : undefined}
                defaultOpen={false}
                openClientHref={`/clients/${card.clientId}`}
                buildTaskHref={(taskId) => `${returnTo}&task=${taskId}`}
              />
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma sprint neste mês.</p>
        )}
      </div>
    </details>
  );
}
