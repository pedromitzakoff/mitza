"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import {
  shiftOperationMonth,
  groupClientsByOperationPriority,
  resolveOperationPriorityGroup,
  type OperationTriageSummary,
  type OperationPriorityGroup,
} from "@/lib/operation-triage";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar, type OperationQuickFilter } from "./operation-filter-bar";

/** Plural/gramática de seção — mesmo rótulo de `PRIORITY_GROUP_LABEL`
 * (operation-client-card.tsx) só ajustado pro cabeçalho de grupo em vez do
 * selo de linha ("Crítico" na linha, "Críticas" separando o grupo). Nenhum
 * balde novo, só o texto do divisor. */
const PRIORITY_GROUP_SECTION_LABEL: Record<OperationPriorityGroup, string> = {
  critico: "Críticas",
  atencao: "Atenção",
  saudavel: "Saudáveis",
  sem_dados: "Sem dados",
};

/**
 * Centro de Triagem da Operação (Etapa "Central de Decisão Diária") —
 * pergunta que a tela responde: "qual conta merece minha atenção agora, e
 * por quê". A fila é reagrupada (`groupClientsByOperationPriority`) por
 * Crítico → Atenção → Saudável → Sem dados — 100% derivado do
 * `evaluation`/Motor de Saúde da Conta que `sortClientOperationalStates` já
 * calcula (fora deste componente); os filtros rápidos do topo continuam
 * vindo do Motor de Diagnóstico Único (`metric-diagnostics.ts`, preservados
 * desta etapa — ver `OperationFilterBar`), já que respondem uma pergunta
 * diferente ("qual EIXO está fora do esperado", não "qual a gravidade
 * geral"). As duas classificações convivem: o quick filter reduz a lista,
 * o agrupamento decide a ordem/os divisores dentro do que sobrou.
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
  const [managerFilter, setManagerFilter] = useState<string>("todos");
  const [query, setQuery] = useState("");

  const groupedClients = useMemo(() => groupClientsByOperationPriority(clients), [clients]);

  // Lista de gestores pra filtro (Etapa "Central de Decisão Diária", item
  // "Filtros adicionais") — derivada dos próprios clientes já carregados,
  // nenhuma consulta nova: só gestores que de fato têm conta ativa neste
  // mês aparecem, nunca a lista cheia de gestores da agência.
  const managers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const card of clients) {
      if (card.managerId && card.managerName) byId.set(card.managerId, card.managerName);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return groupedClients.filter((card) => {
      if (quickFilter !== "todos" && !getActiveDiagnosticFilters(card.diagnostics).includes(quickFilter)) return false;
      if (managerFilter !== "todos" && card.managerId !== managerFilter) return false;
      if (normalizedQuery) {
        const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
        const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
        if (!matchesName && !matchesManager) return false;
      }
      return true;
    });
  }, [groupedClients, quickFilter, managerFilter, query]);

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
        managers={managers}
        managerFilter={managerFilter}
        onManagerFilterChange={setManagerFilter}
      />

      {filteredClients.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {filteredClients.map((card, index) => {
            const group = resolveOperationPriorityGroup(card.evaluation);
            const previousGroup = index > 0 ? resolveOperationPriorityGroup(filteredClients[index - 1].evaluation) : null;
            const showDivider = group !== previousGroup;
            return (
              <li key={card.clientId}>
                {showDivider && (
                  <p
                    className={`px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted ${index > 0 ? "pt-3" : ""}`}
                  >
                    {PRIORITY_GROUP_SECTION_LABEL[group]}
                  </p>
                )}
                <OperationClientCard card={card} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {summary.totalClients === 0 ? "Nenhum cliente ativo neste mês." : "Nenhum cliente encontrado com esse filtro."}
        </p>
      )}
    </div>
  );
}
