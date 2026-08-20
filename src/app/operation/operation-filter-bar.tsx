import { Search } from "lucide-react";
import type { OperationTriageSummary, OperationQuickFilter } from "@/lib/operation-triage";

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
 * Cabeçalho da Operação (Etapa "Unificação da Leitura da Operação") — o topo
 * deixa de filtrar por EIXO de diagnóstico (Planejamento/Investimento/CPA/
 * Pendências, uma pergunta) e passa a filtrar pela mesma GRAVIDADE que já
 * organiza o corpo da lista (Crítico/Atenção/Saudável/Sem dados, outra
 * pergunta) — antes disso, o gestor precisava pensar em dois eixos ao mesmo
 * tempo pra ler a tela. Os quatro conceitos de eixo (Planejamento,
 * Investimento, CPA, Pendências) continuam existindo — só migraram pra
 * dentro do próprio card, como motivo (`primaryReason`/`diagnostics`, ver
 * `operation-client-card.tsx`), nunca mais como um segundo filtro aqui.
 * Cada contador funciona como filtro rápido (clique alterna, um único ativo
 * por vez) — mesma interação de sempre, só a pergunta que ele responde
 * mudou. Contagens vêm de `summarizeOperationTriage`, que usa exatamente
 * `resolveOperationPriorityGroup` — a mesma fonte que agrupa a lista
 * abaixo, nunca um score paralelo.
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
          count={summary.critico}
          label="Críticas"
          active={quickFilter === "critico"}
          onClick={() => onQuickFilterChange(quickFilter === "critico" ? "todos" : "critico")}
        />
        <CounterTile
          count={summary.atencao}
          label="Atenção"
          active={quickFilter === "atencao"}
          onClick={() => onQuickFilterChange(quickFilter === "atencao" ? "todos" : "atencao")}
        />
        <CounterTile
          count={summary.saudavel}
          label="Saudáveis"
          active={quickFilter === "saudavel"}
          onClick={() => onQuickFilterChange(quickFilter === "saudavel" ? "todos" : "saudavel")}
        />
        <CounterTile
          count={summary.semDados}
          label="Sem dados"
          active={quickFilter === "sem_dados"}
          onClick={() => onQuickFilterChange(quickFilter === "sem_dados" ? "todos" : "sem_dados")}
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
            adicionais") — responde direto "quais contas críticas estão
            comigo?" sem precisar digitar o próprio nome na busca. A lógica
            final da tela (Etapa "Unificação da Leitura da Operação") é só
            Gravidade + Gestor + Busca — nenhum filtro por eixo de
            diagnóstico (Planejamento/Investimento/CPA/Pendências) aqui,
            esses viraram motivo dentro do próprio card. Canal não entrou
            por não existir hoje como fato consolidado e confiável por
            cliente neste pipeline (ver relatório da etapa original). */}
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
