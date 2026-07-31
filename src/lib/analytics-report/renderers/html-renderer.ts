import { formatCurrency, formatPercent, formatShortDate } from "@/lib/format";
import { buildSmoothPath, buildTickIndices, scalePoints } from "@/lib/chart-geometry";
import { escapeHtml } from "@/lib/html-escape";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { AnalyticsKpiCard, AnalyticsTrend } from "@/lib/analytics";
import type { PeriodHighlight } from "@/lib/period-highlights";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { AnalyticsReportBlock, AnalyticsReportDocument } from "../report-document";
import type { ReportTheme } from "../report-theme";

/**
 * Camada 4 do AnalyticsReport — o template canônico ÚNICO (HTML/CSS real),
 * nunca dois templates ("um pra tela, um pro PDF"). `renderReportHtml`
 * percorre `document.pages[].blocks[]` e desenha por `block.type` (dispatcher
 * puro, nunca por conceito de negócio) — a mesma função gera o HTML que a
 * Camada 5 imprime como PDF (Chromium headless) e, no futuro, a página
 * compartilhável/e-mail servem sem reescrever nada.
 *
 * Fase 1-2 (reprodução fiel, sem enriquecimento): sem imagens de criativo
 * (`previewImageUrl` fica de fora — Fase 0 mediu ~900ms extra e uma
 * dependência de rede real com `waitUntil: "networkidle0"`; este HTML é
 * 100% autocontido, `waitUntil: "load"` continua válido), sem fontes
 * customizadas (system font stack), sem capa premium. O gráfico de evolução
 * reaproveita a MESMA geometria de `analytics-trend-chart.tsx`
 * (`lib/chart-geometry.ts`) — mesma curva, mesmos eixos, só sem a camada de
 * hover/crosshair (que não existe num PDF estático).
 */

const CHART_DIMENSIONS = { width: 720, height: 220, paddingX: 8, paddingY: 16 };
const CHART_GRIDLINES = 3;
const SECONDARY_SERIES_COLOR = "#71717a";

function renderCover(block: Extract<AnalyticsReportBlock, { type: "cover" }>, theme: ReportTheme): string {
  const brand =
    theme.showCoverBranding && (theme.logoUrl || theme.brandName)
      ? `<div class="cover-brand">${
          theme.logoUrl ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.brandName ?? "")}" class="cover-logo" />` : `<p class="cover-brand-name">${escapeHtml(theme.brandName!)}</p>`
        }</div>`
      : "";

  return `
    <section class="report-page cover-page">
      ${brand}
      <p class="cover-eyebrow">Relatório de Analytics</p>
      <h1 class="cover-client">${escapeHtml(block.clientName)}</h1>
      <p class="cover-period">${escapeHtml(block.periodLabel)}</p>
      <p class="cover-generated">Gerado em ${escapeHtml(block.generatedAtLabel)}</p>
    </section>`;
}

function renderEmptyState(block: Extract<AnalyticsReportBlock, { type: "empty-state" }>): string {
  return `<div class="empty-state"><p>${escapeHtml(block.message)}</p></div>`;
}

function renderHero(block: Extract<AnalyticsReportBlock, { type: "hero" }>): string {
  return `
    <div class="hero">
      <h1 class="hero-headline">${escapeHtml(block.headline)}</h1>
      <p class="hero-lede">${escapeHtml(block.lede)}</p>
    </div>`;
}

const KPI_TONE_CLASS: Record<NonNullable<AnalyticsKpiCard["comparison"]>["tone"], string> = {
  positive: "kpi-comparison--positive",
  negative: "kpi-comparison--negative",
  neutral: "kpi-comparison--neutral",
};

function renderKpiGrid(block: Extract<AnalyticsReportBlock, { type: "kpi-grid" }>): string {
  return `
    <div class="kpi-grid">
      ${block.cards
        .map(
          (card) => `
        <div class="kpi-card">
          <p class="kpi-label">${escapeHtml(card.label)}</p>
          <p class="kpi-value">${escapeHtml(card.value)}</p>
          ${card.comparison ? `<p class="kpi-comparison ${KPI_TONE_CLASS[card.comparison.tone]}">${escapeHtml(card.comparison.text)}</p>` : ""}
        </div>`,
        )
        .join("")}
    </div>`;
}

function renderTrendChart(block: Extract<AnalyticsReportBlock, { type: "trend-chart" }>, theme: ReportTheme): string {
  const trend: AnalyticsTrend = block.trend;
  const primary = trend.result ?? trend.spend;
  const secondary = trend.result ? trend.spend : null;

  const primaryPoints = scalePoints(primary.points, CHART_DIMENSIONS);
  const secondaryPoints = secondary ? scalePoints(secondary.points, CHART_DIMENSIONS) : null;
  const tickIndices = buildTickIndices(primaryPoints.length);

  const gridLines = Array.from({ length: CHART_GRIDLINES }, (_, i) => {
    const y = CHART_DIMENSIONS.paddingY + (i * (CHART_DIMENSIONS.height - CHART_DIMENSIONS.paddingY * 2)) / (CHART_GRIDLINES - 1);
    return `<line x1="0" y1="${y}" x2="${CHART_DIMENSIONS.width}" y2="${y}" stroke="#e4e4e7" stroke-width="1" opacity="0.6" />`;
  }).join("");

  const secondaryPath = secondaryPoints
    ? `<path d="${buildSmoothPath(secondaryPoints)}" fill="none" stroke="${SECONDARY_SERIES_COLOR}" stroke-width="2" stroke-linecap="round" opacity="0.55" />`
    : "";
  const primaryPath = `<path d="${buildSmoothPath(primaryPoints)}" fill="none" stroke="${theme.accentColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;

  const legend = `
    <div class="trend-legend">
      <span class="trend-legend-item"><span class="trend-dot" style="background:${theme.accentColor}"></span>${escapeHtml(primary.label)}</span>
      ${secondary ? `<span class="trend-legend-item"><span class="trend-dot" style="background:${SECONDARY_SERIES_COLOR}"></span>${escapeHtml(secondary.label)}</span>` : ""}
    </div>`;

  const ticks = tickIndices
    .map((index) => `<span class="trend-tick" style="left:${((primaryPoints[index].x / CHART_DIMENSIONS.width) * 100).toFixed(2)}%">${escapeHtml(formatShortDate(primaryPoints[index].date))}</span>`)
    .join("");

  return `
    <div class="trend-chart">
      ${legend}
      <svg viewBox="0 0 ${CHART_DIMENSIONS.width} ${CHART_DIMENSIONS.height}" preserveAspectRatio="none" class="trend-svg">
        ${gridLines}
        ${secondaryPath}
        ${primaryPath}
      </svg>
      <div class="trend-ticks">${ticks}</div>
      ${block.caption ? `<p class="trend-caption">${escapeHtml(block.caption)}</p>` : ""}
    </div>`;
}

function renderHighlightCards(block: Extract<AnalyticsReportBlock, { type: "highlight-cards" }>): string {
  return `
    <div class="highlight-grid">
      ${block.highlights
        .map(
          (highlight: PeriodHighlight) => `
        <div class="highlight-card ${highlight.key === "cpa-alert" ? "highlight-card--alert" : ""}">
          <p class="highlight-title"><span aria-hidden="true">${highlight.emoji}</span> ${escapeHtml(highlight.title)}</p>
          ${highlight.lines.map((line, index) => `<p class="${index === 0 ? "highlight-line-primary" : "highlight-line-secondary"}">${escapeHtml(line)}</p>`).join("")}
        </div>`,
        )
        .join("")}
    </div>`;
}

function renderNarrative(block: Extract<AnalyticsReportBlock, { type: "narrative" }>): string {
  return `
    <div class="narrative">
      <h2 class="section-title">${escapeHtml(block.title)}</h2>
      <p class="narrative-body">${escapeHtml(block.sentences.join(" "))}</p>
    </div>`;
}

function renderBulletList(block: Extract<AnalyticsReportBlock, { type: "bullet-list" }>): string {
  return `
    <div class="bullet-list">
      <p class="bullet-list-title">${escapeHtml(block.title)}</p>
      <ul>
        ${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>`;
}

function renderCreativeStat(label: string, value: string): string {
  return `<div class="stat"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function renderCreativeCard(summary: CreativeSummary): string {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;
  const stats: string[] = [renderCreativeStat("Investimento", formatCurrency(summary.totalSpend))];
  if (goalConfig && summary.totalResultCount !== null) stats.push(renderCreativeStat(goalConfig.resultMetricLabel, String(summary.totalResultCount)));
  if (goalConfig && summary.cpa !== null) stats.push(renderCreativeStat(goalConfig.costMetricShortLabel, formatCurrency(summary.cpa)));
  if (summary.totalImpressions !== null) stats.push(renderCreativeStat("Impressões", summary.totalImpressions.toLocaleString("pt-BR")));
  if (summary.totalReach !== null) stats.push(renderCreativeStat("Alcance", summary.totalReach.toLocaleString("pt-BR")));
  if (summary.totalClicks !== null) stats.push(renderCreativeStat("Cliques", summary.totalClicks.toLocaleString("pt-BR")));
  if (summary.ctr !== null) stats.push(renderCreativeStat("CTR", formatPercent(summary.ctr * 100)));
  if (summary.roas !== null) stats.push(renderCreativeStat("ROAS", `${summary.roas.toFixed(2)}x`));

  return `
    <div class="card">
      <p class="card-title">${escapeHtml(summary.creativeName)}</p>
      <p class="card-subtitle">${summary.campaignNames.length} ${summary.campaignNames.length === 1 ? "campanha" : "campanhas"}</p>
      <div class="card-stats">${stats.join("")}</div>
    </div>`;
}

function renderCreativeCards(block: Extract<AnalyticsReportBlock, { type: "creative-cards" }>): string {
  return `<div class="card-grid">${block.creatives.map(renderCreativeCard).join("")}</div>`;
}

function renderCampaignCard(summary: CampaignSummary): string {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;
  const metrics: string[] = [];
  if (goalConfig && summary.totalResultCount !== null) metrics.push(`${summary.totalResultCount} ${escapeHtml(goalConfig.resultMetricLabel)}`);
  if (goalConfig && summary.cpa !== null) metrics.push(`${escapeHtml(goalConfig.costMetricShortLabel)} ${formatCurrency(summary.cpa)}`);
  if (summary.roas !== null) metrics.push(`ROAS ${summary.roas.toFixed(2)}x`);

  return `
    <div class="card">
      <p class="card-title">${escapeHtml(summary.campaignName)}</p>
      <p class="card-subtitle">${summary.creativeCount} ${summary.creativeCount === 1 ? "criativo" : "criativos"}</p>
      <p class="stat-label">Investimento</p>
      <p class="campaign-spend">${formatCurrency(summary.totalSpend)}</p>
      ${metrics.length > 0 ? `<p class="campaign-metrics">${metrics.join(" · ")}</p>` : ""}
    </div>`;
}

function renderCampaignCards(block: Extract<AnalyticsReportBlock, { type: "campaign-cards" }>): string {
  return `<div class="card-grid">${block.campaigns.map(renderCampaignCard).join("")}</div>`;
}

function renderBlock(block: AnalyticsReportBlock, theme: ReportTheme): string {
  switch (block.type) {
    case "cover":
      return renderCover(block, theme);
    case "empty-state":
      return renderEmptyState(block);
    case "hero":
      return renderHero(block);
    case "kpi-grid":
      return renderKpiGrid(block);
    case "trend-chart":
      return renderTrendChart(block, theme);
    case "highlight-cards":
      return renderHighlightCards(block);
    case "narrative":
      return renderNarrative(block);
    case "bullet-list":
      return renderBulletList(block);
    case "creative-cards":
      return renderCreativeCards(block);
    case "campaign-cards":
      return renderCampaignCards(block);
  }
}

const STYLESHEET = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #18181b;
    font-size: 12px;
    line-height: 1.5;
  }
  .report-page { padding: 6mm 2mm; break-after: page; }
  .report-page:last-child { break-after: auto; }
  .page-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin: 0 0 6mm; }

  .cover-page { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 250mm; text-align: center; gap: 4mm; }
  .cover-brand { margin-bottom: 8mm; }
  .cover-logo { max-height: 14mm; }
  .cover-brand-name { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; margin: 0; }
  .cover-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; margin: 0; }
  .cover-client { font-size: 28px; font-weight: 700; margin: 0; }
  .cover-period { font-size: 14px; color: #3f3f46; margin: 0; }
  .cover-generated { font-size: 10px; color: #a1a1aa; margin: 8mm 0 0; }

  .empty-state { border: 1px dashed #d4d4d8; border-radius: 6px; padding: 6mm; color: #71717a; font-style: italic; margin-bottom: 6mm; }
  .empty-state p { margin: 0; }

  .hero { margin-bottom: 6mm; }
  .hero-headline { font-size: 22px; font-weight: 700; margin: 0 0 3mm; }
  .hero-lede { font-size: 13px; color: #3f3f46; margin: 0; max-width: 160mm; }

  .kpi-grid { display: flex; flex-wrap: wrap; gap: 6mm; margin-bottom: 6mm; }
  .kpi-card { min-width: 30mm; }
  .kpi-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #71717a; margin: 0 0 1mm; }
  .kpi-value { font-size: 15px; font-weight: 700; margin: 0; }
  .kpi-comparison { font-size: 10px; font-weight: 500; margin: 1mm 0 0; }
  .kpi-comparison--positive { color: #059669; }
  .kpi-comparison--negative { color: #dc2626; }
  .kpi-comparison--neutral { color: #71717a; }

  .trend-chart { margin-bottom: 6mm; }
  .trend-legend { display: flex; gap: 4mm; font-size: 10px; color: #71717a; margin-bottom: 2mm; }
  .trend-legend-item { display: flex; align-items: center; gap: 1.5mm; }
  .trend-dot { display: inline-block; width: 2mm; height: 2mm; border-radius: 50%; }
  .trend-svg { width: 100%; height: 45mm; display: block; }
  .trend-ticks { position: relative; height: 4mm; font-size: 9px; color: #71717a; }
  .trend-tick { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
  .trend-caption { font-size: 10px; color: #71717a; border-left: 2px solid #d4d4d8; padding-left: 3mm; margin: 3mm 0 0; }

  .section-title { font-size: 13px; font-weight: 700; margin: 0 0 3mm; }
  .highlight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 6mm; }
  .highlight-card { border: 1px solid #e4e4e7; border-radius: 6px; padding: 4mm; }
  .highlight-card--alert { border-color: #fcd34d; background: #fffbeb; }
  .highlight-title { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #71717a; margin: 0 0 1.5mm; }
  .highlight-line-primary { font-size: 11px; font-weight: 600; margin: 0; }
  .highlight-line-secondary { font-size: 10px; color: #71717a; margin: 0.5mm 0 0; }

  .narrative { margin-bottom: 6mm; max-width: 170mm; }
  .narrative-body { font-size: 12px; line-height: 1.7; margin: 0; }

  .bullet-list { margin-bottom: 6mm; }
  .bullet-list-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #71717a; margin: 0 0 2mm; }
  .bullet-list ul { margin: 0; padding-left: 4mm; }
  .bullet-list li { font-size: 11px; color: #3f3f46; margin-bottom: 1mm; }

  .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .card { border: 1px solid #e4e4e7; border-radius: 6px; padding: 4mm; break-inside: avoid; }
  .card-title { font-size: 11px; font-weight: 600; margin: 0; }
  .card-subtitle { font-size: 9px; color: #71717a; margin: 0.5mm 0 3mm; }
  .card-stats { display: flex; flex-wrap: wrap; gap: 3mm; border-top: 1px solid #e4e4e7; padding-top: 3mm; }
  .stat-label { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #71717a; margin: 0; }
  .stat-value { font-size: 11px; font-weight: 600; margin: 0.5mm 0 0; }
  .campaign-spend { font-size: 14px; font-weight: 700; margin: 0.5mm 0 0; }
  .campaign-metrics { font-size: 10px; color: #71717a; border-top: 1px solid #e4e4e7; padding-top: 3mm; margin: 3mm 0 0; }
`;

export function renderReportHtml(doc: AnalyticsReportDocument, theme: ReportTheme): string {
  const pagesHtml = doc.pages
    .map((page) => {
      const heading = page.id === "cover" ? "" : `<p class="page-title">${escapeHtml(page.title)}</p>`;
      const blocksHtml = page.blocks.map((block) => renderBlock(block, theme)).join("");
      return page.id === "cover" ? blocksHtml : `<section class="report-page">${heading}${blocksHtml}</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Relatório de Analytics</title>
    <style>${STYLESHEET}</style>
  </head>
  <body>
    ${pagesHtml}
  </body>
</html>`;
}
