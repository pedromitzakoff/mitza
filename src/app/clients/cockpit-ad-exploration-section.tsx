"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, SlidersHorizontal } from "lucide-react";
import { buildAdSetSummaries, type AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import { buildCreativeSummaries, type AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import { matchesNameFilter, type NameFilterMode } from "@/lib/performance-report/report-filter-recompute";
import type { PerformanceGoal } from "@/lib/performance-goals";
import {
  adSetSummaryToRow,
  buildExplorationColumns,
  creativeSummaryToRow,
  explorationSortValue,
  formatExplorationCell,
  type ExplorationColumnId,
  type ExplorationRow,
} from "@/lib/meta-ads-dashboard/exploration-data";

/**
 * MITZA ONE — Cockpit Único do Cliente, "Campanhas, conjuntos e anúncios"
 * (consolidação da antiga `clients/[id]/meta-ads/exploration-section.tsx`,
 * Etapa 2.4, pra dentro do Cockpit — restilizada com os tokens
 * `overview-*`/`brand`, mesma lógica/comportamento). Toda a exploração
 * continua na MESMA tela (nenhuma rota nova nem botão "Ver performance
 * completa").
 *
 * KOFF Analytics — "Refinamento de UX e filtros globais do Cockpit" (pedido
 * explícito do usuário, seção 3): "A navegação atual não está clara...
 * Permitir entrar diretamente em qualquer nível." As três abas
 * (Campanhas|Conjuntos|Anúncios) ficam SEMPRE visíveis — nunca mais
 * "Conjuntos"/"Anúncios" só aparecem depois de clicar numa campanha. Uma
 * campanha selecionada passa a ser um ESCOPO independente da aba ativa
 * (`selectedCampaign`): clicar numa linha de campanha ainda seleciona essa
 * campanha e leva pra "Conjuntos" (drill-down de sempre, preservado), mas
 * agora dá pra entrar direto em "Conjuntos"/"Anúncios" sem selecionar nada
 * — mostra os conjuntos/anúncios de TODAS as campanhas (reaproveitando
 * `buildAdSetSummaries`/`buildCreativeSummaries` sem filtro, que já
 * agregam entre campanhas e já retornam `campaignNames`), com a campanha
 * de cada linha indicada como legenda (`ExplorationRow.campaignNames`).
 * Um chip "Campanha: {nome} ×" (breadcrumb/filtro de contexto, pedido
 * explícito) aparece só enquanto o escopo está ativo e pode ser limpo sem
 * sair da aba.
 *
 * `ad_creative_daily_metrics` não tem `ad_set_id`/`ad_set_name`
 * (limitação documentada em
 * `docs/META_ADS_DASHBOARD_METRICS_GAP_ANALYSIS.md`, Gap C) — não existe
 * relação Conjunto→Anúncio pra drill-down (pedido explícito: "não inventar
 * relacionamentos inexistentes... mostrar uma limitação clara"), por isso
 * linhas de Conjuntos nunca são clicáveis e a aba Anúncios sempre mostra o
 * aviso da limitação quando escopada por campanha.
 */

type ExplorationLevel = "campaigns" | "adsets" | "ads";

const STORAGE_KEY_PREFIX = "mitza:cockpit:ad-exploration-columns:";

function isExplorationColumnId(value: unknown, validIds: ExplorationColumnId[]): value is ExplorationColumnId {
  return typeof value === "string" && (validIds as string[]).includes(value);
}

function loadStoredColumns(clientId: string, level: ExplorationLevel, validIds: ExplorationColumnId[]): ExplorationColumnId[] | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${level}:${clientId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((id): id is ExplorationColumnId => isExplorationColumnId(id, validIds));
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function saveStoredColumns(clientId: string, level: ExplorationLevel, ids: ExplorationColumnId[]) {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${level}:${clientId}`, JSON.stringify(ids));
  } catch {
    // Armazenamento indisponível — seleção de colunas não persiste entre
    // sessões nesse caso, nunca quebra a tela por isso.
  }
}

type SortState = { columnId: ExplorationColumnId; direction: "asc" | "desc" } | null;

function sortRows(rows: ExplorationRow[], sort: SortState): ExplorationRow[] {
  if (!sort) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort.columnId === "name") {
      const cmp = a.name.localeCompare(b.name, "pt-BR");
      return sort.direction === "asc" ? cmp : -cmp;
    }
    const av = explorationSortValue(sort.columnId, a);
    const bv = explorationSortValue(sort.columnId, b);
    return sort.direction === "asc" ? av - bv : bv - av;
  });
  return sorted;
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" | null }) {
  if (!active || !direction) return <ChevronsUpDown className="h-3 w-3 text-overview-text-muted" aria-hidden="true" />;
  return direction === "asc" ? (
    <ChevronUp className="h-3 w-3 text-overview-text-primary" aria-hidden="true" />
  ) : (
    <ChevronDown className="h-3 w-3 text-overview-text-primary" aria-hidden="true" />
  );
}

function ExplorationTable({
  rows,
  columns,
  visibleColumnIds,
  sort,
  onSortChange,
  onRowClick,
  emptyMessage,
  showCampaignNames,
}: {
  rows: ExplorationRow[];
  columns: ReturnType<typeof buildExplorationColumns>;
  visibleColumnIds: ExplorationColumnId[];
  sort: SortState;
  onSortChange: (columnId: ExplorationColumnId) => void;
  onRowClick?: (row: ExplorationRow) => void;
  emptyMessage: string;
  /** KOFF Analytics — "entrar diretamente em qualquer nível": entrada
   * direta (sem campanha selecionada) mistura linhas de campanhas
   * diferentes — mostra a legenda `row.campaignNames` embaixo do nome pra
   * nunca deixar ambíguo de onde cada conjunto/anúncio vem. `false` no
   * modo escopado (já sabido pela campanha selecionada, repetir seria
   * ruído). */
  showCampaignNames: boolean;
}) {
  const columnsById = new Map(columns.map((col) => [col.id, col]));
  const visibleColumns = visibleColumnIds.map((id) => columnsById.get(id)).filter((col): col is NonNullable<typeof col> => col !== undefined);
  const sortedRows = sortRows(rows, sort);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-overview-border px-4 py-6 text-center text-sm text-overview-text-secondary">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="max-h-[520px] overflow-auto rounded-lg border border-overview-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-overview-surface-subtle">
          <tr>
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={`border-b border-overview-border px-3.5 py-2.5 text-xs font-bold uppercase tracking-wide text-overview-text-muted ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSortChange(col.id)}
                  className={`mitza-pressable inline-flex items-center gap-1 ${col.align === "right" ? "flex-row-reverse" : ""} hover:text-overview-text-primary`}
                >
                  {col.label}
                  <SortIcon active={sort?.columnId === col.id} direction={sort?.columnId === col.id ? sort.direction : null} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-overview-border/60 last:border-0 ${onRowClick ? "mitza-pressable cursor-pointer hover:bg-overview-surface-hover" : ""}`}
            >
              {visibleColumns.map((col) => (
                <td
                  key={col.id}
                  className={`whitespace-nowrap px-3.5 py-2.5 tabular-nums text-overview-text-primary ${col.align === "right" ? "text-right" : "text-left font-medium"}`}
                >
                  {formatExplorationCell(col.id, row)}
                  {col.id === "name" && showCampaignNames && row.campaignNames && row.campaignNames.length > 0 && (
                    <span className="mt-0.5 block truncate text-xs font-normal normal-case text-overview-text-muted">
                      {row.campaignNames.join(" · ")}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnPicker({
  columns,
  visibleColumnIds,
  onToggle,
}: {
  columns: ReturnType<typeof buildExplorationColumns>;
  visibleColumnIds: ExplorationColumnId[];
  onToggle: (id: ExplorationColumnId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="mitza-pressable inline-flex h-9 items-center gap-1.5 rounded-lg border border-overview-border bg-overview-surface px-2.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Colunas
      </button>

      {isOpen && (
        <div id={panelId} className="absolute z-20 mt-2 max-w-xs rounded-lg border border-overview-border bg-overview-surface p-3 shadow-[var(--shadow-float)]">
          <ul className="flex flex-col gap-0.5">
            {columns.map((col) => (
              <li key={col.id}>
                <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-overview-text-primary hover:bg-overview-surface-hover">
                  <input
                    type="checkbox"
                    checked={visibleColumnIds.includes(col.id)}
                    disabled={col.id === "name"}
                    onChange={() => onToggle(col.id)}
                    className="h-4 w-4 rounded border-overview-border text-brand focus:ring-brand disabled:opacity-50"
                  />
                  {col.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SearchInput({ value, mode, onValueChange, onModeChange }: { value: string; mode: NameFilterMode; onValueChange: (v: string) => void; onModeChange: (m: NameFilterMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Modo da busca"
        value={mode}
        onChange={(event) => onModeChange(event.target.value as NameFilterMode)}
        className="min-h-9 rounded-lg border border-overview-border bg-overview-surface px-2 text-xs text-overview-text-primary"
      >
        <option value="contains">contém</option>
        <option value="not_contains">não contém</option>
      </select>
      <input
        type="text"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Buscar por nome"
        aria-label="Buscar por nome"
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-overview-border bg-overview-surface px-2.5 text-xs text-overview-text-primary placeholder:text-overview-text-muted sm:w-56 sm:flex-none"
      />
    </div>
  );
}

export function CockpitAdExplorationSection({
  clientId,
  resultType,
  campaigns,
  adSetDailyRows,
  creativeDailyRows,
}: {
  clientId: string;
  resultType: PerformanceGoal | null;
  campaigns: ExplorationRow[];
  adSetDailyRows: AdSetDailyMetricRow[];
  creativeDailyRows: AdCreativeDailyMetricRow[];
}) {
  const [selectedCampaign, setSelectedCampaign] = useState<{ id: string; name: string } | null>(null);
  const [level, setLevel] = useState<ExplorationLevel>("campaigns");
  const [searchText, setSearchText] = useState("");
  const [searchMode, setSearchMode] = useState<NameFilterMode>("contains");
  const [sort, setSort] = useState<SortState>(null);

  const columns = useMemo(() => buildExplorationColumns(resultType), [resultType]);
  const defaultColumnIds = useMemo(() => columns.filter((col) => col.defaultVisible).map((col) => col.id), [columns]);

  const [visibleColumnIds, setVisibleColumnIds] = useState<ExplorationColumnId[]>(defaultColumnIds);

  useEffect(() => {
    function applyColumnsForLevel() {
      const validIds = columns.map((col) => col.id);
      const stored = loadStoredColumns(clientId, level, validIds);
      setVisibleColumnIds(stored ?? defaultColumnIds);
    }
    applyColumnsForLevel();
  }, [clientId, level, columns, defaultColumnIds]);

  function toggleColumn(id: ExplorationColumnId) {
    if (id === "name") return;
    const next = visibleColumnIds.includes(id) ? visibleColumnIds.filter((existing) => existing !== id) : [...visibleColumnIds, id];
    setVisibleColumnIds(next);
    saveStoredColumns(clientId, level, next);
  }

  function handleSortChange(columnId: ExplorationColumnId) {
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: "desc" };
      if (current.direction === "desc") return { columnId, direction: "asc" };
      return null;
    });
  }

  function handleSelectCampaign(row: ExplorationRow) {
    setSelectedCampaign({ id: row.id, name: row.name });
    setLevel("adsets");
    setSearchText("");
    setSort(null);
  }

  function handleClearScope() {
    setSelectedCampaign(null);
    setSearchText("");
    setSort(null);
  }

  function handleChangeLevel(next: ExplorationLevel) {
    setLevel(next);
    setSearchText("");
    setSort(null);
  }

  const normalizedSearch = searchText.trim().toLowerCase();

  const adSetRows: ExplorationRow[] = useMemo(() => {
    const scoped = selectedCampaign
      ? adSetDailyRows.filter((row) => (row.campaignId && row.campaignId === selectedCampaign.id) || row.campaignName === selectedCampaign.name)
      : adSetDailyRows;
    return buildAdSetSummaries(scoped).map(adSetSummaryToRow);
  }, [adSetDailyRows, selectedCampaign]);

  const adRows: ExplorationRow[] = useMemo(() => {
    const scoped = selectedCampaign
      ? creativeDailyRows.filter((row) => (row.campaignId && row.campaignId === selectedCampaign.id) || row.campaignName === selectedCampaign.name)
      : creativeDailyRows;
    return buildCreativeSummaries(scoped).map(creativeSummaryToRow);
  }, [creativeDailyRows, selectedCampaign]);

  const activeRows = level === "campaigns" ? campaigns : level === "adsets" ? adSetRows : adRows;
  const filteredRows = activeRows.filter((row) => matchesNameFilter(row.name, searchMode, normalizedSearch));
  const isScopedByCampaign = selectedCampaign !== null && level !== "campaigns";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Navegação de exploração" className="inline-flex w-fit items-center gap-1 rounded-full border border-overview-border bg-overview-surface p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => handleChangeLevel("campaigns")}
            className={`rounded-full px-3 py-1.5 ${level === "campaigns" ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"}`}
          >
            Campanhas
          </button>
          <button
            type="button"
            onClick={() => handleChangeLevel("adsets")}
            className={`rounded-full px-3 py-1.5 ${level === "adsets" ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"}`}
          >
            Conjuntos
          </button>
          <button
            type="button"
            onClick={() => handleChangeLevel("ads")}
            className={`rounded-full px-3 py-1.5 ${level === "ads" ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"}`}
          >
            Anúncios
          </button>
        </nav>

        {isScopedByCampaign && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-overview-border bg-overview-surface-subtle px-2.5 py-1 text-xs text-overview-text-secondary">
            <span>
              Campanha: <span className="font-medium text-overview-text-primary">{selectedCampaign?.name}</span>
            </span>
            <button
              type="button"
              onClick={handleClearScope}
              aria-label="Limpar campanha selecionada"
              className="mitza-pressable rounded-full px-1 text-overview-text-muted hover:text-overview-text-primary"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {level === "ads" && isScopedByCampaign && (
        <p className="mt-2 text-xs text-overview-text-muted">
          Anúncios desta campanha — a ligação direta com um Conjunto específico não está disponível nos dados atuais (limitação conhecida,
          documentada).
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SearchInput value={searchText} mode={searchMode} onValueChange={setSearchText} onModeChange={setSearchMode} />
        <div className="relative">
          <ColumnPicker columns={columns} visibleColumnIds={visibleColumnIds} onToggle={toggleColumn} />
        </div>
      </div>

      <div className="mt-3">
        <ExplorationTable
          rows={filteredRows}
          columns={columns}
          visibleColumnIds={visibleColumnIds}
          sort={sort}
          onSortChange={handleSortChange}
          onRowClick={level === "campaigns" ? handleSelectCampaign : undefined}
          showCampaignNames={level !== "campaigns" && !isScopedByCampaign}
          emptyMessage={
            normalizedSearch !== ""
              ? "Nenhum resultado para esse filtro."
              : level === "campaigns"
                ? "Nenhuma campanha com investimento neste período."
                : level === "adsets"
                  ? isScopedByCampaign
                    ? "Nenhum conjunto de anúncios encontrado para esta campanha no período."
                    : "Nenhum conjunto de anúncios encontrado no período."
                  : isScopedByCampaign
                    ? "Nenhum anúncio encontrado para esta campanha no período."
                    : "Nenhum anúncio encontrado no período."
          }
        />
      </div>

      {level === "campaigns" && campaigns.length > 0 && (
        <p className="mt-2 text-xs text-overview-text-muted">Clique numa campanha para ver seus conjuntos e anúncios.</p>
      )}
    </div>
  );
}
