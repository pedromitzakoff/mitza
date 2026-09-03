import { escapeHtml } from "@/lib/html-escape";
import type { PerformanceReportDocument, PerformanceReportRow, PerformanceReportTable } from "../report-document";

/**
 * Camada 4 — único lugar que sabe que "HTML" existe. Especificação visual
 * OBRIGATÓRIA: o HTML de referência anexado pelo usuário (layout, largura,
 * hierarquia, header, cards, tipografia, tamanhos, espaçamentos, bordas,
 * tabelas, navegação, cores, estados, responsivo, impressão) — reproduzido
 * fielmente aqui, CSS e estrutura quase idênticos ao original, com dois
 * acréscimos deliberados: progressive disclosure (10 linhas + "ver
 * todas"/"recolher", mesmo padrão já usado no Relatório interativo,
 * `report-table.tsx`) e miniatura pequena nos criativos. Paleta fixa
 * (creme/areia/grafite/branco/verde-limão) — SEM branding fixo (nunca
 * "KOFF"/"MITZA"), relatório visualmente neutro pra qualquer cliente.
 *
 * Toda string dinâmica (nome de campanha/ad set/criativo, vinda do Stract)
 * passa por `escapeHtml` — nunca interpolada crua. URL de imagem/link só é
 * emitida quando começa com http(s) (`isSafeHttpUrl`) — nunca um esquema
 * `javascript:`/outro, mesmo que a origem (import_sources) seja hoje
 * admin-only.
 */
const INITIAL_VISIBLE_ROWS = 10;

function isSafeHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function renderKpiGrid(doc: PerformanceReportDocument): string {
  if (doc.summary.status !== "ok") {
    return `<p class="muted" style="padding:12px 0 0;">${escapeHtml(doc.summary.message)}</p>`;
  }

  const cards = doc.summary.kpis
    .map((kpi, index) => {
      const accentClass = index === 0 ? " accent" : "";
      return `<div class="kpi${accentClass}"><div class="kpi-label">${escapeHtml(kpi.label)}</div><div class="kpi-value">${escapeHtml(kpi.value)}</div>${
        kpi.comparison ? `<div class="kpi-sub">${escapeHtml(kpi.comparison.text)}</div>` : ""
      }</div>`;
    })
    .join("");

  return `<div class="kpis">${cards}</div><div class="note">${escapeHtml(doc.summary.note)}</div>`;
}

function renderNameCell(row: PerformanceReportRow): string {
  const thumb = isSafeHttpUrl(row.thumbnailUrl) ? `<img class="thumb" src="${escapeHtml(row.thumbnailUrl)}" alt="" loading="lazy">` : "";
  return `<td class="name">${thumb}${escapeHtml(row.name)}</td>`;
}

function renderPreviewCell(row: PerformanceReportRow): string {
  return isSafeHttpUrl(row.previewUrl)
    ? `<td class="preview"><a href="${escapeHtml(row.previewUrl)}" target="_blank" rel="noopener">Ver criativo ↗</a></td>`
    : `<td class="preview muted">—</td>`;
}

function renderRow(row: PerformanceReportRow, table: PerformanceReportTable, index: number): string {
  const collapsedClass = index >= INITIAL_VISIBLE_ROWS ? " row-collapsed" : "";
  const cells = row.metrics
    .map((cell) => `<td data-sort="${cell.sortValue === null ? "-1" : cell.sortValue}">${escapeHtml(cell.display)}</td>`)
    .join("");
  const preview = table.hasPreviewColumn ? renderPreviewCell(row) : "";
  return `<tr class="${collapsedClass.trim()}">${renderNameCell(row)}${cells}${preview}</tr>`;
}

function renderTableSection(table: PerformanceReportTable): string {
  const count = table.rows.length;
  const countLabel = `${count} ${count === 1 ? "item" : "itens"}`;

  const body =
    count === 0
      ? `<p class="muted" style="padding:24px 0;">${escapeHtml(table.emptyMessage)}</p>`
      : `<div class="table-wrap"><table class="sortable" id="table-${table.id}"><thead><tr>
          <th>${escapeHtml(table.nameColumnHeader)}</th>
          ${table.metricColumns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}
          ${table.hasPreviewColumn ? "<th>Prévia</th>" : ""}
        </tr></thead><tbody>
          ${table.rows.map((row, index) => renderRow(row, table, index)).join("")}
        </tbody></table></div>
        ${
          count > INITIAL_VISIBLE_ROWS
            ? `<button type="button" class="disclosure-toggle" data-table="table-${table.id}" data-total="${count}" data-label-singular="item" data-label-plural="itens">Ver todos os ${count} itens ↓</button>`
            : ""
        }`;

  return `<section id="${table.id}" class="section">
    <div class="section-head">
      <div><div class="eyebrow">${escapeHtml(table.eyebrow)}</div><h2>${escapeHtml(table.title)}</h2><p>${escapeHtml(table.description)}</p></div>
      <div class="count">${countLabel}</div>
    </div>
    ${body}
  </section>`;
}

const STYLE = `
:root{--graphite:#17171A;--sand:#C8BEAD;--cream:#EFE9E0;--white:#FFFFFF;--lime:#D8F238;--ink:#1E1E20;--muted:#6F6B65;--line:#D9D3C9}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--cream);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}
.container{max-width:1220px;margin:0 auto;padding:0 28px}
.hero{padding:54px 0 36px;border-bottom:1px solid var(--line)}
.hero-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px;font-weight:900;letter-spacing:-.04em;font-size:27px;color:var(--graphite)}
.brand-mark{width:16px;height:16px;background:var(--lime);border-radius:2px}
.pdf-button{display:inline-flex;align-items:center;gap:6px;background:var(--graphite);color:var(--white);font-size:13px;font-weight:700;padding:9px 16px;border-radius:999px;text-decoration:none;white-space:nowrap}
.pdf-button:hover{opacity:.88}
.kicker{margin-top:48px;font-size:12px;letter-spacing:.14em;font-weight:800;color:var(--muted);text-transform:uppercase}
h1{font-size:54px;line-height:1.02;letter-spacing:-.055em;margin:8px 0 16px;max-width:820px}
.hero p{font-size:17px;color:var(--muted);max-width:760px;margin:0}
.meta-row{display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;font-size:13px;color:var(--muted)}
.meta-pill{border:1px solid var(--line);padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.35)}
.nav{position:sticky;top:0;z-index:10;background:rgba(239,233,224,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav .container{display:flex;gap:22px;overflow:auto;padding-top:13px;padding-bottom:13px}
.nav a{font-size:13px;font-weight:700;color:var(--muted);text-decoration:none;white-space:nowrap}.nav a:hover{color:var(--graphite)}
.section{padding:52px 0;border-bottom:1px solid var(--line)}
.section-head{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:24px}
.eyebrow{font-size:11px;letter-spacing:.15em;font-weight:850;color:var(--muted)}
h2{font-size:31px;letter-spacing:-.035em;margin:5px 0 6px}.section-head p{max-width:680px;margin:0;color:var(--muted);font-size:14px}
.count{font-size:12px;border:1px solid var(--line);padding:7px 10px;border-radius:999px;color:var(--muted);white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:28px}
.kpi{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:20px 20px 18px;min-height:120px}
.kpi.accent{background:var(--graphite);color:white;border-color:var(--graphite)}
.kpi-label{font-size:12px;color:var(--muted);font-weight:700;margin-bottom:10px}.kpi.accent .kpi-label{color:#B9B9BA}
.kpi-value{font-size:30px;font-weight:850;letter-spacing:-.04em}.kpi-sub{font-size:12px;color:var(--muted);margin-top:8px}.kpi.accent .kpi-sub{color:#BCBCBD}
.note{font-size:12px;color:var(--muted);padding:14px 16px;background:rgba(255,255,255,.38);border-left:3px solid var(--sand);margin-top:16px}
.table-wrap{background:var(--white);border:1px solid var(--line);border-radius:14px;overflow:auto;max-height:620px}
table{border-collapse:collapse;width:100%;font-size:12px}th{position:sticky;top:0;background:var(--graphite);color:white;text-align:right;padding:12px 11px;white-space:nowrap;cursor:pointer;z-index:1}
th:first-child{text-align:left;min-width:285px}td{padding:11px;border-bottom:1px solid #ECE8E1;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.name{text-align:left;font-weight:650;color:var(--graphite);max-width:390px;white-space:normal;display:table-cell;vertical-align:middle}
.thumb{width:28px;height:28px;border-radius:6px;object-fit:cover;margin-right:8px;vertical-align:middle;background:var(--sand)}
tbody tr:hover{background:#FAF8F4}
.preview{text-align:left}.preview a{display:inline-block;text-decoration:none;color:var(--graphite);font-weight:800;border-bottom:2px solid var(--lime);padding-bottom:1px}
.muted{color:var(--muted)}
.row-collapsed{display:none}
.disclosure-toggle{margin-top:12px;background:none;border:none;padding:0;font-size:13px;font-weight:700;color:var(--graphite);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.footer{padding:34px 0 60px;color:var(--muted);font-size:12px}
@media(max-width:850px){h1{font-size:40px}.kpis{grid-template-columns:repeat(2,1fr)}.section-head{align-items:flex-start;flex-direction:column}}
@media(max-width:520px){.container{padding:0 16px}h1{font-size:34px}.kpis{grid-template-columns:1fr 1fr;gap:9px}.kpi{padding:15px;min-height:105px}.kpi-value{font-size:24px}}
@media print{.nav{display:none}.disclosure-toggle{display:none}.pdf-button{display:none}body{background:white}.container{max-width:none;padding:0 12mm}.hero{padding-top:18mm}.section{page-break-inside:avoid}.table-wrap{max-height:none;overflow:visible;border:none}table{font-size:9px}th{position:static}.row-collapsed{display:table-row!important}}
`;

const SCRIPT = `
document.querySelectorAll('table.sortable th').forEach((th,index)=>{
  th.addEventListener('click',()=>{
    const table=th.closest('table'), tbody=table.querySelector('tbody');
    const rows=[...tbody.querySelectorAll('tr')];
    const asc=th.dataset.order!=='asc'; th.dataset.order=asc?'asc':'desc';
    rows.sort((a,b)=>{
      const A=a.children[index],B=b.children[index];
      const av=A.dataset.sort!==undefined?parseFloat(A.dataset.sort):A.innerText.trim().toLowerCase();
      const bv=B.dataset.sort!==undefined?parseFloat(B.dataset.sort):B.innerText.trim().toLowerCase();
      if(typeof av==='number'&&!Number.isNaN(av)) return asc?av-bv:bv-av;
      return asc?String(av).localeCompare(String(bv),'pt-BR'):String(bv).localeCompare(String(av),'pt-BR');
    });
    rows.forEach(r=>tbody.appendChild(r));
  });
});
document.querySelectorAll('.disclosure-toggle').forEach((btn)=>{
  btn.addEventListener('click',()=>{
    const table=document.getElementById(btn.dataset.table);
    const rows=table.querySelectorAll('tbody tr.row-collapsed');
    const expanded=btn.dataset.expanded==='true';
    rows.forEach(r=>r.classList.toggle('row-collapsed', expanded));
    btn.dataset.expanded=(!expanded).toString();
    btn.textContent=!expanded?'Recolher ↑':\`Ver todos os \${btn.dataset.total} \${btn.dataset.labelPlural} ↓\`;
  });
});
`;

export function renderPerformanceReportHtml(doc: PerformanceReportDocument, options?: { pdfHref?: string | null }): string {
  const metaCounts = `${doc.totalCampaigns} campanha${doc.totalCampaigns === 1 ? "" : "s"} · ${doc.totalAdSets} público${doc.totalAdSets === 1 ? "" : "s"} · ${doc.totalCreatives} criativo${doc.totalCreatives === 1 ? "" : "s"}`;
  const pdfButton = options?.pdfHref
    ? `<a class="pdf-button" href="${escapeHtml(options.pdfHref)}">Baixar PDF ↓</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Performance</title><style>${STYLE}</style></head><body>
<header class="hero"><div class="container">
<div class="hero-top"><div class="brand"><span class="brand-mark"></span>Relatório de Performance</div>${pdfButton}</div>
<div class="kicker">Relatório de mídia paga · Meta Ads</div>
<h1>Performance de campanhas, públicos e criativos</h1>
<p>Leitura consolidada da conta, com visão executiva e detalhamento por campanha, público e criativo.</p>
<div class="meta-row"><span class="meta-pill">${escapeHtml(doc.clientName)}</span><span class="meta-pill">Período: ${escapeHtml(doc.periodLabel)}</span><span class="meta-pill">${escapeHtml(metaCounts)}</span></div>
</div></header>
<nav class="nav"><div class="container"><a href="#resumo">Resumo</a><a href="#campanhas">Campanhas</a><a href="#publicos">Públicos</a><a href="#criativos">Criativos</a></div></nav>
<main class="container">
<section id="resumo" class="section">
  <div class="section-head"><div><div class="eyebrow">RESUMO EXECUTIVO</div><h2>Visão geral da performance</h2><p>CPA e ROAS recalculados a partir dos totais do período, nunca pela média das linhas.</p></div></div>
  ${renderKpiGrid(doc)}
</section>
${doc.tables.map(renderTableSection).join("\n")}
</main>
<footer class="footer"><div class="container"><strong>Relatório de Performance · Meta Ads</strong><br>Gerado em ${escapeHtml(doc.generatedAtLabel)}.</div></footer>
<script>${SCRIPT}</script>
</body></html>`;
}
