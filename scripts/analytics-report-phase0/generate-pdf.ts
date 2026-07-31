/**
 * Núcleo de geração de PDF via Chromium headless — compartilhado entre o
 * script de linha de comando e a rota temporária de smoke test, pra nunca
 * ter duas implementações do mesmo "HTML → PDF" divergindo entre elas.
 * Deliberadamente sem medição de memória aqui (isso é específico de cada
 * chamador: o script mede via `ps` na árvore de processos local; a rota
 * na Vercel não precisa — a própria plataforma reporta memória da
 * function nos logs).
 */
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

export const PDF_FOOTER_TEMPLATE =
  '<div style="font-size:8px; width:100%; text-align:center; color:#71717a;">Gerado por MITZA Analytics — página <span class="pageNumber"></span> de <span class="totalPages"></span></div>';

export async function launchChromium(): Promise<{ browser: Browser; executablePathMs: number; launchMs: number }> {
  const t0 = performance.now();
  const executablePath = await chromium.executablePath();
  const executablePathMs = Math.round(performance.now() - t0);

  const tLaunch0 = performance.now();
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true, // @sparticuz/chromium já embute --headless='shell' em `chromium.args`
  });
  const launchMs = Math.round(performance.now() - tLaunch0);

  return { browser, executablePathMs, launchMs };
}

export async function renderPdf(browser: Browser, html: string): Promise<{ pdf: Uint8Array; setContentMs: number; pdfMs: number }> {
  const tContent0 = performance.now();
  const page = await browser.newPage();
  // "load" (não "networkidle0"): o HTML é 100% autocontido (fontes/imagem
  // embutidas via data URI, sem nenhuma requisição de rede) — mesma premissa
  // que o template real do AnalyticsReport vai seguir (ver arquitetura).
  await page.setContent(html, { waitUntil: "load" });
  const setContentMs = Math.round(performance.now() - tContent0);

  const tPdf0 = performance.now();
  const pdf = await page.pdf({
    format: "a4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: PDF_FOOTER_TEMPLATE,
    margin: { top: "20mm", bottom: "16mm", left: "18mm", right: "18mm" },
  });
  const pdfMs = Math.round(performance.now() - tPdf0);

  return { pdf, setContentMs, pdfMs };
}
