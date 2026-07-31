/**
 * HTML do smoke test que roda na rota temporária da Vercel
 * (`src/app/api/dev/analytics-report-phase0-smoke/route.ts`). Deliberadamente
 * SEM nenhuma leitura de arquivo (nenhuma fonte/imagem via `fs`) — a
 * fidelidade visual completa (fontes reais incorporadas) já foi validada
 * localmente em `build-test-html.ts`; aqui a única pergunta é "Chromium
 * headless roda dentro de uma function real da Vercel?", então este HTML
 * evita de propósito qualquer variável de empacotamento de asset (Next.js
 * `outputFileTracingIncludes`), que é uma questão diferente. Fontes
 * genéricas do sistema + um SVG inline (nunca lido de disco) bastam pra essa
 * pergunta.
 */
export function buildSmokeHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: sans-serif; color: #18181b; font-size: 11pt; }
  h1 { font-family: serif; font-weight: 700; font-size: 28pt; margin: 0 0 6mm 0; }
  p { line-height: 1.6; margin: 0 0 4mm 0; max-width: 140mm; }
  svg { width: 24mm; margin-bottom: 8mm; }
</style>
</head>
<body>
  <svg viewBox="0 0 24 24" fill="none" stroke="#4169e1" stroke-width="1.5">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18M3 12h18" />
  </svg>
  <h1>Smoke test — Fase 0 do AnalyticsReport</h1>
  <p>Gerado via Chromium headless (puppeteer-core + @sparticuz/chromium) dentro deste Preview Deployment da Vercel — se você está lendo isto como um PDF de verdade, a única pergunta desta rota temporária ("Chromium roda em produção?") tem resposta: sim.</p>
  <p>Timestamp: ${new Date().toISOString()}</p>
</body>
</html>`;
}
