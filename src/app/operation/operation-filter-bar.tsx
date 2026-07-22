import { Search } from "lucide-react";
import type { OperationTriageSummary } from "@/lib/operation-triage";

export type OperationQuickFilter = "todos" | "pendencias" | "revisoes" | "sem_sincronizacao" | "relatorio_pendente";

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
 * Cabeçalho da Operação (Etapa "Fila de Prioridades 1.0") — substitui os
 * contadores por banda de saúde/dimensão de desvio (exigiam conhecer o
 * vocabulário do Motor de Saúde) por quatro perguntas operacionais diretas:
 * quantos clientes, quantos com pendência, quantos precisando de revisão,
 * quantos sem sincronização. Cada contador funciona como filtro rápido
 * (clique alterna, um único ativo por vez) — a busca por nome continua
 * disponível pra localizar um cliente específico.
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
          label="Clientes"
          active={quickFilter === "todos"}
          onClick={() => onQuickFilterChange("todos")}
        />
        <CounterTile
          count={summary.withPendingTasks}
          label="Pendências"
          active={quickFilter === "pendencias"}
          onClick={() => onQuickFilterChange(quickFilter === "pendencias" ? "todos" : "pendencias")}
        />
        <CounterTile
          count={summary.needingReview}
          label="Revisões"
          active={quickFilter === "revisoes"}
          onClick={() => onQuickFilterChange(quickFilter === "revisoes" ? "todos" : "revisoes")}
        />
        <CounterTile
          count={summary.withoutSync}
          label="Sem sincronização"
          active={quickFilter === "sem_sincronizacao"}
          onClick={() => onQuickFilterChange(quickFilter === "sem_sincronizacao" ? "todos" : "sem_sincronizacao")}
        />
        {/* Etapa "MITZA 2.0 — Fase G": relatório pendente é a mesma
            pergunta operacional das outras 3 ("precisa da minha atenção
            agora?") — a lista de Relatórios deixou de ser um pilar de
            navegação, mas a visibilidade de pendência continua existindo,
            só que aqui, como mais um filtro rápido da mesma fila. */}
        <CounterTile
          count={summary.withPendingReport}
          label="Relatório pendente"
          active={quickFilter === "relatorio_pendente"}
          onClick={() => onQuickFilterChange(quickFilter === "relatorio_pendente" ? "todos" : "relatorio_pendente")}
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
