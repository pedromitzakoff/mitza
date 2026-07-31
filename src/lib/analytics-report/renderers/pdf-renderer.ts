import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { escapeHtml } from "@/lib/html-escape";

/**
 * Única peça que sabe que "PDF" existe — recebe o HTML já pronto (o mesmo
 * template canônico de `html-renderer.ts`) e devolve bytes. Técnica validada
 * na Fase 0 (`docs/ANALYTICS_REPORT_PHASE0_RESULTS.md`, aprovada com smoke
 * test real na Vercel): Chromium headless via `puppeteer-core` +
 * `@sparticuz/chromium`, `waitUntil: "load"` (o HTML é 100% autocontido —
 * sem imagens externas, sem fontes carregadas por rede — `networkidle0`
 * mediu ~900ms a mais sem nenhum ganho real).
 */
function buildFooterTemplate(footerText: string | null): string {
  const label = footerText ? `${escapeHtml(footerText)} — página` : "Página";
  return `<div style="font-size:8px; width:100%; text-align:center; color:#71717a;">${label} <span class="pageNumber"></span> de <span class="totalPages"></span></div>`;
}

export async function renderReportPdf(html: string, footerText: string | null): Promise<Buffer> {
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true, // @sparticuz/chromium já embute --headless='shell' em chromium.args
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: buildFooterTemplate(footerText),
      margin: { top: "14mm", bottom: "14mm", left: "16mm", right: "16mm" },
    });

    // page.pdf() devolve Uint8Array (não Buffer) em versões recentes do
    // puppeteer-core — Buffer.from() explícito, nunca `.toString(encoding)`
    // direto num Uint8Array (ignora silenciosamente o argumento de encoding,
    // achado real da Fase 0).
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
