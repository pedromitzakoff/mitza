import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportFilterableTables } from "./report-filterable-tables";

/**
 * Corpo do Relatório de Performance nativo — identidade visual aprovada
 * (paleta fixa creme/areia/grafite/branco/verde-limão), extraída de
 * `page.tsx` na Etapa "Link Externo V1" pra ser compartilhada, sem
 * duplicação, entre a página interna (`/clients/[id]/relatorio`) e o link
 * externo somente leitura (`/r/[token]`) — as duas renderizam o MESMO
 * `PerformanceReportDocument`, nunca uma segunda versão do template.
 *
 * Etapa "Filtro no topo afeta o dashboard inteiro": o bloco "Resumo do
 * período" + KPIs + "Leitura do período" + as 4 tabelas passaram a viver
 * dentro de `ReportFilterableTables` (junto do controle de filtro que
 * agora fica acima de tudo isso) — os dois nunca podem ficar
 * dessincronizados, então viraram um componente só. `ReportBody` continua
 * dono só do que NUNCA muda com o filtro: a superfície/moldura do
 * relatório e o rodapé com a nota metodológica + timestamp.
 */
export function ReportBody({ document }: { document: PerformanceReportDocument }) {
  const methodologyNote = document.summary.status === "ok" ? document.summary.note : null;

  return (
    <div className="mt-3.5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:mt-5 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
      <ReportFilterableTables document={document} />

      {/* "Relatório de Performance" já está no <h1> do cabeçalho da página
          (`report-header.tsx`) — nunca repetir aqui, só o que é novo
          (canal + timestamp). Etapa "Visual Polish Mobile", item 7: a nota
          metodológica ("Indicadores calculados...") saiu do fluxo principal
          do mobile (interrompia a leitura entre KPIs e Leitura do período)
          e virou uma linha discreta aqui no rodapé, junto da metadata —
          informação preservada, só sem ocupar destaque no primeiro
          viewport. Desktop continua mostrando a nota no lugar de sempre,
          dentro de `DesktopSummary` (`report-kpi-grid.tsx`). Nota sempre a
          do Resumo REAL (nunca a do filtrado) — descreve a metodologia
          geral, continua verdadeira independente do filtro. */}
      <div className="border-t border-[#D9D3C9] pt-4 sm:pt-5">
        {methodologyNote && <p className="text-xs text-[#6F6B65] sm:hidden">{methodologyNote}</p>}
        <p className="mt-1 text-xs text-[#6F6B65] sm:mt-0">Meta Ads — gerado em {document.generatedAtLabel}.</p>
      </div>
    </div>
  );
}
