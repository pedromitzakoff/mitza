"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import {
  bandFromHealthStatus,
  shiftOperationMonth,
  type OperationClientCard as OperationClientCardData,
  type OperationTriageBand,
} from "@/lib/operation-triage";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar, type OperationBandFilter, type OperationDimensionFilter } from "./operation-filter-bar";

/**
 * Centro de Triagem da Operação (Etapa "Redesenho da Operação") — não é
 * um dashboard, é uma FILA DE TRABALHO. Um dashboard tenta mostrar tudo;
 * esta tela mostra primeiro quem exige ação (ordenação já resolvida pela
 * camada de domínio — `sortOperationClientCards`, nunca recalculada aqui)
 * e só depois o contexto (termômetros, motivo secundário). Por isso não
 * há nenhuma métrica agregada de agência nesta tela (isso já existe na
 * Visão Geral) — só a fila, seus filtros, e "abrir o cliente certo".
 */
export function OperationTriageView({
  clients,
  monthParam,
  monthLastUpdatedLabel,
  bandCounts,
  todayStr,
}: {
  clients: OperationClientCardData[];
  monthParam: string;
  monthLastUpdatedLabel: string;
  bandCounts: Record<OperationTriageBand, number>;
  todayStr: string;
}) {
  const [bandFilter, setBandFilter] = useState<OperationBandFilter>("todos");
  const [dimensionFilter, setDimensionFilter] = useState<OperationDimensionFilter>("todos");
  const [query, setQuery] = useState("");

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((card) => {
      if (bandFilter !== "todos" && bandFromHealthStatus(card.evaluation.healthStatus) !== bandFilter) return false;
      if (dimensionFilter !== "todos" && card.evaluation.dimensions[dimensionFilter].status === "nenhum") return false;
      if (normalizedQuery) {
        const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
        const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
        if (!matchesName && !matchesManager) return false;
      }
      return true;
    });
  }, [clients, bandFilter, dimensionFilter, query]);

  const totalCount = clients.length;
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
        bandCounts={bandCounts}
        totalCount={totalCount}
        bandFilter={bandFilter}
        onBandFilterChange={setBandFilter}
        dimensionFilter={dimensionFilter}
        onDimensionFilterChange={setDimensionFilter}
        query={query}
        onQueryChange={setQuery}
      />

      {filteredClients.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {filteredClients.map((card) => (
            <li key={card.clientId}>
              <OperationClientCard card={card} todayStr={todayStr} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {totalCount === 0 ? "Nenhum cliente ativo neste mês." : "Nenhum cliente encontrado com esse filtro."}
        </p>
      )}
    </div>
  );
}
