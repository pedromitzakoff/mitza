import { formatCurrency } from "@/lib/format";
import { isGeneralReportView, type PerformanceReportData } from "@/lib/performance-report/report-data";
import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportFilterableTables } from "./report-filterable-tables";

/**
 * Painorama de funis (Visão geral, Etapa "Gestão de Funis Estratégicos por
 * Cliente") — investimento total do cliente + como ele se reparte entre os
 * funis existentes. Só investimento é comparável entre funis diferentes
 * (nunca soma resultado — leads/vendas/seguidores de funis diferentes não
 * são somáveis). Só renderizado quando o cliente tem pelo menos um funil
 * configurado (`funnelPanorama !== null`) — cliente sem funil nunca vê este
 * bloco, Relatório idêntico ao de sempre.
 */
function FunnelPanorama({
  panorama,
  pendingCount,
}: {
  panorama: NonNullable<PerformanceReportData["funnelPanorama"]>;
  pendingCount: number;
}) {
  return (
    <section id="funis" className="pb-6 sm:pb-9">
      <h2 className="hidden text-2xl font-bold tracking-tight text-[#17171A] sm:block">Funis</h2>
      <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#6F6B65] sm:hidden">Funis</div>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6F6B65]">Investimento total</div>
          <div className="text-2xl font-bold text-[#17171A]">{formatCurrency(panorama.totalSpend)}</div>
        </div>

        {panorama.breakdown.length === 0 && panorama.unassignedSpend === 0 ? (
          <p className="text-sm text-[#6F6B65]">Nenhuma campanha com investimento neste período ainda tem funil confirmado.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {panorama.breakdown.map((entry) => (
              <div
                key={entry.funnelId}
                className="inline-flex items-center gap-2 rounded-full border border-[#D9D3C9] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#17171A]"
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6F6B65]">{entry.funnelName}</span>
                <span>{formatCurrency(entry.spend)}</span>
              </div>
            ))}
            {panorama.unassignedSpend > 0 && (
              <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#D9D3C9] bg-white/40 px-3 py-1.5 text-xs font-semibold text-[#6F6B65]">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em]">Sem funil</span>
                <span>{formatCurrency(panorama.unassignedSpend)}</span>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-[#6F6B65]">
          Investimento é a única métrica somada entre funis diferentes — resultados de funis distintos nunca são combinados
          num total só (cada funil tem seus próprios indicadores, ver seletor abaixo).
          {pendingCount > 0 &&
            ` ${pendingCount} campanha${pendingCount > 1 ? "s" : ""} do período ainda ${pendingCount > 1 ? "não têm" : "não tem"} funil confirmado — classifique na seção Funis da página do cliente.`}
        </p>
      </div>
    </section>
  );
}

/**
 * Corpo do Relatório de Performance nativo — identidade visual aprovada
 * (paleta fixa creme/areia/grafite/branco/verde-limão), compartilhado, sem
 * duplicação, entre a página interna (`/clients/[id]/relatorio`) e o link
 * externo somente leitura (`/r/[token]`).
 *
 * Etapa "Gestão de Funis Estratégicos por Cliente": substitui a bifurcação
 * anterior (`ReportSecondaryView` vs. `ReportFilterableTables`) por um único
 * corpo — `ReportFilterableTables` já é genérico o bastante pra renderizar
 * tanto "Visão geral" quanto "Visão por funil" (as duas só diferem nos DADOS
 * que `report-data.ts`/`report-document.ts` já entregam prontos, nunca num
 * componente de corpo próprio por visão). O painorama de funis aparece só na
 * Visão geral, acima das tabelas.
 */
export function ReportBody({ document, topControls }: { document: PerformanceReportDocument; topControls?: React.ReactNode }) {
  const methodologyNote = document.summary.status === "ok" ? document.summary.note : null;

  return (
    <div className="mt-3.5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:mt-5 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
      {topControls && <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">{topControls}</div>}

      {isGeneralReportView(document.view) && document.funnelPanorama && (
        <FunnelPanorama panorama={document.funnelPanorama} pendingCount={document.pendingFunnelCampaignNames.length} />
      )}

      {!isGeneralReportView(document.view) && document.funnelFilterMayBeIncomplete && (
        <p className="mb-4 rounded-md border border-dashed border-[#D9D3C9] bg-white/50 px-3 py-2 text-xs text-[#6F6B65]">
          Algumas campanhas deste funil não têm ID confiável ou têm nome ambíguo entre campanhas do período — Públicos,
          Criativos e Posicionamentos abaixo podem estar incompletos pra este funil especificamente (Campanhas continua
          completo, sempre filtrado por ID).
        </p>
      )}

      <ReportFilterableTables document={document} />

      <div className="border-t border-[#D9D3C9] pt-4 sm:pt-5">
        {methodologyNote && <p className="text-xs text-[#6F6B65] sm:hidden">{methodologyNote}</p>}
        <p className="mt-1 text-xs text-[#6F6B65] sm:mt-0">Meta Ads — gerado em {document.generatedAtLabel}.</p>
      </div>
    </div>
  );
}
