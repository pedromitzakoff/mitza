import { Search } from "lucide-react";
import type { OperationTriageSummary } from "@/lib/operation-triage";

export type OperationQuickFilter = "todos" | "cpa" | "investimento" | "pendencias";

function CounterTile({
  count,
  label,
  active,
  onClick,
}: {
  count: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
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

/**
 * Cabeçalho da Operação (Etapa "Novo Conceito de Monitoramento
 * Operacional") — substitui os filtros por dimensão do Motor de Saúde
 * (pendências/revisões/sem sincronização/relatório pendente) pelos três
 * diagnósticos objetivos do Motor Único: CPA acima da meta, Investimento
 * fora do ritmo, Pendências em aberto. "Revisão" deixou de existir como
 * filtro independente — vira só um tipo de Pendência (ver
 * metric-diagnostics.ts). Cada contador funciona como filtro rápido
 * (clique alterna, um único ativo por vez).
 */
export function OperationFilterBar({
  summary,
  quickFilter,
  onQuickFilterChange,
  query,
  onQueryChange,
}: {
  summary: OperationTriageSummary;
  quickFilter: OperationQuickFilter;
  onQuickFilterChange: (filter: OperationQuickFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <CounterTile
          count={summary.totalClients}
          label="Todos"
          active={quickFilter === "todos"}
          onClick={() => onQuickFilterChange("todos")}
        />
        <CounterTile
          count={summary.withCpaOff}
          label="CPA"
          active={quickFilter === "cpa"}
          onClick={() => onQuickFilterChange(quickFilter === "cpa" ? "todos" : "cpa")}
        />
        <CounterTile
          count={summary.withInvestmentOff}
          label="Investimento"
          active={quickFilter === "investimento"}
          onClick={() => onQuickFilterChange(quickFilter === "investimento" ? "todos" : "investimento")}
        />
        <CounterTile
          count={summary.withPendencias}
          label="Pendências"
          active={quickFilter === "pendencias"}
          onClick={() => onQuickFilterChange(quickFilter === "pendencias" ? "todos" : "pendencias")}
        />
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
