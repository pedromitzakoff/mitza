/**
 * Testes da Etapa "MEGA FACELIFT — Fase 3: Performance" — cobre só o que
 * esta rodada de fato mudou: recontextualização visual/IA do
 * `/clients/[id]/relatorio` (abas de investigação progressiva, cabeçalho
 * "Performance", Funis recolhido). O pipeline analítico (Camada 1/2 —
 * `report-data.ts`/`report-document.ts`/`campaign-analytics.ts` etc.) não
 * foi tocado nesta rodada — os cenários de múltiplos canais/objetivos,
 * funil, revenue/ROAS ausente, divisão por zero, filtro por período/funil/
 * busca e query params já são cobertos pelas suites existentes
 * (`test-performance-report*.ts`, `test-report-share-links.ts`,
 * `test-client-funnels.ts`) — não duplicados aqui.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase3-performance.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildCampaignSummaries } from "../src/lib/campaign-analytics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const headerSource = loadSource("src", "app", "clients", "[id]", "relatorio", "report-header.tsx");
const bodySource = loadSource("src", "app", "clients", "[id]", "relatorio", "report-body.tsx");
const filterableSource = loadSource("src", "app", "clients", "[id]", "relatorio", "report-filterable-tables.tsx");
const pageSource = loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx");
const publicPageSource = loadSource("src", "app", "r", "[token]", "page.tsx");

console.log("\n1 — Rota/link público/PDF intactos — nada renomeado, nenhum redirect novo\n");
{
  ok("rota técnica continua /clients/[id]/relatorio (arquivo no lugar de sempre)", pageSource.length > 0);
  ok("nenhuma rota /clients/[id]/performance foi criada nesta fase", !existsSync(join(__dirname, "..", "src", "app", "clients", "[id]", "performance")));
  ok("/relatorio não faz nenhum redirect novo", !/redirect\(/.test(pageSource));
  ok("PDF (buildReportPdfHref) continua chamado exatamente como antes", pageSource.includes("buildReportPdfHref(client.id, activePreset"));
  ok("/r/[token] continua reaproveitando ReportHeader/ReportBody (mesma Camada 1/2, nenhum componente próprio)", publicPageSource.includes("<ReportHeader") && publicPageSource.includes("<ReportBody"));
}

console.log("\n2 — ReportHeader: título/subtítulo novos são opt-in — link público nunca passa as props novas, texto de sempre preservado\n");
{
  ok("título tem default = texto de sempre ('Relatório de Performance')", /title = "Relatório de Performance"/.test(headerSource));
  ok("subtitle é opcional, sem default visível (undefined = nada renderizado)", /subtitle\?: string/.test(headerSource));
  ok("subtitle só renderiza quando existe ({subtitle && ...})", /\{subtitle && /.test(headerSource));
  ok("link público (/r/[token]) NUNCA passa title/subtitle — herda o texto de sempre intocado", !publicPageSource.includes("title=") && !publicPageSource.includes("subtitle="));
  ok("página interna passa title='Performance' + subtitle", pageSource.includes('title="Performance"') && pageSource.includes("subtitle="));
}

console.log("\n3 — ReportBody/ReportFilterableTables: 'sectioned' é opt-in, default preserva o corpo de sempre (todas as tabelas empilhadas)\n");
{
  ok("ReportBody aceita 'sectioned' com default false", /sectioned = false/.test(bodySource));
  ok("ReportBody repassa 'sectioned' pra ReportFilterableTables, nunca um segundo estado", /<ReportFilterableTables document=\{document\} sectioned=\{sectioned\}/.test(bodySource));
  ok("link público (/r/[token]) chama <ReportBody document={document} /> sem 'sectioned' — herda o default (tabelas empilhadas, comportamento de sempre)", /<ReportBody document=\{document\} \/>/.test(publicPageSource));
  ok("página interna passa sectioned (ativa as abas)", /<ReportBody[\s\S]{0,80}sectioned\b/.test(pageSource));
}

console.log("\n4 — Abas de investigação progressiva: mesma hierarquia pedida (Resultado -> Resultado Diário -> Campanha -> Público -> Criativo -> Posicionamento)\n");
{
  ok(
    "SECTION_TABS segue a ordem Visão geral -> Resultado diário -> Campanhas -> Públicos -> Criativos -> Posicionamentos",
    /\{ id: "resumo", label: "Visão geral" \},\s*\{ id: "resultado-diario", label: "Resultado diário" \},\s*\{ id: "campanhas", label: "Campanhas" \},\s*\{ id: "publicos", label: "Públicos" \},\s*\{ id: "criativos", label: "Criativos" \},\s*\{ id: "posicionamentos", label: "Posicionamentos" \},/.test(
      filterableSource,
    ),
  );
  ok("tabs só renderizam quando sectioned é true", /\{sectioned && \(\s*<div className="inline-flex/.test(filterableSource));
  ok(
    "clicar numa aba filtrável também define a dimensão do filtro (nunca precisa de um segundo seletor pra mesma escolha)",
    /if \(FILTERABLE_SECTION_IDS\.has\(tabId\)\) setDimensionId\(tabId\)/.test(filterableSource),
  );
  ok("trocar de aba sempre limpa o texto do filtro (nunca leva um filtro de uma dimensão pra outra por engano)", /setText\(""\);\s*\n\s*\}/.test(filterableSource));
}

console.log("\n5 — Sem filtros redundantes: o seletor de dimensão desaparece em modo sectioned (a aba já decide)\n");
{
  ok(
    "select 'Dimensão do filtro' só renderiza quando NÃO sectioned",
    /\{!sectioned && \(\s*<select\s*\n\s*aria-label="Dimensão do filtro"/.test(filterableSource),
  );
  ok(
    "controle de filtro (modo+texto) só aparece em abas filtráveis quando sectioned (FILTERABLE_SECTION_IDS)",
    /showFilterControls = filterableTables\.length > 0 && \(!sectioned \|\| FILTERABLE_SECTION_IDS\.has\(activeSection\)\)/.test(filterableSource),
  );
}

console.log("\n6 — Posicionamentos: UI deixa explícito que é visão agregada do período (sem fingir granularidade por campanha)\n");
{
  ok(
    "aviso de agregação só aparece na aba Posicionamentos, só em modo sectioned — nunca no link público/PDF (Camada 2 intocada)",
    /activeSection === "posicionamentos" && \(\s*<p className="mb-3 text-xs text-\[#6F6B65\]">\s*Visão agregada da conta no período/.test(filterableSource),
  );
}

console.log("\n7 — Performance x Metas: diferença de enquadramento visível, nenhum cálculo novo\n");
{
  ok(
    "nota 'origem e eficiência, não ritmo' só aparece em modo sectioned (recontextualização visual, não um KPI novo)",
    /\{sectioned && \(\s*<p className="mt-1\.5 text-xs text-\[#6F6B65\]">Como o resultado foi produzido/.test(filterableSource),
  );
  ok("subtítulo do cabeçalho reforça a pergunta de Performance ('o que está produzindo ou prejudicando')", pageSource.includes("O que está produzindo ou prejudicando o resultado"));
}

console.log("\n8 — Funis: CRUD/classificação recolhido por padrão (configuração, não investigação) — client_funnels/campaign_funnel_assignments intocados\n");
{
  ok("FunnelsSection agora vive dentro de um <details> recolhível, nunca removido", /<details[\s\S]*?<summary[\s\S]*?Configurar funis[\s\S]*?<FunnelsSection/.test(pageSource));
  ok("a 'Visão por funil' (seletor topo, ReportFunnelSelector) continua fora do <details> — é investigação, não configuração", /<ReportFunnelSelector/.test(pageSource) && pageSource.indexOf("<ReportFunnelSelector") < pageSource.indexOf("<details"));
  ok("import de client-funnels-data/client-funnels (lib) nunca tocado nesta rodada", pageSource.includes('from "@/lib/client-funnels-data"'));
}

console.log("\n9 — campaign-card.tsx: continua órfão — nem reintroduzido, nem removido nesta rodada (documentado, não decidido)\n");
{
  let importCount = 0;
  const grepDirs = ["src/app", "src/lib"];
  for (const dir of grepDirs) {
    try {
      const out = execSync(`grep -rl "CampaignCard" ${join(__dirname, "..", dir)}`, { encoding: "utf8" });
      importCount += out.split("\n").filter((l) => l.trim() && !l.endsWith("campaign-card.tsx")).length;
    } catch {
      // grep sem match sai com código != 0 — tratado como "nenhum import"
    }
  }
  check("zero arquivos (fora do próprio campaign-card.tsx) importam CampaignCard", importCount, 0);
  ok("campaign-card.tsx continua existindo no disco (não deletado nesta rodada)", loadSource("src", "app", "clients", "campaign-card.tsx").includes("export function CampaignCard"));
}

console.log("\n10 — Bug encontrado na auditoria (NÃO corrigido nesta rodada, documentado): buildCampaignSummaries soma resultCount entre result_types diferentes da mesma campanha\n");
{
  // Cenário realista: a mesma campanha (mesmo canal+nome) tem linhas de
  // dias diferentes com result_type diferente (ex.: metric_mappings com
  // mais de um goal mapeado pra conta) — buildCampaignSummaries hoje soma
  // tudo num totalResultCount só, e resultType vira o ÚLTIMO processado
  // (last-write-wins), nunca um sinal de "misto". Teste documenta o
  // comportamento ATUAL (seção 19 do pedido: "se encontrar bug, documente
  // antes de ampliar escopo" — correção fica pra rodada própria, auditada).
  const rows = [
    { date: "2026-10-01", channel: "meta" as const, campaignName: "Campanha X", campaignId: "c1", spend: 100, impressions: null, reach: null, clicks: null, resultType: "leads" as const, resultCount: 10, revenue: null },
    { date: "2026-10-02", channel: "meta" as const, campaignName: "Campanha X", campaignId: "c1", spend: 100, impressions: null, reach: null, clicks: null, resultType: "sales" as const, resultCount: 3, revenue: null },
  ];
  const summaries = buildCampaignSummaries(rows);
  check("UMA campanha só na saída (agrupada por canal+nome, nunca por result_type)", summaries.length, 1);
  check(
    "ACHADO (não corrigido): totalResultCount soma Leads + Vendas (10+3=13) como se fosse o mesmo resultado — risco real descrito na auditoria",
    summaries[0].totalResultCount,
    13,
  );
  check("ACHADO (não corrigido): resultType vira o ÚLTIMO processado ('sales'), nunca um sinal de objetivo misto", summaries[0].resultType, "sales");
}

console.log(`\n${passed} verificações passaram.`);
