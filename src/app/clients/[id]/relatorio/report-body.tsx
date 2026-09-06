import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { flattenPeriodReadingLines } from "@/lib/performance-report/report-derivatives";
import { ReportKpiGrid } from "./report-kpi-grid";
import { ReportTableSection } from "./report-table-section";

/**
 * "Leitura do período": bloco 100% determinístico (nunca IA generativa) —
 * ver `report-derivatives.ts#buildPeriodReading`. Cada frase já vem pronta
 * no documento; aqui só é apresentada.
 *
 * Etapa "Visual Polish Mobile", item 8: no mobile as 3 frases (quando
 * existem as 3) deixaram de ser visualmente idênticas — a leitura
 * determinística virou 3 CAMPOS nomeados (`summaryLine`/`targetLine`/
 * `bestCampaignLine`, `report-derivatives.ts`), nunca 3 posições
 * ambíguas de um array. `targetLine` ganha o mesmo tratamento de cor
 * (lime só quando `targetStatus === "better"`) já usado nos KPIs
 * secundários — mesma régua canônica, nunca uma segunda. Desktop
 * (`hidden sm:block`) preservado exatamente como sempre foi: parágrafos
 * simples, mesma ordem, via `flattenPeriodReadingLines` (que devolve as
 * MESMAS frases de sempre).
 */
function PeriodReading({ document }: { document: PerformanceReportDocument }) {
  const reading = document.periodReading;
  if (!reading) return null;

  const desktopLines = flattenPeriodReadingLines(reading);
  if (desktopLines.length === 0) return null;

  return (
    <>
      <div className="hidden sm:mt-4 sm:block sm:border-l-[3px] sm:border-[#D8F238] sm:bg-white/55 sm:px-4 sm:py-3.5">
        <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#6F6B65]">Leitura do período</div>
        <div className="flex flex-col gap-1">
          {desktopLines.map((sentence, index) => (
            <p key={index} className="max-w-xl text-sm leading-snug text-[#1E1E20]">
              {sentence}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-6 sm:hidden">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#6F6B65]">Leitura do período</div>
        {reading.kind === "neutral" ? (
          <p className="mt-1.5 text-[15px] text-[#1E1E20]">{reading.message}</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-2">
            <p className="text-[15px] font-semibold leading-snug text-[#17171A]">{reading.summaryLine}</p>
            {reading.targetLine &&
              (reading.targetStatus === "better" ? (
                <span className="inline-block w-fit rounded-full bg-[#D8F238] px-2.5 py-1 text-[13px] font-bold text-[#17171A]">
                  {reading.targetLine}
                </span>
              ) : (
                <p className="text-[13px] font-semibold text-[#17171A]">{reading.targetLine}</p>
              ))}
            {reading.bestCampaignLine && (
              <p className="border-t border-[#D9D3C9] pt-2 text-[13px] text-[#6F6B65]">{reading.bestCampaignLine}</p>
            )}
          </div>
        )}
      </div>
    </>
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
  const methodologyNote = document.summary.status === "ok" ? document.summary.note : null;

  return (
    <div className="mt-3.5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:mt-5 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
      <section id="resumo" className="pb-6 sm:pb-9">
        {/* Etapa "Visual Polish Mobile": desktop preserva o `<h2>` de sempre
            ("Resumo do período" — o eyebrow duplicado já tinha sido
            removido numa etapa anterior). No mobile o título vira um
            rótulo discreto acima do resultado principal (item 4 do
            pedido) — o número grande é quem carrega a hierarquia agora,
            não mais um `<h2>` de 24px competindo com ele. */}
        <h2 className="hidden text-2xl font-bold tracking-tight text-[#17171A] sm:block">Resumo do período</h2>
        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#6F6B65] sm:hidden">Resumo do período</div>
        <div className="mt-2 sm:mt-5">
          <ReportKpiGrid summary={document.summary} hero={document.hero} />
        </div>
        <PeriodReading document={document} />
      </section>

      {document.tables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}

      {/* "Relatório de Performance" já está no <h1> do cabeçalho da página
          (`report-header.tsx`) — nunca repetir aqui, só o que é novo
          (canal + timestamp). Etapa "Visual Polish Mobile", item 7: a nota
          metodológica ("Indicadores calculados...") saiu do fluxo principal
          do mobile (interrompia a leitura entre KPIs e Leitura do período)
          e virou uma linha discreta aqui no rodapé, junto da metadata —
          informação preservada, só sem ocupar destaque no primeiro
          viewport. Desktop continua mostrando a nota no lugar de sempre,
          dentro de `DesktopSummary` (`report-kpi-grid.tsx`). */}
      <div className="border-t border-[#D9D3C9] pt-4 sm:pt-5">
        {methodologyNote && <p className="text-xs text-[#6F6B65] sm:hidden">{methodologyNote}</p>}
        <p className="mt-1 text-xs text-[#6F6B65] sm:mt-0">Meta Ads — gerado em {document.generatedAtLabel}.</p>
      </div>
    </div>
  );
}
