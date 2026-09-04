import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { ReportPeriodControl } from "./report-period-control";
import { buildReportPdfHref } from "./report-period-nav";
import { ReportKpiGrid } from "./report-kpi-grid";
import { ReportTableSection } from "./report-table-section";

/**
 * Etapa "Relatório Nativo": "Cliente → Relatório → relatório" — esta rota É
 * o Relatório de Performance, sempre carregado com dados (padrão: mês
 * atual, sem nenhuma ação prévia), nunca mais uma tela intermediária de
 * seleção de período que só depois abre um HTML separado. O período
 * personalizado/preset em exibição é 100% derivado da URL
 * (`analyticsPreset`/`analyticsStart`/`analyticsEnd`, resolvidos por
 * `resolveAnalyticsPeriod` — mesma função de sempre, nenhuma segunda
 * semântica de data) — refresh/back/forward sempre reproduzem exatamente o
 * mesmo período.
 *
 * Reaproveita 100% a Camada 1/2 já existente (`buildPerformanceReportData`
 * → `buildPerformanceReportDocument`) — a MESMA que alimenta o PDF (rota
 * `/api/clients/[id]/performance-report`, ver `renderers/pdf-renderer.ts`):
 * nenhum cálculo de investimento/CPA/ROAS/resultado é refeito aqui, os
 * componentes desta página só apresentam o `PerformanceReportDocument` já
 * pronto. Uma única consulta a cada troca de período (Server Component
 * refaz o fetch só quando a URL muda); sorting e "ver todos" das tabelas
 * são estado 100% client-side sobre as linhas já buscadas, nunca um
 * refetch.
 */
export default async function ClientPerformanceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ analyticsPreset?: string; analyticsStart?: string; analyticsEnd?: string }>;
}) {
  const { id } = await params;
  const { analyticsPreset: presetParam, analyticsStart: startParam, analyticsEnd: endParam } = await searchParams;
  const supabase = await createSupabaseClient();

  // Mesmo critério de RLS + 404 silencioso de `clients/[id]/page.tsx` — só a
  // existência é confirmada aqui; todo o resto do dado vem de
  // `buildPerformanceReportData`, que já reaproveita seu próprio acesso a
  // `clients` (Camada 1, inalterada).
  const { data: client, error } = await supabase.from("clients").select("id, name").eq("id", id).is("deleted_at", null).single();
  if (error) console.error(`[ClientPerformanceReportPage] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  const today = todayDateString();
  const activePreset = (presetParam ?? "this_month") as AnalyticsPeriodPreset;
  const period = resolveAnalyticsPeriod(presetParam, today, { start: startParam, end: endParam });

  const data = await buildPerformanceReportData(supabase, id, period);
  const document = buildPerformanceReportDocument(data);

  const pdfHref = buildReportPdfHref(client.id, activePreset, { start: period.start, end: period.end });

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <Link href={`/clients/${client.id}`} className="text-sm font-medium text-brand hover:underline">
        &larr; {client.name}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-overview-text-primary">Relatório de Performance</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ReportPeriodControl
            clientId={client.id}
            activePreset={activePreset}
            periodLabel={document.periodLabel}
            customStart={period.start}
            customEnd={period.end}
          />
          <a
            href={pdfHref}
            className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            Baixar PDF
          </a>
        </div>
      </div>

      {/* Identidade visual do Relatório de Performance aprovada anteriormente
          (paleta fixa creme/areia/grafite/branco/verde-limão) — preservada
          tal como no HTML/PDF, só sem os elementos exclusivos de documento
          (hero/marca/nav sticky/impressão): dentro da aplicação, o cabeçalho
          acima já cumpre esse papel. */}
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
    </div>
  );
}
