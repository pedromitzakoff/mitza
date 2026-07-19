import { Search } from "lucide-react";
import type { AccountHealthEvaluation } from "@/lib/account-health-engine";
import { OPERATION_TRIAGE_BAND_ORDER, type OperationTriageBand } from "@/lib/operation-triage";
import { OPERATION_TRIAGE_BAND_REGISTRY } from "@/lib/status-registry";

export type OperationBandFilter = "todos" | OperationTriageBand;
export type OperationDimensionFilter = "todos" | keyof AccountHealthEvaluation["dimensions"];

const DIMENSION_FILTER_ORDER: OperationDimensionFilter[] = [
  "todos",
  "dataQuality",
  "cost",
  "results",
  "investment",
  "review",
];

const DIMENSION_FILTER_LABEL: Record<OperationDimensionFilter, string> = {
  todos: "Todos os desvios",
  dataQuality: "Qualidade dos dados",
  cost: "Custo",
  results: "Resultado",
  investment: "Investimento",
  review: "Revisão",
};

function BandTile({
  band,
  count,
  active,
  onClick,
}: {
  band: OperationBandFilter;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const label = band === "todos" ? "Todos" : OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${band}`].label;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mitza-pressable flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active ? "border-brand bg-brand/5" : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
    >
      <span className="text-xl font-semibold tabular-nums text-foreground">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  );
}

function DimensionChip({
  dimension,
  active,
  onClick,
}: {
  dimension: OperationDimensionFilter;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mitza-pressable rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-border text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
    >
      {DIMENSION_FILTER_LABEL[dimension]}
    </button>
  );
}

/**
 * Filtros da Operação (Etapa "Redesenho da Operação") — banda de saúde
 * (contadores clicáveis, já existia), dimensão de desvio (NOVO: sempre
 * checando `evaluation.dimensions[x].status !== "nenhum"` estruturado, nunca
 * busca textual em `primaryReason` — seção 6 do pedido) e busca por nome
 * de cliente ou gestor.
 */
export function OperationFilterBar({
  bandCounts,
  totalCount,
  bandFilter,
  onBandFilterChange,
  dimensionFilter,
  onDimensionFilterChange,
  query,
  onQueryChange,
}: {
  bandCounts: Record<OperationTriageBand, number>;
  totalCount: number;
  bandFilter: OperationBandFilter;
  onBandFilterChange: (band: OperationBandFilter) => void;
  dimensionFilter: OperationDimensionFilter;
  onDimensionFilterChange: (dimension: OperationDimensionFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <BandTile band="todos" count={totalCount} active={bandFilter === "todos"} onClick={() => onBandFilterChange("todos")} />
        {OPERATION_TRIAGE_BAND_ORDER.map((band) => (
          <BandTile
            key={band}
            band={band}
            count={bandCounts[band]}
            active={bandFilter === band}
            onClick={() => onBandFilterChange(band)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DIMENSION_FILTER_ORDER.map((dimension) => (
          <DimensionChip
            key={dimension}
            dimension={dimension}
            active={dimensionFilter === dimension}
            onClick={() => onDimensionFilterChange(dimension)}
          />
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar cliente ou gestor..."
          className="w-full rounded-md border border-border bg-transparent py-1.5 pl-8 pr-3 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
        />
      </div>
    </div>
  );
}
