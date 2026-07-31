/**
 * HTML de teste completo da Fase 0 (fontes reais incorporadas via
 * @font-face + data URI, lidas de `scripts/analytics-report-phase0/assets/`)
 * — usado só pelo script de linha de comando (`generate-test-pdf.ts`), que
 * roda localmente. A rota de smoke test na Vercel
 * (`src/app/api/dev/analytics-report-phase0-smoke/route.ts`) usa
 * `build-smoke-html.ts`, uma versão sem leitura de arquivo — o
 * empacotamento de assets lidos via `fs` dentro de uma função serverless da
 * Vercel é uma variável própria (`outputFileTracingIncludes`), diferente da
 * pergunta que o smoke test existe pra responder ("Chromium roda?"), então
 * não vale misturar as duas nesta validação.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = join(import.meta.dirname, "assets");

function toBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

export function buildTestHtml(): string {
  const crimsonRegular = toBase64(join(ASSETS_DIR, "fonts", "CrimsonPro-Regular.ttf"));
  const crimsonBold = toBase64(join(ASSETS_DIR, "fonts", "CrimsonPro-Bold.ttf"));
  const bricolageRegular = toBase64(join(ASSETS_DIR, "fonts", "BricolageGrotesque-Regular.ttf"));
  const bricolageBold = toBase64(join(ASSETS_DIR, "fonts", "BricolageGrotesque-Bold.ttf"));
  const logoSvgBase64 = toBase64(join(ASSETS_DIR, "logo.svg"));

  return `<!doctype html>
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
}
