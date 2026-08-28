"use client";

import { useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/workspace/empty-state";

/** Valor de ordenação de UMA célula — `null` sempre ordena por último,
 * nas duas direções (dado ausente nunca "vence" nem "perde" por acaso de
 * direção; ver `compareForSort`). String usa `localeCompare` (alfabético
 * pt-BR), número usa subtração — nunca os dois num mesmo `sortValue`. */
export type ReportTableSortValue = string | number | null;

export interface ReportTableColumn<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Presença desta função é o que torna a coluna ordenável — nenhum outro
   * flag booleano separado pra manter as duas coisas sempre em sincronia. */
  sortValue?: (row: Row) => ReportTableSortValue;
  /** Direção do PRIMEIRO clique nesta coluna (cliques seguintes alternam) —
   * convenção do produto: "desc" pra métricas (maior primeiro), "asc" pra
   * nome (A→Z primeiro). Obrigatório apenas quando `sortValue` existe. */
  defaultDirection?: "asc" | "desc";
  render: (row: Row) => ReactNode;
  /** `nowrap` é o normal pra números (largura previsível); a coluna de
   * nome é a única que tipicamente NÃO usa isso (precisa poder quebrar). */
  nowrap?: boolean;
}

type SortDirection = "asc" | "desc";

function compareForSort(a: ReportTableSortValue, b: ReportTableSortValue, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "pt-BR") : (a as number) - (b as number);
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Etapa "Três níveis de análise (Campanhas/Públicos/Criativos)": primitive
 * visual/comportamental compartilhada entre as tabelas do Relatório —
 * ordenação por header clicável, progressive disclosure (N iniciais + "ver
 * todos"/"recolher"), mesma densidade/divisórias/tipografia editorial nas
 * três. NUNCA sabe o que é uma campanha/público/criativo: só recebe
 * `columns`/`rows` já prontos de quem chama (`report-campaigns.tsx`,
 * `report-creatives.tsx` — cada um resolve sua própria fonte/agregação/
 * regra de objetivo, nada disso mora aqui). Extraída só agora que existem
 * DOIS consumidores reais (antes, só Campanhas, não valia a abstração).
 *
 * Ordenação é client-side sobre o array COMPLETO (nunca só as linhas
 * visíveis) — `rows` já vem carregado por quem chama; reordenar em
 * memória é suficiente e não introduz uma segunda fonte de verdade nem
 * uma query nova.
 *
 * Nenhuma linha sai do DOM quando recolhida: as que ficam além do corte
 * ganham `hidden print:table-row`, então (a) uma impressão do navegador já
 * sai completa hoje mesmo com a seção recolhida na tela, e (b) uma futura
 * exportação de PDF de verdade não precisa reimplementar nada aqui — só
 * decidir que o modo "print" está ativo. `<thead>` real (não recriado por
 * JS) tende a repetir sozinho em quebras de página impressas.
 */
export function ReportTable<Row>({
  rows,
  getRowKey,
  columns,
  initialVisibleCount = 10,
  defaultSortKey,
  emptyMessage,
  expandLabel,
  collapseLabel,
}: {
  rows: Row[];
  getRowKey: (row: Row) => string;
  columns: ReportTableColumn<Row>[];
  initialVisibleCount?: number;
  /** Coluna ordenada por padrão — precisa ter `sortValue`/`defaultDirection`. */
  defaultSortKey: string;
  emptyMessage: string;
  expandLabel: (total: number) => string;
  collapseLabel: string;
}) {
  const defaultColumn = columns.find((c) => c.key === defaultSortKey);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: defaultSortKey,
    direction: defaultColumn?.defaultDirection ?? "desc",
  });
  const [expanded, setExpanded] = useState(false);

  const sortedRows = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => compareForSort(column.sortValue!(a), column.sortValue!(b), sort.direction));
  }, [rows, columns, sort]);

  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  const total = rows.length;
  const hasMoreThanInitial = total > initialVisibleCount;

  function handleHeaderClick(column: ReportTableColumn<Row>) {
    if (!column.sortValue) return;
    setSort((current) =>
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: column.defaultDirection ?? "desc" },
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        {/* `min-w` — respiro mínimo pro nome quebrar em linhas legíveis;
            abaixo disso o container rola horizontalmente em vez de
            espremer o nome palavra por palavra (desktop, a prioridade
            desta tela, nunca é afetado). */}
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-overview-border text-left text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">
              {columns.map((column) => {
                const isSorted = sort.key === column.key;
                const arrow = isSorted ? (sort.direction === "asc" ? "↑" : "↓") : column.sortValue ? "↕" : null;
                return (
                  <th
                    key={column.key}
                    className={`py-2 pr-4 font-medium last:pr-0 ${column.nowrap ? "whitespace-nowrap" : ""} ${
                      column.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => handleHeaderClick(column)}
                        className={`print:pointer-events-none ${
                          isSorted ? "text-overview-text-secondary" : "hover:text-overview-text-secondary"
                        }`}
                      >
                        {column.header}
                        {arrow && <span className={`ml-1 ${isSorted ? "" : "text-overview-text-muted/60"}`}>{arrow}</span>}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => {
              const isHiddenWhenCollapsed = !expanded && hasMoreThanInitial && index >= initialVisibleCount;
              return (
                <tr
                  key={getRowKey(row)}
                  className={`border-b border-overview-border/60 last:border-0 ${isHiddenWhenCollapsed ? "hidden print:table-row" : ""}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`py-2.5 pr-4 align-top last:pr-0 tabular-nums text-overview-text-primary ${
                        column.nowrap ? "whitespace-nowrap" : ""
                      } ${column.align === "right" ? "text-right" : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMoreThanInitial && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-brand hover:underline print:hidden"
        >
          {expanded ? collapseLabel : expandLabel(total)}
        </button>
      )}
    </div>
  );
}
