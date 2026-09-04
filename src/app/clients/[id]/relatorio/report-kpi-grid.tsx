import type { PerformanceReportSummaryBlock } from "@/lib/performance-report/report-document";

/**
 * Resumo Executivo — equivalente nativo de `renderKpiGrid`
 * (`renderers/html-renderer.ts`), mesma identidade visual aprovada (paleta
 * fixa creme/areia/grafite/branco/verde-limão, card do primeiro KPI em
 * destaque). Só apresentação: todo valor já chega formatado em
 * `PerformanceReportSummaryBlock` (`report-document.ts`, Camada 2) — nenhum
 * cálculo de investimento/resultado/custo acontece aqui.
 */
export function ReportKpiGrid({ summary }: { summary: PerformanceReportSummaryBlock }) {
  if (summary.status !== "ok") {
    return <p className="pt-2 text-sm text-[#6F6B65]">{summary.message}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {summary.kpis.map((kpi, index) => {
          const isAccent = index === 0;
          return (
            <div
              key={kpi.key}
              className={
                isAccent
                  ? "min-h-[110px] rounded-2xl border border-[#17171A] bg-[#17171A] p-4 sm:p-5"
                  : "min-h-[110px] rounded-2xl border border-[#D9D3C9] bg-white p-4 sm:p-5"
              }
            >
              <div className={`text-xs font-bold ${isAccent ? "text-[#B9B9BA]" : "text-[#6F6B65]"}`}>{kpi.label}</div>
              <div className={`mt-2.5 text-2xl font-extrabold tracking-tight sm:text-[28px] ${isAccent ? "text-white" : "text-[#17171A]"}`}>
                {kpi.value}
              </div>
              {kpi.comparison && (
                <div className={`mt-2 text-xs ${isAccent ? "text-[#BCBCBD]" : "text-[#6F6B65]"}`}>{kpi.comparison.text}</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-l-[3px] border-[#C8BEAD] bg-white/60 px-4 py-3 text-xs text-[#6F6B65]">{summary.note}</p>
    </>
  );
}
