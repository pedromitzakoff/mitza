import type { PerformanceReportSummaryBlock } from "@/lib/performance-report/report-document";

/**
 * Resumo Executivo — equivalente nativo de `renderKpiGrid`
 * (`renderers/html-renderer.ts`), mesma identidade visual aprovada (paleta
 * fixa creme/areia/grafite/branco/verde-limão, card do primeiro KPI em
 * destaque). Só apresentação: todo valor já chega formatado em
 * `PerformanceReportSummaryBlock` (`report-document.ts`, Camada 2) — nenhum
 * cálculo de investimento/resultado/custo acontece aqui.
 *
 * Etapa "Otimização Mobile": a auditoria confirmou que, em 320px, o
 * Investimento (primeiro KPI) dividia a linha meio a meio com o segundo
 * card — o valor formatado ("R$ 10.679,56", uma só palavra sem ponto de
 * quebra) precisava de mais largura do que a metade da tela oferecia, e o
 * excesso ficava visualmente coberto pelo card vizinho (`scrollWidth` >
 * `clientWidth` medido na própria div do valor). `col-span-2 sm:col-span-1`
 * faz o card de destaque ocupar a largura cheia só no mobile — a partir de
 * `sm` a grade volta a ser idêntica à de sempre (4 colunas, todos os cards
 * do mesmo tamanho).
 */
export function ReportKpiGrid({ summary }: { summary: PerformanceReportSummaryBlock }) {
  if (summary.status !== "ok") {
    return <p className="pt-2 text-sm text-[#6F6B65]">{summary.message}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3.5">
        {summary.kpis.map((kpi, index) => {
          const isAccent = index === 0;
          return (
            <div
              key={kpi.key}
              className={
                (isAccent
                  ? "min-h-[92px] rounded-2xl border border-[#17171A] bg-[#17171A] p-3.5 sm:min-h-[110px] sm:p-5"
                  : "min-h-[92px] rounded-2xl border border-[#D9D3C9] bg-white p-3.5 sm:min-h-[110px] sm:p-5") +
                (isAccent ? " col-span-2 sm:col-span-1" : "")
              }
            >
              <div className={`text-[11px] font-bold sm:text-xs ${isAccent ? "text-[#B9B9BA]" : "text-[#6F6B65]"}`}>{kpi.label}</div>
              <div className={`mt-1.5 text-xl font-extrabold tracking-tight sm:mt-2.5 sm:text-[28px] ${isAccent ? "text-white" : "text-[#17171A]"}`}>
                {kpi.value}
              </div>
              {kpi.comparison && (
                <div className={`mt-1.5 text-[11px] leading-snug sm:mt-2 sm:text-xs ${isAccent ? "text-[#BCBCBD]" : "text-[#6F6B65]"}`}>
                  {kpi.comparison.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-l-[3px] border-[#C8BEAD] bg-white/60 px-3.5 py-2.5 text-xs text-[#6F6B65] sm:mt-4 sm:px-4 sm:py-3">{summary.note}</p>
    </>
  );
}
