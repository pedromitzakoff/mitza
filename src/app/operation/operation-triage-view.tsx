"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import { shiftOperationMonth, type OperationTriageSummary } from "@/lib/operation-triage";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar, type OperationQuickFilter } from "./operation-filter-bar";

/**
 * Centro de Triagem da Operação (Etapa "Fila de Prioridades 1.0") — não é
 * um dashboard, é uma FILA DE TRABALHO. Um dashboard tenta mostrar tudo;
 * esta tela mostra primeiro quem exige ação (ordenação já resolvida pela
 * camada de domínio — `sortClientOperationalStates`, nunca recalculada
 * aqui) e só depois o estado atual da conta (investimento, resultado,
 * custo). Nenhuma comparação planejado-vs-realizado, tendência ou selo de
 * severidade aparece mais nesta tela — isso continua existindo na página
 * do cliente, que é onde a análise detalhada acontece.
 */
export function OperationTriageView({
  clients,
  monthParam,
  monthLastUpdatedLabel,
  summary,
  todayStr,
  pendingReportClientIds,
}: {
  clients: ClientOperationalState[];
  monthParam: string;
  monthLastUpdatedLabel: string;
  summary: OperationTriageSummary;
  todayStr: string;
  /** Clientes com relatório mensal ainda não finalizado (Etapa "MITZA 2.0 —
   * Fase G") — array (não Set) porque cruza a fronteira Server→Client
   * Component; convertido pra Set aqui só pra consulta O(1). */
  pendingReportClientIds: string[];
}) {
  const [quickFilter, setQuickFilter] = useState<OperationQuickFilter>("todos");
  const [query, setQuery] = useState("");
  const pendingReportSet = useMemo(() => new Set(pendingReportClientIds), [pendingReportClientIds]);

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((card) => {
      if (quickFilter === "pendencias" && card.overdueTasksCount === 0) return false;
      if (quickFilter === "revisoes") {
        const review = card.evaluation.dimensions.review;
        if (!(review.enabled && review.status !== "nenhum")) return false;
      }
      if (quickFilter === "sem_sincronizacao" && card.evaluation.dimensions.investment.hasSyncedData) return false;
      if (quickFilter === "relatorio_pendente" && !pendingReportSet.has(card.clientId)) return false;
      if (normalizedQuery) {
        const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
        const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
        if (!matchesName && !matchesManager) return false;
      }
      return true;
    });
  }, [clients, quickFilter, query, pendingReportSet]);

  const prevMonthHref = `/operation?month=${shiftOperationMonth(monthParam, -1)}`;
  const nextMonthHref = `/operation?month=${shiftOperationMonth(monthParam, 1)}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operação</h1>
          <p className="text-sm text-muted-foreground">
            Qual cliente merece sua atenção agora, e por quê.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={prevMonthHref}
            aria-label="Mês anterior"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ‹
          </Link>
          <span className="min-w-32 text-center text-sm font-medium text-foreground">{formatMonthLabel(monthParam)}</span>
          <Link
            href={nextMonthHref}
            aria-label="Próximo mês"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ›
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">{monthLastUpdatedLabel}</span>
        </div>
      </div>

      <OperationFilterBar
        summary={summary}
        quickFilter={quickFilter}
        onQuickFilterChange={setQuickFilter}
        query={query}
        onQueryChange={setQuery}
      />

      {filteredClients.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {filteredClients.map((card) => (
            <li key={card.clientId}>
              <OperationClientCard card={card} todayStr={todayStr} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {summary.totalClients === 0 ? "Nenhum cliente ativo neste mês." : "Nenhum cliente encontrado com esse filtro."}
        </p>
      )}
    </div>
  );
}
