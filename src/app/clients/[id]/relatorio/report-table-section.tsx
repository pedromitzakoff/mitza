"use client";

import { useMemo, useState } from "react";
import type { PerformanceReportRow, PerformanceReportTable } from "@/lib/performance-report/report-document";

/**
 * Equivalente nativo de `renderTableSection` (`renderers/html-renderer.ts`)
 * — mesma identidade visual e MESMO comportamento (sorting por coluna,
 * progressive disclosure de 10 linhas, thumbnail, coluna "Prévia"), agora
 * como componente React em vez de HTML+script estático. Só apresentação:
 * toda linha já chega com `display`/`sortValue` prontos
 * (`PerformanceReportTable`, Camada 2) — sorting aqui é só reordenação de um
 * array já buscado, nunca um novo cálculo/consulta (trocar de ordenação ou
 * expandir "ver todos" nunca dispara refetch).
 *
 * Etapa "Resultado Diário": generalizado com 3 capacidades novas, usadas só
 * pela tabela de Resultado Diário (as outras 3 continuam com os valores de
 * sempre — `disclosure: true`, `totalRow: null`, `rowNote` nunca definido):
 * `table.disclosure === false` mostra todas as linhas sempre, sem botão
 * "ver todos"; `table.totalRow` renderiza uma linha fixa no final, fora da
 * ordenação/disclosure; `row.rowNote` substitui as células de métrica por
 * uma única célula de texto (dia sem nenhum sinal de sincronização).
 */
const INITIAL_VISIBLE_ROWS = 10;

type SortState = { columnIndex: number; direction: "asc" | "desc" };

function isSafeHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function sortRows(rows: PerformanceReportRow[], sort: SortState | null): PerformanceReportRow[] {
  if (!sort) return rows;
  const sorted = [...rows];
  const { columnIndex, direction } = sort;
  sorted.sort((a, b) => {
    if (columnIndex === 0) {
      const cmp = a.name.localeCompare(b.name, "pt-BR");
      return direction === "asc" ? cmp : -cmp;
    }
    // Mesma convenção do sort original (data-sort="-1" pra ausência de
    // dado): nunca uma segunda regra de "onde vai o dado ausente".
    const av = a.metrics[columnIndex - 1]?.sortValue ?? -1;
    const bv = b.metrics[columnIndex - 1]?.sortValue ?? -1;
    return direction === "asc" ? av - bv : bv - av;
  });
  return sorted;
}

function renderRowCells(row: PerformanceReportRow, hasPreviewColumn: boolean, metricColumnCount: number) {
  if (row.rowNote) {
    return <td colSpan={metricColumnCount + (hasPreviewColumn ? 1 : 0)} className="px-3 py-2.5 text-left text-[#6F6B65]">{row.rowNote}</td>;
  }
  return (
    <>
      {row.metrics.map((cell, index) => (
        <td key={index} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#1E1E20]">
          {cell.display}
        </td>
      ))}
      {hasPreviewColumn &&
        (isSafeHttpUrl(row.previewUrl) ? (
          <td className="whitespace-nowrap px-3 py-2.5 text-left">
            <a href={row.previewUrl} target="_blank" rel="noopener noreferrer" className="border-b-2 border-[#D8F238] pb-px font-bold text-[#17171A]">
              Ver criativo ↗
            </a>
          </td>
        ) : (
          <td className="whitespace-nowrap px-3 py-2.5 text-left text-[#6F6B65]">—</td>
        ))}
    </>
  );
}

export function ReportTableSection({ table }: { table: PerformanceReportTable }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [expanded, setExpanded] = useState(false);

  const sortedRows = useMemo(() => sortRows(table.rows, sort), [table.rows, sort]);
  // Etapa "Resultado Diário": `disclosure: false` mostra TODOS os dias
  // sempre, sem botão "ver todos" — pedido explícito do usuário pra essa
  // tabela específica; as demais (Campanhas/Públicos/Criativos) continuam
  // com a disclosure de sempre.
  const visibleRows = !table.disclosure || expanded ? sortedRows : sortedRows.slice(0, INITIAL_VISIBLE_ROWS);
  const count = table.rows.length;

  function toggleSort(columnIndex: number) {
    setSort((prev) => (prev && prev.columnIndex === columnIndex ? { columnIndex, direction: prev.direction === "asc" ? "desc" : "asc" } : { columnIndex, direction: "asc" }));
  }

  return (
    <section id={table.id} className="border-t border-[#D9D3C9] py-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold tracking-[0.15em] text-[#6F6B65]">{table.eyebrow}</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#17171A]">{table.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-[#6F6B65]">{table.description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-[#D9D3C9] px-2.5 py-1.5 text-xs text-[#6F6B65]">
          {count} {count === 1 ? "item" : "itens"}
        </span>
      </div>

      {count === 0 ? (
        <p className="py-6 text-sm text-[#6F6B65]">{table.emptyMessage}</p>
      ) : (
        <>
          <div className="mt-5 max-h-[620px] overflow-auto rounded-2xl border border-[#D9D3C9] bg-white">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th
                    onClick={() => toggleSort(0)}
                    className="sticky top-0 z-10 min-w-[220px] cursor-pointer whitespace-nowrap bg-[#17171A] px-3 py-3 text-left font-semibold text-white"
                  >
                    {table.nameColumnHeader}
                  </th>
                  {table.metricColumns.map((column, index) => (
                    <th
                      key={column.key}
                      onClick={() => toggleSort(index + 1)}
                      className="sticky top-0 z-10 cursor-pointer whitespace-nowrap bg-[#17171A] px-3 py-3 text-right font-semibold text-white"
                    >
                      {column.header}
                    </th>
                  ))}
                  {table.hasPreviewColumn && (
                    <th className="sticky top-0 z-10 whitespace-nowrap bg-[#17171A] px-3 py-3 text-left font-semibold text-white">Prévia</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className="border-b border-[#ECE8E1] last:border-0 hover:bg-[#FAF8F4]">
                    <td className="px-3 py-2.5 text-left font-semibold text-[#17171A]">
                      <div className="flex items-center gap-2">
                        {isSafeHttpUrl(row.thumbnailUrl) && (
                          // eslint-disable-next-line @next/next/no-img-element -- imagem de origem externa (Stract), sem allowlist de domínio pro next/image
                          <img src={row.thumbnailUrl} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded-md bg-[#C8BEAD] object-cover" />
                        )}
                        <span>{row.name}</span>
                      </div>
                    </td>
                    {renderRowCells(row, table.hasPreviewColumn, table.metricColumns.length)}
                  </tr>
                ))}
                {/* Total — Etapa "Resultado Diário": sempre por último,
                    nunca ordenado/recolhido junto das linhas de dia (visual
                    distinto pra nunca ser confundido com um dia real). */}
                {table.totalRow && (
                  <tr className="border-t-2 border-[#17171A] bg-[#FAF8F4] font-bold">
                    <td className="px-3 py-2.5 text-left text-[#17171A]">{table.totalRow.name}</td>
                    {renderRowCells(table.totalRow, table.hasPreviewColumn, table.metricColumns.length)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {table.disclosure && count > INITIAL_VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-3 text-sm font-semibold text-[#17171A] underline underline-offset-4"
            >
              {expanded ? "Recolher ↑" : `Ver todos os ${count} itens ↓`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
