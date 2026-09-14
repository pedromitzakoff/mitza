"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMonthLabel } from "@/lib/format";
import {
  shiftOperationMonth,
  groupClientsByOperationPriority,
  resolveOperationCpaPriorityGroup,
  filterOperationTriageClients,
  type OperationTriageSummary,
  type OperationPriorityGroup,
  type OperationQuickFilter,
} from "@/lib/operation-triage";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { OperationClientCard } from "./operation-client-card";
import { OperationFilterBar } from "./operation-filter-bar";

/** Seletor "Meta Ads | Google Ads" — Etapa "Operação por Canal". Mesmo
 * padrão visual de pill/segmented control já usado em
 * `VisaoGeralChannelSwitch` (Visão Geral do cliente) e no seletor de
 * prioridade de `OperationFilterBar` logo abaixo — nenhum componente novo,
 * só a mesma linguagem visual reaplicada aqui. Deliberadamente sem
 * "Consolidado": a Operação não tem mais leitura consolidada (decisão
 * explícita — Meta e Google podem ter saúde completamente diferente, e
 * consolidar mascararia isso). Navegação por `Link`/querystring (mesmo
 * padrão do seletor de mês ao lado) — troca de canal é uma navegação de
 * página inteira, nunca estado de cliente. */
function OperationChannelSwitch({ monthParam, active }: { monthParam: string; active: TrafficChannel }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-overview-surface p-0.5">
      {AVAILABLE_TRAFFIC_CHANNELS.map((channel) => (
        <Link
          key={channel}
          href={`/operation?month=${monthParam}&channel=${channel}`}
          scroll={false}
          aria-pressed={channel === active}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            channel === active ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"
          }`}
        >
          {TRAFFIC_CHANNELS[channel].label}
        </Link>
      ))}
    </div>
  );
}

/** Plural/gramática do divisor de seção ("Crítico" → "Críticas" etc.) —
 * Etapa "Operação — Redução de Ruído Visual": desde que o badge de status
 * saiu do card (`operation-client-card.tsx`), este divisor é a ÚNICA fonte
 * visual do balde de cada conta — nunca repetido dentro do card. */
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
 * Centro de Triagem da Operação (Etapa "Unificação da Leitura da Operação",
 * atualizada pela Etapa "Operação — CPA como régua única") — pergunta que a
 * tela responde: "como está esta conta olhando pra custo por resultado?".
 * Uma única lógica mental, do topo ao corpo: os cards rápidos do topo, o
 * agrupamento da fila e os divisores de seção usam exatamente a mesma
 * classificação (`resolveOperationCpaPriorityGroup`, `lib/operation-triage.ts`
 * — derivada só de `evaluation.dimensions.cost`/`.dataQuality`, nunca de
 * investimento/resultado/revisão) — o filtro rápido reduz a lista pela
 * MESMA gravidade que os divisores (Crítico → Atenção → Saudável → Sem
 * dados) já usam pra ordenar o que sobrou. A lógica final da tela é
 * Gravidade (CPA) + Gestor + Busca, nada além disso.
 */
export function OperationTriageView({
  clients,
  monthParam,
  channel,
  currentDateTimeLabel,
  summary,
}: {
  clients: ClientOperationalState[];
  monthParam: string;
  /** Canal ativo (Etapa "Operação por Canal") — nunca "consolidated": a tela
   * inteira (população, métricas, meta, frescor, contadores) já chega
   * recortada por este canal via `loadOperationTriageClients`. Usado aqui só
   * pra destacar o botão ativo do seletor e propagar nos links de navegação
   * de mês, pra trocar de mês nunca resetar o canal escolhido. */
  channel: TrafficChannel;
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

  const prevMonthHref = `/operation?month=${shiftOperationMonth(monthParam, -1)}&channel=${channel}`;
  const nextMonthHref = `/operation?month=${shiftOperationMonth(monthParam, 1)}&channel=${channel}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operação</h1>
          <p className="text-sm text-muted-foreground">
            Qual cliente merece sua atenção agora, e por quê.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OperationChannelSwitch monthParam={monthParam} active={channel} />
          <Link
            href={prevMonthHref}
            aria-label="Mês anterior"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-overview-surface-hover"
          >
            ‹
          </Link>
          <span className="min-w-32 text-center text-sm font-medium text-foreground">{formatMonthLabel(monthParam)}</span>
          <Link
            href={nextMonthHref}
            aria-label="Próximo mês"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-overview-surface-hover"
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
            const group = resolveOperationCpaPriorityGroup(card.evaluation);
            const previousGroup = index > 0 ? resolveOperationCpaPriorityGroup(filteredClients[index - 1].evaluation) : null;
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
