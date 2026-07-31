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
 * Uso:
 *   npm run analytics-report:phase0
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/** `process.memoryUsage()` só mede o processo Node.js que orquestra tudo —
 * o Chromium roda num processo OS separado (`browser.process()`), então a
 * memória real do teste é a soma do processo do Chromium + seus
 * descendentes (mesmo com `--single-process`, ele ainda spawna 1-2
 * processos auxiliares). Soma via `ps`, em KB de RSS. */
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

function toBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const fontsDir = "/mnt/skills/examples/canvas-design/canvas-fonts";
  const crimsonRegular = toBase64(join(fontsDir, "CrimsonPro-Regular.ttf"));
  const crimsonBold = toBase64(join(fontsDir, "CrimsonPro-Bold.ttf"));
  const bricolageRegular = toBase64(join(fontsDir, "BricolageGrotesque-Regular.ttf"));
  const bricolageBold = toBase64(join(fontsDir, "BricolageGrotesque-Bold.ttf"));
  const logoSvgBase64 = toBase64(join(ROOT, "public", "globe.svg"));

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "Crimson Pro";
    src: url(data:font/ttf;base64,${crimsonRegular}) format("truetype");
    font-weight: 400;
  }
  @font-face {
    font-family: "Crimson Pro";
    src: url(data:font/ttf;base64,${crimsonBold}) format("truetype");
    font-weight: 700;
  }
  @font-face {
    font-family: "Bricolage Grotesque";
    src: url(data:font/ttf;base64,${bricolageRegular}) format("truetype");
    font-weight: 400;
  }
  @font-face {
    font-family: "Bricolage Grotesque";
    src: url(data:font/ttf;base64,${bricolageBold}) format("truetype");
    font-weight: 700;
  }

  @page { size: A4; margin: 20mm 18mm; }

  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: "Bricolage Grotesque", sans-serif; color: #18181b; font-size: 11pt; }
  h1, h2 { font-family: "Crimson Pro", serif; font-weight: 700; margin: 0 0 6mm 0; }
  h1 { font-size: 32pt; }
  h2 { font-size: 18pt; color: #4169e1; }
  p { line-height: 1.6; margin: 0 0 4mm 0; }

  .page { break-after: page; }
  .page:last-child { break-after: auto; }

  .cover { height: 233mm; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
  .cover img { width: 28mm; margin-bottom: 10mm; }
  .cover .eyebrow { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; margin-bottom: 4mm; }

  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 4mm; }
  th, td { text-align: left; padding: 3mm 2mm; border-bottom: 1px solid #e4e4e7; }
  th { text-transform: uppercase; font-size: 8pt; letter-spacing: 0.04em; color: #71717a; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }

  .kpi-grid { display: flex; gap: 10mm; margin: 6mm 0; }
  .kpi { display: flex; flex-direction: column; gap: 1mm; }
  .kpi .label { font-size: 8pt; text-transform: uppercase; color: #71717a; }
  .kpi .value { font-size: 16pt; font-weight: 700; font-variant-numeric: tabular-nums; }

  .chart-bar { display: flex; align-items: flex-end; gap: 3mm; height: 40mm; margin: 6mm 0; }
  .chart-bar .bar { background: #4169e1; width: 12mm; border-radius: 1mm 1mm 0 0; }

  .long-filler p { max-width: 140mm; }
</style>
</head>
<body>

  <section class="page cover">
    <img src="data:image/svg+xml;base64,${logoSvgBase64}" alt="logo de teste" />
    <p class="eyebrow">MITZA Analytics — documento de teste (Fase 0)</p>
    <h1>Cliente de Teste</h1>
    <p>Período analisado: 1 a 31 de julho de 2026</p>
  </section>

  <section class="page">
    <h2>Resumo Executivo</h2>
    <p>Este parágrafo usa Crimson Pro incorporada via @font-face + data URI, exatamente como o template real do AnalyticsReport faria — sem depender de nenhuma fonte instalada no ambiente de execução. Leads cresceram 18% no período, puxados principalmente pelo canal Meta Ads.</p>

    <div class="kpi-grid">
      <div class="kpi"><span class="label">Investimento</span><span class="value">R$ 24.680</span></div>
      <div class="kpi"><span class="label">Leads</span><span class="value">438</span></div>
      <div class="kpi"><span class="label">CPL</span><span class="value">R$ 56,35</span></div>
      <div class="kpi"><span class="label">ROAS</span><span class="value">4.2x</span></div>
    </div>

    <div class="chart-bar">
      <div class="bar" style="height: 40%"></div>
      <div class="bar" style="height: 65%"></div>
      <div class="bar" style="height: 50%"></div>
      <div class="bar" style="height: 90%"></div>
      <div class="bar" style="height: 75%"></div>
      <div class="bar" style="height: 100%"></div>
    </div>
    <p>Gráfico de barras desenhado em SVG/CSS puro — valida se o Renderer consegue reproduzir visualizações simples sem depender de rasterização de canvas.</p>
  </section>

  <section class="page">
    <h2>Campanhas (tabela consolidada)</h2>
    <table>
      <thead><tr><th>Campanha</th><th class="num">Investimento</th><th class="num">Leads</th><th class="num">CPL</th></tr></thead>
      <tbody>
        <tr><td>Captação Julho</td><td class="num">R$ 8.200</td><td class="num">156</td><td class="num">R$ 52,56</td></tr>
        <tr><td>Remarketing Institucional</td><td class="num">R$ 5.400</td><td class="num">98</td><td class="num">R$ 55,10</td></tr>
        <tr><td>Formulário WhatsApp</td><td class="num">R$ 6.980</td><td class="num">122</td><td class="num">R$ 57,21</td></tr>
        <tr><td>Consulta Gratuita</td><td class="num">R$ 4.100</td><td class="num">62</td><td class="num">R$ 66,13</td></tr>
      </tbody>
    </table>
  </section>

  <section class="page long-filler">
    <h2>Teste de quebra de página</h2>
    ${Array.from({ length: 18 }, (_, i) => `<p>Parágrafo de preenchimento ${i + 1} — repetido só pra forçar o conteúdo a ultrapassar uma página inteira e validar se a quebra acontece de forma limpa, sem cortar uma linha de texto ao meio nem sobrepor o rodapé.</p>`).join("\n    ")}
  </section>

</body>
</html>`;

  console.log("== Fase 0 — Chromium Headless (spike isolado) ==\n");

  const timings: Record<string, number> = {};
  const t0 = performance.now();

  const executablePath = await chromium.executablePath();
  timings.executablePathMs = Math.round(performance.now() - t0);

  const tLaunch0 = performance.now();
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true, // @sparticuz/chromium já embute --headless='shell' em `chromium.args`
  });
  timings.launchMs = Math.round(performance.now() - tLaunch0);

  const browserPid = browser.process()?.pid;
  const memAfterLaunchKb = browserPid ? totalRssKb(browserPid) : null;

  const tContent0 = performance.now();
  const page = await browser.newPage();
  // "load" (não "networkidle0"): o HTML é 100% autocontido (fontes/imagem
  // embutidas via data URI, sem nenhuma requisição de rede) — mesma premissa
  // que o template real do AnalyticsReport vai seguir (ver arquitetura).
  await page.setContent(html, { waitUntil: "load" });
  timings.setContentMs = Math.round(performance.now() - tContent0);

  const tPdf0 = performance.now();
  const pdfBuffer = await page.pdf({
    format: "a4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font-size:8px; width:100%; text-align:center; color:#71717a;">Gerado por MITZA Analytics — página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
    margin: { top: "20mm", bottom: "16mm", left: "18mm", right: "18mm" },
  });
  timings.pdfMs = Math.round(performance.now() - tPdf0);

  const memAfterPdfKb = browserPid ? totalRssKb(browserPid) : null;

  await browser.close();
  timings.totalMs = Math.round(performance.now() - t0);

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
    timingsMs: timings,
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
