"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import {
  shiftOperationMonth,
  groupClientsByOperationPriority,
  resolveOperationPriorityGroup,
  filterOperationTriageClients,
  type OperationTriageSummary,
  type OperationPriorityGroup,
  type OperationQuickFilter,
} from "@/lib/operation-triage";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar } from "./operation-filter-bar";

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

/** Forma adjetiva de cada balde, pro estado vazio de um filtro de gravidade
 * específico ("Nenhuma conta {x} neste recorte.") — nunca o mesmo texto
 * genérico de "sem filtro nenhum", pra ficar claro QUAL recorte não achou
 * nada (Etapa "Unificação da Leitura da Operação", item "Empty state de
 * filtro"). */
const PRIORITY_GROUP_EMPTY_LABEL: Record<OperationPriorityGroup, string> = {
  critico: "crítica",
  atencao: "em atenção",
  saudavel: "saudável",
  sem_dados: "sem dados",
};

/**
 * Centro de Triagem da Operação (Etapa "Unificação da Leitura da Operação")
 * — pergunta que a tela responde: "qual conta merece minha atenção agora, e
 * por quê". Uma única lógica mental, do topo ao corpo: os cards rápidos do
 * topo e o agrupamento da fila usam exatamente a mesma classificação
 * (`resolveOperationPriorityGroup`, derivada só do `evaluation`/Motor de
 * Saúde da Conta) — o filtro rápido reduz a lista pela MESMA gravidade que
 * os divisores (Crítico → Atenção → Saudável → Sem dados) já usam pra
 * ordenar o que sobrou. Os eixos de diagnóstico do Motor Único
 * (Planejamento/Investimento/CPA/Pendências) deixaram de ser filtro — agora
 * só aparecem como motivo dentro do próprio card
 * (`OperationClientCard`/`primaryReason`). A lógica final da tela é
 * Gravidade + Gestor + Busca, nada além disso.
 */
export function OperationTriageView({
  clients,
  monthParam,
  currentDateTimeLabel,
  summary,
}: {
  clients: ClientOperationalState[];
  monthParam: string;
  /** Só um relógio (dia da semana/data/hora atuais) — deliberadamente sem
   * verbo/rótulo que implique frescor de dado (ver comentário em
   * `page.tsx`: era "Atualizado {hora}", mas media o carregamento da
   * página, nunca uma sincronização real). */
  currentDateTimeLabel: string;
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

  const filteredClients = useMemo(
    () => filterOperationTriageClients(groupedClients, { severity: quickFilter, managerId: managerFilter, query }),
    [groupedClients, quickFilter, managerFilter, query],
  );

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
          <span className="ml-2 text-xs text-muted-foreground">{currentDateTimeLabel}</span>
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
          {summary.totalClients === 0
            ? "Nenhum cliente ativo neste mês."
            : quickFilter !== "todos"
              ? `Nenhuma conta ${PRIORITY_GROUP_EMPTY_LABEL[quickFilter]} neste recorte.`
              : "Nenhum cliente encontrado com esse filtro."}
        </p>
      )}
    </div>
  );
}
