import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportKpiGrid } from "./report-kpi-grid";
import { ReportTableSection } from "./report-table-section";

/**
 * Corpo do Relatório de Performance nativo — identidade visual aprovada
 * (paleta fixa creme/areia/grafite/branco/verde-limão), extraída de
 * `page.tsx` na Etapa "Link Externo V1" pra ser compartilhada, sem
 * duplicação, entre a página interna (`/clients/[id]/relatorio`) e o link
 * externo somente leitura (`/r/[token]`) — as duas renderizam o MESMO
 * `PerformanceReportDocument`, nunca uma segunda versão do template.
 */
export function ReportBody({ document }: { document: PerformanceReportDocument }) {
  return (
    <div className="mt-5 rounded-2xl border border-[#D9D3C9] bg-[#EFE9E0] px-4 py-6 sm:px-8">
      <section id="resumo" className="pb-9">
        <div className="text-[11px] font-extrabold tracking-[0.15em] text-[#6F6B65]">RESUMO EXECUTIVO</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#17171A]">Visão geral da performance</h2>
        <p className="mt-1 max-w-xl text-sm text-[#6F6B65]">
          CPA e ROAS recalculados a partir dos totais do período, nunca pela média das linhas.
        </p>
        <div className="mt-5">
          <ReportKpiGrid summary={document.summary} />
        </div>
      </section>

      {document.tables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}

      <p className="border-t border-[#D9D3C9] pt-5 text-xs text-[#6F6B65]">
        Relatório de Performance · Meta Ads — gerado em {document.generatedAtLabel}.
      </p>
    </div>
  );
}
