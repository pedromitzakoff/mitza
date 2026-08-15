import { Search } from "lucide-react";
import type { OperationTriageSummary } from "@/lib/operation-triage";

export type OperationQuickFilter = "todos" | "planejamento" | "cpa" | "investimento" | "pendencias";

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
 * (pendências/revisões/sem sincronização/relatório pendente) pelos
 * diagnósticos objetivos do Motor Único. "Revisão" deixou de existir como
 * filtro independente — vira só um tipo de Pendência (ver
 * metric-diagnostics.ts). Cada contador funciona como filtro rápido
 * (clique alterna, um único ativo por vez).
 *
 * Ordem deliberada (Etapa "Planejamento como eixo estrutural"): Planejamento
 * vem logo depois de Todos porque é um problema de outra NATUREZA — a
 * conta ainda não tem configuração mínima (meta de CPA/CPL, plano mensal
 * de investimento) pro motor conseguir avaliá-la — não um problema
 * operacional como os três seguintes (Investimento, CPA/CPL, Pendências).
 * Só depois que uma conta sai da fila de Planejamento ela é de fato
 * "acompanhada" pelos outros quatro eixos (o quinto, Atividade, ainda não
 * tem filtro nesta tela).
 */
export function OperationFilterBar({
  summary,
  quickFilter,
  onQuickFilterChange,
  query,
  onQueryChange,
  managers,
  managerFilter,
  onManagerFilterChange,
}: {
  summary: OperationTriageSummary;
  quickFilter: OperationQuickFilter;
  onQuickFilterChange: (filter: OperationQuickFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Só gestores com pelo menos 1 conta ativa neste mês (ver
   * `operation-triage-view.tsx`) — nunca a lista cheia de gestores da
   * agência, que poderia oferecer um filtro sem nenhum resultado possível. */
  managers: { id: string; name: string }[];
  managerFilter: string;
  onManagerFilterChange: (managerId: string) => void;
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
          count={summary.withPlanejamentoIncompleto}
          label="Planejamento"
          active={quickFilter === "planejamento"}
          onClick={() => onQuickFilterChange(quickFilter === "planejamento" ? "todos" : "planejamento")}
        />
        <CounterTile
          count={summary.withInvestmentOff}
          label="Investimento"
          active={quickFilter === "investimento"}
          onClick={() => onQuickFilterChange(quickFilter === "investimento" ? "todos" : "investimento")}
        />
        <CounterTile
          count={summary.withCpaOff}
          label="CPA"
          active={quickFilter === "cpa"}
          onClick={() => onQuickFilterChange(quickFilter === "cpa" ? "todos" : "cpa")}
        />
        <CounterTile
          count={summary.withPendencias}
          label="Pendências"
          active={quickFilter === "pendencias"}
          onClick={() => onQuickFilterChange(quickFilter === "pendencias" ? "todos" : "pendencias")}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar cliente ou gestor..."
            className="w-full rounded-md border border-border bg-transparent py-1.5 pl-8 pr-3 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
          />
        </div>
        {/* Gestor (Etapa "Central de Decisão Diária", item "Filtros
            adicionais") — único filtro novo adicionado: responde direto
            "quais contas críticas estão comigo?" sem precisar digitar o
            próprio nome na busca. Severidade/revisão/qualidade de dado já
            têm caminho próprio (agrupamento Crítico/Atenção/Saudável/Sem
            dados da fila, ver operation-triage-view.tsx) — um segundo
            controle pra isso duplicaria a mesma pergunta, então não foi
            adicionado, pra manter a barra enxuta. Canal não entrou por não
            existir hoje como fato consolidado e confiável por cliente neste
            pipeline (ver relatório da etapa). */}
        {managers.length > 0 && (
          <select
            value={managerFilter}
            onChange={(event) => onManagerFilterChange(event.target.value)}
            aria-label="Filtrar por gestor"
            className="rounded-md border border-border bg-transparent py-1.5 pl-2.5 pr-7 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
          >
            <option value="todos">Todos os gestores</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
