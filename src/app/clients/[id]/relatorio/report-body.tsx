import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportKpiGrid } from "./report-kpi-grid";
import { ReportTableSection } from "./report-table-section";

/** "Leitura do período": bloco 100% determinístico (nunca IA generativa) —
 * ver `report-derivatives.ts#buildPeriodReading`. Cada frase já vem pronta
 * no documento; aqui só é apresentada. */
function PeriodReading({ document }: { document: PerformanceReportDocument }) {
  if (!document.periodReading || document.periodReading.length === 0) return null;
  return (
    <div className="mt-3.5 border-l-[3px] border-[#D8F238] bg-white/55 px-3.5 py-3 sm:mt-4 sm:px-4 sm:py-3.5">
      <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#6F6B65]">Leitura do período</div>
      <div className="flex flex-col gap-1">
        {document.periodReading.map((sentence, index) => (
          <p key={index} className="max-w-xl text-[13px] leading-snug text-[#1E1E20] sm:text-sm">
            {sentence}
          </p>
        ))}
      </div>
    </div>
  );
}

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
    <div className="mt-3.5 rounded-2xl border border-[#D9D3C9] bg-[#EFE9E0] px-3.5 py-4 sm:mt-5 sm:px-8 sm:py-6">
      <section id="resumo" className="pb-6 sm:pb-9">
        <div className="text-[11px] font-extrabold tracking-[0.15em] text-[#6F6B65]">RESUMO DO PERÍODO</div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-[#17171A] sm:text-2xl">Resumo do período</h2>
        <div className="mt-3.5 sm:mt-5">
          <ReportKpiGrid summary={document.summary} />
        </div>
        <PeriodReading document={document} />
      </section>

      {document.tables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}

      <p className="border-t border-[#D9D3C9] pt-4 text-xs text-[#6F6B65] sm:pt-5">
        Relatório de Performance · Meta Ads — gerado em {document.generatedAtLabel}.
      </p>
    </div>
  );
}
