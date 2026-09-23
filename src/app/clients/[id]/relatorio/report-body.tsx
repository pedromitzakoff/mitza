import type { PerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportFilterableTables } from "./report-filterable-tables";
import { ReportSecondaryView } from "./report-secondary-view";

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
 *
 * Etapa "Separar o Relatório por finalidade das campanhas": `topControls`
 * (seletor de visão + "Classificar campanhas", ambos opcionais — só a
 * página interna passa algo aqui, `/r/[token]` nunca) fica acima de tudo,
 * e o corpo em si bifurca por `document.view`: "principal" continua sendo
 * `ReportFilterableTables` 100% intocado (mesmo filtro por nome/KPI/
 * Resultado Diário de sempre); "secundario" é `ReportSecondaryView`, sem
 * nenhum desses três — não existe "resultado" único pra combinar
 * awareness/alcance/seguidores/tráfego/visitas ao perfil.
 */
export function ReportBody({ document, topControls }: { document: PerformanceReportDocument; topControls?: React.ReactNode }) {
  const methodologyNote = document.summary.status === "ok" ? document.summary.note : null;

  return (
    <div className="mt-3.5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:mt-5 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
      {topControls && <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">{topControls}</div>}
      {document.view === "secundario" ? <ReportSecondaryView document={document} /> : <ReportFilterableTables document={document} />}

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
