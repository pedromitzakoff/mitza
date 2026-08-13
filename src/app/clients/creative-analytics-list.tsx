"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoalConfig } from "@/lib/performance-goals";
import { NO_CREATIVES_MATCH_FILTERS_MESSAGE } from "@/lib/analytics-messages";
import type { CreativeSummary } from "@/lib/creative-analytics";
import { CreativeCard } from "./creative-card";
import { CreativeTableView } from "./creative-table-view";
import { CreativeComparisonDrawer } from "./creative-comparison-drawer";

const SEARCH_DEBOUNCE_MS = 400;
const MAX_COMPARE = 3;

type SortKey = "spend" | "resultCount" | "cpa" | "roas";
type ResultFilter = "all" | "with" | "without";
type ViewMode = "cards" | "table";

function sortValue(summary: CreativeSummary, key: SortKey): number | null {
  if (key === "spend") return summary.totalSpend;
  if (key === "resultCount") return summary.totalResultCount;
  if (key === "cpa") return summary.cpa;
  return summary.roas;
}

/** Pill de 2-3 opções — mesmo visual de `AnalyticsPlatformSwitch`
 * (`analytics-platform-switch.tsx`), mas puramente client-state (`<button>`,
 * nunca `<Link>`+querystring): busca/ordenação/filtro/visão deste painel são
 * preferências efêmeras de análise, não estado que precise ser
 * compartilhável por URL. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={option.key === value}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            option.key === value ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Painel "Criativos" — Etapa "Análise de Criativos" (pedido explícito do
 * usuário): a lista de cards que já existia (`CreativeCard`, inalterada na
 * hierarquia) ganha uma camada de análise por cima — busca, ordenação,
 * filtro de campanha, filtro Todos/Com resultado/Sem resultado, resumo
 * mínimo, alternância Cards/Tabela e comparação de 2-3 criativos — sem
 * nenhuma fonte de dado nova: tudo deriva de `summaries` (já resolvido
 * server-side por `buildCreativeSummaries`, lib/creative-analytics.ts) em
 * tempo de render, puramente local.
 *
 * Deliberadamente SEM estado visual "bom desempenho/volume relevante/sem
 * resultado" nesta primeira versão — depende de uma regra de classificação
 * (percentil? múltiplo da média? sobre qual conjunto?) que é uma decisão de
 * produto, não um detalhe de implementação; incremento futuro depois que
 * essa regra for definida.
 */
export function CreativeAnalyticsList({
  summaries,
  creativeDetailHrefBase,
  unattributedResultCount,
}: {
  summaries: CreativeSummary[];
  /** Href da lista SEM o `creative=<nome>` final (Server Component não pode
   * passar uma função pra cá — só o prefixo, serializável; o href de cada
   * item é montado aqui mesmo, client-side, com `buildDetailHref` abaixo). */
  creativeDetailHrefBase: string;
  /** Vendas/leads do período que existem em `daily_performance` mas não têm
   * nome de anúncio resolvido — não puderam ser atribuídos a NENHUM
   * criativo, então nunca aparecem em nenhuma linha da tabela/grid. Sobre o
   * total do período inteiro (nunca recalculado pela busca/filtro atual —
   * é sobre completude do dado, não sobre o que está visível agora). */
  unattributedResultCount: number | null;
}) {
  function buildDetailHref(creativeName: string) {
    return `${creativeDetailHrefBase}&creative=${encodeURIComponent(creativeName)}`;
  }

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  // Objetivo da conta pro rótulo de resultado/custo (mesma regra de
  // `CreativeCard`/`CreativeDetailView`) — primeiro `resultType` não-nulo
  // encontrado, já que é um dado por CONTA, não por criativo individual.
  const goalConfig: PerformanceGoalConfig | null = useMemo(() => {
    const withGoal = summaries.find((s) => s.resultType !== null);
    return withGoal?.resultType ? PERFORMANCE_GOALS[withGoal.resultType] : null;
  }, [summaries]);

  const hasAnyResultData = summaries.some((s) => s.totalResultCount !== null);
  const hasAnyCpa = summaries.some((s) => s.cpa !== null);
  const hasAnyRoas = summaries.some((s) => s.roas !== null);

  const campaignOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of summaries) for (const name of s.campaignNames) set.add(name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [summaries]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), SEARCH_DEBOUNCE_MS);
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return summaries.filter((s) => {
      if (term && !s.creativeName.toLowerCase().includes(term)) return false;
      if (campaignFilter !== "all" && !s.campaignNames.includes(campaignFilter)) return false;
      const hasResult = s.totalResultCount !== null && s.totalResultCount > 0;
      if (resultFilter === "with" && !hasResult) return false;
      if (resultFilter === "without" && hasResult) return false;
      return true;
    });
  }, [summaries, search, campaignFilter, resultFilter]);

  const sorted = useMemo(() => {
    const dirMultiplier = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Nulo sempre por último, nas duas direções — ausência de dado nunca
      // vira "o melhor" nem "o pior" resultado por acidente de ordenação.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dirMultiplier;
    });
  }, [filtered, sortKey, sortDir]);

  // Resumo mínimo — sempre sobre o conjunto FILTRADO (o que está de fato na
  // tela agora), nunca o total bruto do cliente: contexto antes de olhar os
  // cards, não outro dashboard.
  const withResultCount = filtered.filter((s) => s.totalResultCount !== null && s.totalResultCount > 0).length;
  const withoutResultCount = filtered.length - withResultCount;
  const bestCpa = filtered.reduce<number | null>((best, s) => (s.cpa !== null && (best === null || s.cpa < best) ? s.cpa : best), null);

  // Regra "sem seleção invisível" (mesmo princípio de `month-tasks-panel.tsx`):
  // a barra/drawer de comparação só conta o que está de fato visível nos
  // filtros atuais — trocar o filtro nunca deixa uma comparação "fantasma"
  // aberta com um criativo que já saiu de vista.
  const visibleSelected = sorted.filter((s) => selected.has(s.creativeName));
  const selectedCount = visibleSelected.length;

  function toggleSelect(creativeName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(creativeName)) next.delete(creativeName);
      else if (next.size < MAX_COMPARE) next.add(creativeName);
      return next;
    });
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "spend", label: "Ordenar por Investimento" },
    ...(hasAnyResultData ? [{ key: "resultCount" as SortKey, label: `Ordenar por ${goalConfig?.resultMetricLabel ?? "Resultado"}` }] : []),
    ...(hasAnyCpa ? [{ key: "cpa" as SortKey, label: `Ordenar por ${goalConfig?.costMetricShortLabel ?? "CPA"}` }] : []),
    ...(hasAnyRoas ? [{ key: "roas" as SortKey, label: "Ordenar por ROAS" }] : []),
  ];

  const resultLabel = goalConfig?.pluralLabel.toLowerCase() ?? "resultado";

  return (
    <div className="flex flex-col gap-3">
      {/* Controles de análise */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        <input
          value={searchInput}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Buscar criativo..."
          // QA visual: sem largura fluida, o campo mantinha o tamanho nativo
          // do navegador (~170px) mesmo sozinho numa linha no mobile —
          // cresce até preencher a linha abaixo de `sm:`, volta a uma
          // largura fixa confortável a partir dali (mesmo comportamento de
          // sempre no desktop, só corrigido no mobile).
          className="min-w-[120px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:w-44"
        />

        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {sortOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}
          aria-label={sortDir === "asc" ? "Trocar para ordem decrescente" : "Trocar para ordem crescente"}
          aria-pressed={sortDir === "asc"}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>

        {campaignOptions.length > 1 && (
          <select
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
            className="max-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <option value="all">Campanha: todas</option>
            {campaignOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}

        {hasAnyResultData && (
          <Segmented<ResultFilter>
            value={resultFilter}
            onChange={setResultFilter}
            options={[
              { key: "all", label: "Todos" },
              { key: "with", label: "Com resultado" },
              { key: "without", label: "Sem resultado" },
            ]}
          />
        )}

        <div className="ml-auto">
          <Segmented<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { key: "cards", label: "Cards" },
              { key: "table", label: "Tabela" },
            ]}
          />
        </div>
      </div>

      {/* Resumo mínimo */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "criativo analisado" : "criativos analisados"}
        {hasAnyResultData && (
          <>
            {" · "}
            {withResultCount} com {resultLabel}
            {" · "}
            {withoutResultCount} sem {resultLabel}
          </>
        )}
        {goalConfig && bestCpa !== null && (
          <>
            {" · "}Melhor {goalConfig.costMetricShortLabel}: {formatCurrency(bestCpa)}
          </>
        )}
      </p>

      {/* Achado no QA de produção: vendas que existem no total do período
          mas não têm nome de anúncio resolvido — nunca podem aparecer em
          nenhuma linha da tabela/grid abaixo. Sem esta linha, sumiam sem
          explicação (pareciam um erro de soma). Nunca reage à busca/filtro
          atual — é sobre completude do dado do período inteiro. */}
      {unattributedResultCount !== null && unattributedResultCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {unattributedResultCount} {resultLabel} do período {unattributedResultCount === 1 ? "não pôde" : "não puderam"} ser
          atribuído{unattributedResultCount === 1 ? "" : "s"} a nenhum criativo específico (anúncio sem nome
          identificado na origem).
        </p>
      )}

      {/* Barra de seleção — só aparece com 2+ selecionados VISÍVEIS */}
      {selectedCount >= 2 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-foreground">
            {selectedCount} criativos selecionados
          </span>
          <button type="button" onClick={() => setCompareOpen(true)} className="font-medium text-brand hover:underline">
            Comparar
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-muted-foreground hover:underline">
            Limpar
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState>{NO_CREATIVES_MATCH_FILTERS_MESSAGE}</EmptyState>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((summary) => (
            <CreativeCard
              key={summary.creativeName}
              summary={summary}
              detailHref={buildDetailHref(summary.creativeName)}
              selectable
              selected={selected.has(summary.creativeName)}
              selectionDisabled={!selected.has(summary.creativeName) && selected.size >= MAX_COMPARE}
              onToggleSelect={() => toggleSelect(summary.creativeName)}
            />
          ))}
        </div>
      ) : (
        <CreativeTableView summaries={sorted} goalConfig={goalConfig} buildDetailHref={buildDetailHref} />
      )}

      {compareOpen && visibleSelected.length >= 2 && (
        <CreativeComparisonDrawer summaries={visibleSelected} goalConfig={goalConfig} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}
