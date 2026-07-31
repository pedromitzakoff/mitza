/**
 * Fase 0 do AnalyticsReport (docs/ANALYTICS_REPORT_EXPORT_ARCHITECTURE.md) —
 * spike ISOLADO, sem nenhuma integração com o app. Responde só UMA pergunta:
 * "Chromium Headless é viável pra arquitetura que queremos?"
 *
 * Não usa AnalyticsReportData/Document/Theme, nenhum dado real do Analytics,
 * nenhuma rota da aplicação — só uma página HTML de teste (fontes
 * incorporadas, imagem, tabela, quebra de página, margens, rodapé) convertida
 * em PDF via puppeteer-core + @sparticuz/chromium, medindo tempo/memória/
 * tamanho. Resultado documentado em docs/ANALYTICS_REPORT_PHASE0_RESULTS.md.
 *
 * Mesmo HTML/geração de `src/app/api/dev/analytics-report-phase0-smoke/route.ts`
 * (o smoke test que roda num Preview Deployment real da Vercel) — nunca duas
 * versões divergentes do mesmo teste.
 *
 * Uso:
 *   npm run analytics-report:phase0
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildTestHtml } from "./build-test-html";
import { launchChromium, renderPdf } from "./generate-pdf";

/** `process.memoryUsage()` só mede o processo Node.js que orquestra tudo —
 * o Chromium roda num processo OS separado (`browser.process()`), então a
 * memória real do teste é a soma do processo do Chromium + seus
 * descendentes (mesmo com `--single-process`, ele ainda spawna 1-2
 * processos auxiliares). Soma via `ps`, em KB de RSS. Só faz sentido
 * localmente — numa function da Vercel real, a própria plataforma já
 * reporta a memória do processo inteiro, então a rota de smoke test não
 * reaproveita isto. */
function totalRssKb(rootPid: number): number {
  const lines = execSync("ps -eo pid,ppid,rss").toString().trim().split("\n").slice(1);
  const rows = lines.map((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid, rss };
  });
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => pids.has(row.pid)).reduce((sum, row) => sum + row.rss, 0);
}

const ROOT = join(import.meta.dirname, "..", "..");
const OUTPUT_DIR = join(import.meta.dirname, "output");
const PDF_PATH = join(OUTPUT_DIR, "test-report.pdf");
const RESULTS_PATH = join(OUTPUT_DIR, "results.json");

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("== Fase 0 — Chromium Headless (spike isolado) ==\n");

  const html = buildTestHtml();
  const t0 = performance.now();

  const { browser, executablePathMs, launchMs } = await launchChromium();
  const browserPid = browser.process()?.pid;
  const memAfterLaunchKb = browserPid ? totalRssKb(browserPid) : null;

  const { pdf: pdfBuffer, setContentMs, pdfMs } = await renderPdf(browser, html);
  const memAfterPdfKb = browserPid ? totalRssKb(browserPid) : null;

  await browser.close();
  const totalMs = Math.round(performance.now() - t0);

  writeFileSync(PDF_PATH, pdfBuffer);
  const pdfSizeKb = Math.round(pdfBuffer.byteLength / 1024);
  // page.pdf() devolve Uint8Array (não Buffer) em puppeteer-core recente —
  // Uint8Array.prototype.toString() ignora o encoding, por isso o wrap.
  const pdfText = Buffer.from(pdfBuffer).toString("latin1");

  const results = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    packages: {
      "puppeteer-core": JSON.parse(readFileSync(join(ROOT, "node_modules/puppeteer-core/package.json"), "utf8")).version,
      "@sparticuz/chromium": JSON.parse(readFileSync(join(ROOT, "node_modules/@sparticuz/chromium/package.json"), "utf8")).version,
    },
    timingsMs: { executablePathMs, launchMs, setContentMs, pdfMs, totalMs },
    // RSS somado do processo do Chromium + descendentes (não do processo
    // Node.js orquestrador, que mede quase nada — o trabalho pesado roda
    // inteiro no processo separado do navegador).
    memory: {
      chromiumRssAfterLaunchMb: memAfterLaunchKb !== null ? Math.round(memAfterLaunchKb / 1024) : null,
      chromiumRssAfterPdfMb: memAfterPdfKb !== null ? Math.round(memAfterPdfKb / 1024) : null,
    },
    pdf: {
      path: PDF_PATH,
      sizeKb: pdfSizeKb,
      pageCount: Number(pdfText.match(/\/Type\s*\/Pages[\s\S]{0,40}?\/Count\s+(\d+)/)?.[1] ?? 0),
    },
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

  console.log(JSON.stringify(results, null, 2));
  console.log(`\nPDF salvo em: ${PDF_PATH}`);
  console.log(`Resultados salvos em: ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
