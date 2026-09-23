import { formatCurrency } from "@/lib/format";
import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportTableSection } from "./report-table-section";

/**
 * Corpo da visão "Objetivos secundários" (Etapa "Separar o Relatório por
 * finalidade das campanhas") — deliberadamente SEM o KPI grid/Resultado
 * Diário/"Leitura do período" de `ReportFilterableTables`: não existe um
 * "resultado" único pra combinar awareness/alcance/seguidores/tráfego/
 * visitas ao perfil (auditoria — nunca soma métricas não-comparáveis).
 * `document.secondarySummary` já é o único consolidado seguro
 * (investimento, a única métrica comparável entre finalidades diferentes).
 * As 4 tabelas usam `ReportTableSection` diretamente (sem o filtro cruzado
 * "Filtro no topo" — cada tabela já tem sua própria ordenação/disclosure).
 */
export function ReportSecondaryView({ document }: { document: PerformanceReportDocument }) {
  const summary = document.secondarySummary;

  return (
    <>
      <section id="resumo" className="pb-6 sm:pb-9">
        <h2 className="hidden text-2xl font-bold tracking-tight text-[#17171A] sm:block">Objetivos secundários</h2>
        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#6F6B65] sm:hidden">Objetivos secundários</div>

        {!summary || summary.breakdown.length === 0 ? (
          <p className="mt-3 text-sm text-[#6F6B65]">Nenhuma campanha classificada como objetivo secundário neste período.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6F6B65]">Investimento total</div>
              <div className="text-2xl font-bold text-[#17171A]">{formatCurrency(summary.totalSpend)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.breakdown.map((entry) => (
                <div
                  key={entry.purpose}
                  className="inline-flex items-center gap-2 rounded-full border border-[#D9D3C9] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#17171A]"
                >
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6F6B65]">{entry.label}</span>
                  <span>{formatCurrency(entry.spend)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#6F6B65]">
              Investimento é a única métrica somada entre finalidades diferentes — impressões, alcance e cliques nunca são
              combinados num total só (cada um só faz sentido dentro da própria campanha/finalidade, ver tabelas abaixo).
            </p>
          </div>
        )}
      </section>

      {document.tables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}
    </>
  );
}
