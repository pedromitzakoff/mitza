import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { resolveAnalyticsPeriod } from "@/lib/analytics";
import { todayDateString } from "@/lib/today";
import { buildAnalyticsReportData } from "@/lib/analytics-report/report-data";
import { buildAnalyticsReportDocument } from "@/lib/analytics-report/report-document";
import { resolveReportTheme } from "@/lib/analytics-report/report-theme";
import { renderReportHtml } from "@/lib/analytics-report/renderers/html-renderer";
import { renderReportPdf } from "@/lib/analytics-report/renderers/pdf-renderer";

/**
 * Camada 5 do AnalyticsReport (entrega) — Route Handler, não Server Action:
 * download binário nativo do navegador via `Content-Disposition: attachment`,
 * sem a complexidade de RPC com resposta binária que uma Server Action
 * exigiria. Nenhum auth manual — `createClient()` (cookie-based) já escopa
 * `clients` ao que o usuário autenticado pode ver via RLS, mesmo critério de
 * 404 silencioso de `clients/[id]/page.tsx`.
 *
 * Pipeline completo, cada camada só conhecendo a de baixo (ver
 * `docs/ANALYTICS_REPORT_EXPORT_ARCHITECTURE.md`): dado → documento → tema →
 * HTML → PDF. v1 não persiste nada — gerado sob demanda a cada requisição.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export function buildFileName(clientName: string, period: { start: string; end: string }): string {
  const safeName = clientName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `analytics-${safeName || "cliente"}-${period.start}-${period.end}.pdf`;
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
    const data = await buildAnalyticsReportData(supabase, id, period);
    const document = buildAnalyticsReportDocument(data);
    const theme = await resolveReportTheme(supabase, id);
    const html = renderReportHtml(document, theme);
    const pdf = await renderReportPdf(html, theme.footerText);

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${buildFileName(data.client.name, period)}"`,
      },
    });
  } catch (err) {
    console.error("[analytics-report]", err);
    return NextResponse.json({ error: "Não foi possível gerar o relatório." }, { status: 500 });
  }
}
