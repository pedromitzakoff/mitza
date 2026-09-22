"use client";

import { useId, useMemo, useState } from "react";
import type { PerformanceReportTable } from "@/lib/performance-report/report-document";
import { ReportTableSection } from "./report-table-section";

type NameFilterMode = "contains" | "not_contains";

/**
 * Comparação simples, sem acento-insensibilidade (mesma convenção de
 * busca por texto já usada em outras telas da MITZA, nunca uma segunda
 * biblioteca de normalização só pra isso). Texto vazio = nenhum filtro.
 */
function matchesNameFilter(name: string, mode: NameFilterMode, normalizedText: string): boolean {
  if (normalizedText === "") return true;
  const nameContains = name.toLowerCase().includes(normalizedText);
  return mode === "contains" ? nameContains : !nameContains;
}

/**
 * Etapa "Filtro por nome (contém/não contém)" — pedido explícito do
 * usuário depois de uma primeira versão com um controle por tabela: UM
 * controle só, no topo das tabelas do relatório, que escolhe qual
 * dimensão filtrar (Campanha/Público/Criativo — só as 3 tabelas com
 * `nameFilterable`, Resultado Diário nunca aparece como opção porque a
 * linha lá é uma data, não um nome) e o texto/modo a aplicar. Fluxo
 * pedido: contém/não contém → dimensão → texto.
 *
 * 100% client-side: filtra o MESMO array já buscado por
 * `buildPerformanceReportData`, nunca um novo fetch/consulta — mesmo
 * princípio já usado pela ordenação por coluna dentro de
 * `ReportTableSection`. Só a tabela da dimensão selecionada é afetada; as
 * outras duas continuam mostrando os dados completos, sem filtro nenhum.
 *
 * `ReportTableSection` nunca sabe que existe um filtro — recebe a `table`
 * já filtrada (ou intocada) daqui, com `emptyMessage` trocado só quando o
 * filtro zerar a tabela, pra nunca confundir "sem resultado pro filtro"
 * com "tabela genuinamente vazia" (`table.emptyMessage` original).
 */
export function ReportFilterableTables({ tables }: { tables: PerformanceReportTable[] }) {
  const filterableTables = useMemo(() => tables.filter((table) => table.nameFilterable), [tables]);
  const [mode, setMode] = useState<NameFilterMode>("contains");
  const [dimensionId, setDimensionId] = useState<string>(filterableTables[0]?.id ?? "");
  const [text, setText] = useState("");
  const formId = useId();

  const normalizedText = text.trim().toLowerCase();
  const isFiltering = dimensionId !== "" && normalizedText !== "";

  const effectiveTables = useMemo(() => {
    if (!isFiltering) return tables;
    return tables.map((table) => {
      if (table.id !== dimensionId) return table;
      const rows = table.rows.filter((row) => matchesNameFilter(row.name, mode, normalizedText));
      if (rows.length === table.rows.length) return table;
      return { ...table, rows, emptyMessage: rows.length === 0 ? "Sem resultado para esse filtro." : table.emptyMessage };
    });
  }, [tables, isFiltering, dimensionId, mode, normalizedText]);

  return (
    <>
      {filterableTables.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#D9D3C9] pt-6">
          <select
            aria-label="Modo do filtro"
            value={mode}
            onChange={(event) => setMode(event.target.value as NameFilterMode)}
            className="min-h-9 rounded-lg border border-[#D9D3C9] bg-white px-2 text-xs text-[#17171A]"
          >
            <option value="contains">contém</option>
            <option value="not_contains">não contém</option>
          </select>
          <select
            aria-label="Dimensão do filtro"
            value={dimensionId}
            onChange={(event) => setDimensionId(event.target.value)}
            className="min-h-9 rounded-lg border border-[#D9D3C9] bg-white px-2 text-xs text-[#17171A]"
          >
            {filterableTables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.nameColumnHeader}
              </option>
            ))}
          </select>
          <input
            id={`${formId}-filter-text`}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Digite o que procura"
            aria-label="Texto do filtro"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#D9D3C9] bg-white px-2.5 text-xs text-[#17171A] placeholder:text-[#9C978D] sm:w-56 sm:flex-none"
          />
          {text !== "" && (
            <button
              type="button"
              onClick={() => setText("")}
              className="text-xs font-semibold text-[#6F6B65] underline underline-offset-2 hover:text-[#17171A]"
            >
              Limpar
            </button>
          )}
        </div>
      )}

      {effectiveTables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}
    </>
  );
}
