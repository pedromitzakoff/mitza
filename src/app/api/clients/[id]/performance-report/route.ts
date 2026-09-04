import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { resolveAnalyticsPeriod } from "@/lib/analytics";
import { todayDateString } from "@/lib/today";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { renderPerformanceReportHtml } from "@/lib/performance-report/renderers/html-renderer";
import { renderReportPdf } from "@/lib/performance-report/renderers/pdf-renderer";

/**
 * Gerador do PDF do Relatório de Performance — Route Handler (não Server
 * Action): sem auth manual (`createClient()` cookie-based já escopa
 * `clients` via RLS). Pipeline: dado → documento → HTML → PDF, cada camada
 * só conhecendo a de baixo — mesma Camada 1/2 (`report-data`/
 * `report-document`) usada pela página nativa (`/clients/[id]/relatorio`),
 * nunca um segundo cálculo de métricas.
 *
 * Etapa "Relatório Nativo": esta rota deixou de servir HTML pra visualização
 * (`format=html`) — a experiência principal agora é a página nativa; aqui
 * sobra só a exportação em PDF, sempre binário com
 * `Content-Disposition: attachment`. `renderPerformanceReportHtml`
 * (`renderers/html-renderer.ts`) continua existindo como infraestrutura
 * interna — o PDF é gerado renderizando esse HTML em Chromium headless
 * (`renderers/pdf-renderer.ts`), nunca visível diretamente ao usuário. v1 é
 * Meta-only — nenhum parâmetro de plataforma aqui.
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

  try {
    const data = await buildPerformanceReportData(supabase, id, period);
    const document = buildPerformanceReportDocument(data);
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
