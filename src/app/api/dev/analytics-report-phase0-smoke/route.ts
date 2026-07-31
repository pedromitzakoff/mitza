import { NextResponse } from "next/server";
import { buildSmokeHtml } from "../../../../../scripts/analytics-report-phase0/build-smoke-html";
import { launchChromium, renderPdf } from "../../../../../scripts/analytics-report-phase0/generate-pdf";

/**
 * Rota TEMPORÁRIA de smoke test da Fase 0 do AnalyticsReport (ver
 * docs/ANALYTICS_REPORT_EXPORT_ARCHITECTURE.md e
 * docs/ANALYTICS_REPORT_PHASE0_RESULTS.md) — existe só pra confirmar que
 * Chromium headless funciona dentro de um Preview Deployment real da
 * Vercel, único item que a Fase 0 não conseguiu validar rodando localmente.
 *
 * DELETAR esta rota (e este comentário) assim que o smoke test for
 * confirmado — nunca deixar em produção. Bloqueada em produção por
 * segurança (nunca queremos rodar Chromium headless numa rota pública sem
 * autenticação de verdade), mas o bloqueio é só uma segunda trava — o
 * plano é remover o arquivo inteiro, não deixá-lo desativado por aqui.
 *
 * Sem dado real do Analytics, sem AnalyticsReportData/Document/Theme — HTML
 * de teste dedicado (`build-smoke-html.ts`), sem nenhuma leitura de arquivo
 * (evita de propósito a variável de empacotamento de asset da Vercel,
 * questão diferente da que este smoke test existe pra responder). A
 * fidelidade visual completa (fontes reais) já foi validada localmente na
 * Fase 0 (`npm run analytics-report:phase0`) — ver
 * docs/ANALYTICS_REPORT_PHASE0_RESULTS.md.
 *
 * Uso: GET /api/dev/analytics-report-phase0-smoke?secret=<CRON_SECRET>
 *      GET /api/dev/analytics-report-phase0-smoke?secret=<CRON_SECRET>&format=pdf
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Não disponível em produção" }, { status: 404 });
  }

  const url = new URL(request.url);
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && url.searchParams.get("secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const html = buildSmokeHtml();
    const t0 = performance.now();

    const { browser, executablePathMs, launchMs } = await launchChromium();
    const { pdf, setContentMs, pdfMs } = await renderPdf(browser, html);
    await browser.close();

    const totalMs = Math.round(performance.now() - t0);
    const pdfSizeKb = Math.round(pdf.byteLength / 1024);

    if (url.searchParams.get("format") === "pdf") {
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline; filename=phase0-smoke-test.pdf",
          "X-Total-Ms": String(totalMs),
          "X-Pdf-Size-Kb": String(pdfSizeKb),
        },
      });
    }

    return NextResponse.json({
      vercelEnv: process.env.VERCEL_ENV ?? "local",
      vercelRegion: process.env.VERCEL_REGION ?? null,
      timingsMs: { executablePathMs, launchMs, setContentMs, pdfMs, totalMs },
      pdf: { sizeKb: pdfSizeKb },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
