"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import { shiftOperationMonth, type OperationTriageSummary } from "@/lib/operation-triage";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar, type OperationQuickFilter } from "./operation-filter-bar";

/**
 * Centro de Triagem da Operação (Etapa "Novo Conceito de Monitoramento
 * Operacional") — a pergunta que a tela responde: "quais clientes
 * precisam da minha atenção agora, e por quê?". Filtros e diagnósticos por
 * cliente vêm todos do Motor de Diagnóstico Único (`metric-diagnostics.ts`)
 * — nunca de um vocabulário subjetivo (Saudável/Atenção/Crítico). Ordenação
 * da fila continua vindo de `sortClientOperationalStates` (fora deste
 * componente), sem mudança nesta etapa.
 */
export function OperationTriageView({
  clients,
  monthParam,
  monthLastUpdatedLabel,
  summary,
}: {
  clients: ClientOperationalState[];
  monthParam: string;
  monthLastUpdatedLabel: string;
  summary: OperationTriageSummary;
}) {
  const [quickFilter, setQuickFilter] = useState<OperationQuickFilter>("todos");
  const [query, setQuery] = useState("");

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((card) => {
      if (quickFilter !== "todos" && !getActiveDiagnosticFilters(card.diagnostics).includes(quickFilter)) return false;
      if (normalizedQuery) {
        const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
        const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
        if (!matchesName && !matchesManager) return false;
      }
      return true;
    });
  }, [clients, quickFilter, query]);

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

      {/* Disclaimer de atualização no mobile: o mesmo texto já existe no
          cabeçalho (linha do mês), mas some de vista assim que a lista é
          rolada — numa lista longa de clientes, não há como saber de
          quando são os números sem voltar ao topo da página. Repete o
          mesmo valor (`monthLastUpdatedLabel`, nenhum dado novo) logo
          acima da lista, só no mobile; desktop não muda. */}
      <p className="rounded-md border border-border bg-zinc-50 px-3 py-1.5 text-[11px] text-muted-foreground dark:bg-zinc-900/40 sm:hidden">
        {monthLastUpdatedLabel}
      </p>

      {filteredClients.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {filteredClients.map((card) => (
            <li key={card.clientId}>
              <OperationClientCard card={card} />
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
