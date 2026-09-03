import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { resolveAnalyticsPeriod } from "@/lib/analytics";
import { todayDateString } from "@/lib/today";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { renderPerformanceReportHtml } from "@/lib/performance-report/renderers/html-renderer";
import { renderReportPdf } from "@/lib/analytics-report/renderers/pdf-renderer";

/**
 * Gerador de Relatório de Performance — Route Handler (não Server Action),
 * mesmo padrão de `/api/clients/[id]/analytics-report`: sem auth manual
 * (`createClient()` cookie-based já escopa `clients` via RLS). Pipeline
 * idêntico ao aprovado na auditoria: dado → documento → HTML → PDF, cada
 * camada só conhecendo a de baixo.
 *
 * `format=html` (padrão) devolve a página pra visualização inline no
 * navegador (o botão "Baixar PDF" já embutido no próprio HTML — ver
 * `renderers/html-renderer.ts` — reaponta pra esta mesma rota com
 * `format=pdf`); `format=pdf` devolve o binário com
 * `Content-Disposition: attachment`, reaproveitando `renderReportPdf` sem
 * NENHUMA alteração (mesma técnica Chromium/`puppeteer-core` já validada em
 * produção pelo AnalyticsReport). v1 é Meta-only — nenhum parâmetro de
 * plataforma aqui.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export function buildPerformanceReportFileName(clientName: string, period: { start: string; end: string }): string {
  const safeName = clientName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `relatorio-performance-${safeName || "cliente"}-${period.start}-${period.end}.pdf`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: client } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const url = new URL(request.url);
  const period = resolveAnalyticsPeriod(url.searchParams.get("analyticsPreset") ?? undefined, todayDateString(), {
    start: url.searchParams.get("analyticsStart") ?? undefined,
    end: url.searchParams.get("analyticsEnd") ?? undefined,
  });
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "html";

  try {
    const data = await buildPerformanceReportData(supabase, id, period);
    const document = buildPerformanceReportDocument(data);

    if (format === "html") {
      const pdfUrl = new URL(request.url);
      pdfUrl.searchParams.set("format", "pdf");
      const html = renderPerformanceReportHtml(document, { pdfHref: `${pdfUrl.pathname}${pdfUrl.search}` });
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const html = renderPerformanceReportHtml(document);

    const pdf = await renderReportPdf(html, null);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${buildPerformanceReportFileName(data.client.name, period)}"`,
      },
    });
  } catch (err) {
    console.error("[performance-report]", err);
    return NextResponse.json({ error: "Não foi possível gerar o relatório." }, { status: 500 });
  }
}
