/**
 * Aba "Reports" (pedido do usuário): dois reports por semana (segunda:
 * sexta anterior a domingo; sexta: segunda a quinta da mesma semana) pra
 * cada cliente ativo com integração automática, com destaques de anúncio
 * e fluxo de edição/cópia/envio/desfazer no WhatsApp.
 *
 * Núcleo puro testado com chamada direta (períodos, sync completo,
 * destaques, template, decisão de edição verbatim, contagem por
 * situação). Orquestração/UI (dependentes de Supabase/React) verificadas
 * estruturalmente via grep, mesmo padrão já usado pelas suites de Alertas.
 *
 * Rodar: npx tsx scripts/test-koff-reports.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFridayReportPeriod,
  buildMondayReportPeriod,
  findMostRecentWeekday,
  resolveCurrentReportPeriods,
} from "../src/lib/weekly-reports/report-periods";
import { isPeriodFullySynced, isReportDayConfirmed } from "../src/lib/weekly-reports/report-sync-completeness";
import { computeAdHighlights } from "../src/lib/weekly-reports/ad-highlights";
import { DEFAULT_AD_HIGHLIGHT_THRESHOLDS } from "../src/lib/weekly-reports/report-thresholds";
import { didGestorEditBodyTextVerbatim, formatReportPeriodLabel, renderReportTemplate } from "../src/lib/weekly-reports/report-template";
import { countWeeklyReportsByStatus } from "../src/lib/weekly-reports/report-list-view";
import { aggregatePerformanceResults, computeCostPerResult } from "../src/lib/performance";
import { formatCurrency } from "../src/lib/format";
import type { CreativeSummary } from "../src/lib/creative-analytics";
import type { PerformanceRecordRow } from "../src/lib/performance";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function creative(overrides: Partial<CreativeSummary>): CreativeSummary {
  return {
    creativeName: "Anúncio",
    permalinkUrl: null,
    previewImageUrl: null,
    campaignNames: [],
    totalSpend: 100,
    totalImpressions: 2000,
    totalReach: null,
    totalClicks: 50,
    totalLinkClicks: 40,
    resultType: "leads",
    totalResultCount: 5,
    totalRevenue: null,
    cpa: 20,
    cpc: 2,
    ctr: 0.025,
    cpm: 50,
    linkCtr: 0.02,
    linkCpc: 2.5,
    roas: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — report-periods.ts: segunda (sexta anterior a domingo) e sexta (segunda a quinta), virada de mês e de ano\n");
{
  ok("buildMondayReportPeriod: segunda 30/11/2026 -> sexta 27/11 a domingo 29/11", (() => {
    const p = buildMondayReportPeriod("2026-11-30");
    return p.periodStart === "2026-11-27" && p.periodEnd === "2026-11-29";
  })());

  ok("buildFridayReportPeriod: sexta 04/12/2026 -> segunda 30/11 a quinta 03/12 — ATRAVESSA O MÊS (nov->dez)", (() => {
    const p = buildFridayReportPeriod("2026-12-04");
    return p.periodStart === "2026-11-30" && p.periodEnd === "2026-12-03";
  })());

  ok("buildMondayReportPeriod atravessa VIRADA DE ANO quando a segunda cai logo no início de janeiro", (() => {
    const p = buildMondayReportPeriod("2027-01-03");
    return p.periodStart === "2026-12-31" && p.periodEnd === "2027-01-02";
  })());

  ok("buildFridayReportPeriod também atravessa virada de ano no mesmo tipo de caso", (() => {
    const p = buildFridayReportPeriod("2027-01-03");
    return p.periodStart === "2026-12-30" && p.periodEnd === "2027-01-02";
  })());

  ok("findMostRecentWeekday: terça 01/12/2026 -> segunda mais recente é 30/11/2026", findMostRecentWeekday("2026-12-01", 1) === "2026-11-30");
  ok("findMostRecentWeekday: terça 01/12/2026 -> sexta mais recente é 27/11/2026", findMostRecentWeekday("2026-12-01", 5) === "2026-11-27");
  ok("findMostRecentWeekday: o próprio dia, se já for o dia da semana pedido", findMostRecentWeekday("2026-12-04", 5) === "2026-12-04");

  ok(
    "resolveCurrentReportPeriods: os 2 lotes mais recentes relativos a 'hoje' = sexta 04/12/2026 (lote de sexta é o próprio dia, atravessando nov->dez)",
    (() => {
      const periods = resolveCurrentReportPeriods("2026-12-04");
      const segunda = periods.find((p) => p.periodKind === "segunda")!;
      const sexta = periods.find((p) => p.periodKind === "sexta")!;
      return (
        segunda.periodStart === "2026-11-27" &&
        segunda.periodEnd === "2026-11-29" &&
        sexta.periodStart === "2026-11-30" &&
        sexta.periodEnd === "2026-12-03"
      );
    })(),
  );

  ok(
    "roda em QUALQUER dia da semana (não só segunda/sexta) e devolve os MESMOS 2 períodos — pedido: 'reprocessamento sem duplicatas', nunca depende do dia do cron",
    JSON.stringify(resolveCurrentReportPeriods("2026-12-02")) === JSON.stringify(resolveCurrentReportPeriods("2026-12-03")),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — formatReportPeriodLabel: 'DD/MM a DD/MM', só com ano quando atravessa virada de ano\n");
{
  ok("mesmo ano (mesmo atravessando mês) -> sem ano, formato do exemplo ilustrativo", formatReportPeriodLabel("2026-11-30", "2026-12-03") === "30/11 a 03/12");
  ok("atravessa ano -> ano nas duas pontas, nunca ambíguo", formatReportPeriodLabel("2026-12-31", "2027-01-02") === "31/12/2026 a 02/01/2027");
}

// ---------------------------------------------------------------------------
console.log("\nC — isPeriodFullySynced: dado incompleto nunca conclui prematuramente\n");
{
  ok("todos os dias sincronizados -> true", isPeriodFullySynced(["2026-11-27", "2026-11-28"], new Set(["2026-11-27", "2026-11-28"])));
  ok("falta 1 dia -> false (dados atrasados)", isPeriodFullySynced(["2026-11-27", "2026-11-28"], new Set(["2026-11-27"])) === false);
  ok("nenhum dia sincronizado -> false", isPeriodFullySynced(["2026-11-27"], new Set()) === false);
}

// ---------------------------------------------------------------------------
console.log("\nD — computeAdHighlights: elegibilidade por volume mínimo, melhor custo/melhor CTR de link, combinação quando o mesmo anúncio lidera os dois\n");
{
  ok("sem nenhum anúncio -> os 2 destaques omitidos (nunca fabricado)", (() => {
    const h = computeAdHighlights([], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestCost === null && h.bestLinkCtr === null && h.combined === false;
  })());

  ok("anúncio com pouco volume (< 3 resultados, < 1.000 impressões) nunca é elegível a nenhum dos 2 destaques", (() => {
    const lowVolume = creative({ creativeName: "Baixo volume", totalResultCount: 1, cpa: 5, totalImpressions: 200, linkCtr: 0.5 });
    const h = computeAdHighlights([lowVolume], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestCost === null && h.bestLinkCtr === null;
  })());

  ok("destaque de custo omitido quando NENHUM anúncio elegível pra ele, mesmo havendo anúncio elegível pro outro indicador", (() => {
    const onlyCtrEligible = creative({ creativeName: "Só CTR", totalResultCount: 1, totalImpressions: 5000, linkCtr: 0.03 });
    const h = computeAdHighlights([onlyCtrEligible], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestCost === null && h.bestLinkCtr !== null && h.bestLinkCtr.adName === "Só CTR";
  })());

  ok(
    "pedido do usuário: 'consegue colocar o link do anúncio também?' — permalinkUrl do CreativeSummary propaga pro destaque, 'null' quando o criativo nunca teve link registrado (nunca fabricado)",
    (() => {
      const withLink = creative({ creativeName: "Com link", permalinkUrl: "https://fb.me/com-link", totalResultCount: 5, cpa: 10, totalImpressions: 2000, linkCtr: 0.05 });
      const withoutLink = creative({ creativeName: "Sem link", permalinkUrl: null, totalResultCount: 5, cpa: 10, totalImpressions: 2000, linkCtr: 0.05 });
      const hWith = computeAdHighlights([withLink], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
      const hWithout = computeAdHighlights([withoutLink], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
      return (
        hWith.bestCost?.permalinkUrl === "https://fb.me/com-link" &&
        hWith.bestLinkCtr?.permalinkUrl === "https://fb.me/com-link" &&
        hWithout.bestCost?.permalinkUrl === null &&
        hWithout.bestLinkCtr?.permalinkUrl === null
      );
    })(),
  );

  ok("melhor custo por resultado = MENOR cpa entre os elegíveis (nunca o de maior volume por si só)", (() => {
    const cheaper = creative({ creativeName: "Depoimento de cliente", totalResultCount: 12, cpa: 14.8, totalImpressions: 100 });
    const pricier = creative({ creativeName: "Outro anúncio", totalResultCount: 20, cpa: 30, totalImpressions: 100 });
    const h = computeAdHighlights([pricier, cheaper], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestCost?.adName === "Depoimento de cliente" && h.bestCost?.cost === 14.8 && h.bestCost?.resultCount === 12;
  })());

  ok("melhor CTR de link = MAIOR linkCtr entre os elegíveis", (() => {
    const highCtr = creative({ creativeName: "Benefícios do produto", totalImpressions: 4200, linkCtr: 0.029, totalResultCount: 0, cpa: null });
    const lowCtr = creative({ creativeName: "Outro anúncio", totalImpressions: 4200, linkCtr: 0.01, totalResultCount: 0, cpa: null });
    const h = computeAdHighlights([lowCtr, highCtr], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestLinkCtr?.adName === "Benefícios do produto" && h.bestLinkCtr?.impressions === 4200;
  })());

  ok("mesmo anúncio lidera os 2 indicadores -> combined=true, os 2 campos continuam preenchidos com o mesmo anúncio", (() => {
    const winner = creative({ creativeName: "Campeão", totalResultCount: 10, cpa: 5, totalImpressions: 5000, linkCtr: 0.08 });
    const other = creative({ creativeName: "Outro", totalResultCount: 4, cpa: 50, totalImpressions: 5000, linkCtr: 0.01 });
    const h = computeAdHighlights([other, winner], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.combined === true && h.bestCost?.adName === "Campeão" && h.bestLinkCtr?.adName === "Campeão";
  })());

  ok("anúncios diferentes lideram cada indicador -> combined=false", (() => {
    const bestCost = creative({ creativeName: "Mais barato", totalResultCount: 10, cpa: 5, totalImpressions: 100, linkCtr: 0.001 });
    const bestCtr = creative({ creativeName: "Mais cliques", totalResultCount: 1, cpa: 999, totalImpressions: 5000, linkCtr: 0.08 });
    const h = computeAdHighlights([bestCost, bestCtr], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.combined === false && h.bestCost?.adName === "Mais barato" && h.bestLinkCtr?.adName === "Mais cliques";
  })());

  ok("destaque nunca mistura objetivo diferente do cliente (resultType != goal nunca é elegível ao custo)", (() => {
    const wrongGoal = creative({ creativeName: "Objetivo errado", resultType: "sales", totalResultCount: 50, cpa: 1 });
    const h = computeAdHighlights([wrongGoal], "leads", DEFAULT_AD_HIGHLIGHT_THRESHOLDS);
    return h.bestCost === null;
  })());
}

// ---------------------------------------------------------------------------
console.log("\nE — renderReportTemplate: estrutura do texto, zero resultados, sem destaques, sem próximo passo\n");
{
  const baseInput = {
    clientName: "Byma",
    periodKind: "segunda" as const,
    periodStart: "2026-11-13",
    periodEnd: "2026-11-15",
    goal: "leads" as const,
    investment: 620,
    resultCount: 31,
    costPerResult: 20,
    revenue: null,
    roas: null,
    highlights: {
      bestCost: { adName: "Depoimento de cliente", format: null, permalinkUrl: "https://fb.me/depoimento", resultCount: 12, cost: 14.8 },
      bestLinkCtr: { adName: "Benefícios do produto", format: null, permalinkUrl: null, linkCtr: 0.029, impressions: 4200 },
      combined: false,
    },
    nextStep: "testar uma nova abertura no vídeo de depoimento.",
  };

  const rendered = renderReportTemplate(baseInput);
  ok("cabeçalho com cliente, período numérico E por extenso (pedido: 'segunda até quinta'/'sexta a domingo')", rendered.includes("*Byma | Resultados de sexta a domingo (13/11 a 15/11)*"));
  ok("lote 'sexta' (gerado na sexta) descreve o período coberto como 'segunda a quinta', nunca o inverso", renderReportTemplate({ ...baseInput, periodKind: "sexta" }).includes("Resultados de segunda a quinta ("));
  ok("linha de investimento", rendered.includes(`💰 Investimento: ${formatCurrency(620)}`));
  ok(
    "pedido do usuário: 'prefiro que fique em lista, não uma do lado da outra' — resultado e custo por resultado em linhas SEPARADAS, nunca unidas por '·'",
    rendered.includes("🎯 Leads: 31\n") && rendered.includes("💲 CPL:") && !rendered.includes("🎯 Leads: 31 ·"),
  );
  ok("bloco de destaques com os 2 indicadores, cada um numa linha", rendered.includes("*Destaques dos anúncios*") && rendered.includes("🏆 Melhor CPL:") && rendered.includes("👆 Melhor CTR de link:"));
  ok(
    "pedido do usuário: 'consegue colocar o link do anúncio também?' — link do anúncio com permalink aparece na linha do destaque",
    rendered.includes(`🏆 Melhor CPL: Depoimento de cliente · 12 leads a ${formatCurrency(14.8)} · https://fb.me/depoimento`),
  );
  ok(
    "criativo SEM permalink registrado (enriquecimento opcional) -> linha do destaque sem link nenhum, nunca um link fabricado",
    rendered.includes("👆 Melhor CTR de link: Benefícios do produto · 2,90% em 4.200 impressões") && !/Benefícios do produto[^\n]*https/.test(rendered),
  );
  ok("bloco de próximo passo só quando preenchido", rendered.includes("*Próximo passo:* testar uma nova abertura no vídeo de depoimento."));

  const noNextStep = renderReportTemplate({ ...baseInput, nextStep: null });
  ok("próximo passo OMITIDO inteiramente quando não preenchido (nunca uma linha vazia)", !noNextStep.includes("Próximo passo"));

  const noHighlights = renderReportTemplate({ ...baseInput, highlights: { bestCost: null, bestLinkCtr: null, combined: false } });
  ok("bloco de destaques OMITIDO inteiramente quando nenhum anúncio é elegível", !noHighlights.includes("Destaques dos anúncios"));

  const zeroResults = renderReportTemplate({ ...baseInput, resultCount: 0, costPerResult: null });
  ok("zero resultados -> mostra a quantidade 0 numa linha e o custo como indisponível noutra (nunca R$0,00/Infinity)", zeroResults.includes("🎯 Leads: 0\n💲 CPL: indisponível"));

  const combinedInput = {
    ...baseInput,
    highlights: {
      bestCost: { adName: "Campeão", format: null, permalinkUrl: "https://fb.me/campeao", resultCount: 10, cost: 5 },
      bestLinkCtr: { adName: "Campeão", format: null, permalinkUrl: "https://fb.me/campeao", linkCtr: 0.08, impressions: 5000 },
      combined: true,
    },
  };
  const combinedText = renderReportTemplate(combinedInput);
  ok("anúncio que lidera os 2 indicadores aparece numa linha só (combinada), nunca 2 linhas repetindo o mesmo nome", combinedText.includes("🏆👆 Campeão:") && combinedText.split("Campeão").length === 2);
  ok("linha combinada também traz o link do anúncio", combinedText.includes("· https://fb.me/campeao"));

  const salesInput = { ...baseInput, goal: "sales" as const };
  ok("métrica principal troca corretamente por objetivo (Vendas/CPA, nunca hardcoded 'Leads')", renderReportTemplate(salesInput).includes("🎯 Vendas:") && renderReportTemplate(salesInput).includes("💲 CPA:"));

  ok(
    "pedido do usuário: 'no caso das vendas, precisa colocar valor em vendas e ROAS' — em linhas separadas, quando há faturamento",
    renderReportTemplate({ ...salesInput, revenue: 5000, roas: 8.06 }).includes(`💵 Valor em vendas: ${formatCurrency(5000)}\n📈 ROAS: 8.06x`),
  );
  ok(
    "objetivo de vendas SEM faturamento registrado -> as 2 linhas somem inteiras (nunca R$0,00/0,00x fabricado)",
    !renderReportTemplate({ ...salesInput, revenue: null, roas: null }).includes("Valor em vendas") && !renderReportTemplate({ ...salesInput, revenue: null, roas: null }).includes("ROAS"),
  );
  ok(
    "faturamento sem investimento no escopo -> ROAS indisponível, nunca Infinity/divisão por zero",
    renderReportTemplate({ ...salesInput, investment: 0, revenue: 5000, roas: null }).includes("💵 Valor em vendas:") &&
      renderReportTemplate({ ...salesInput, investment: 0, revenue: 5000, roas: null }).includes("📈 ROAS: indisponível"),
  );
  ok(
    "as linhas de vendas NUNCA aparecem pra outro objetivo (leads), mesmo com revenue/roas preenchidos por engano",
    !renderReportTemplate({ ...baseInput, revenue: 5000, roas: 8.06 }).includes("Valor em vendas"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nF — zero resultados ponta a ponta (aggregatePerformanceResults + computeCostPerResult), nunca custo fabricado\n");
{
  const noRecords: PerformanceRecordRow[] = [];
  const aggregatedNoRecords = aggregatePerformanceResults(noRecords, "leads");
  ok("sem NENHUM registro de performance -> resultCount 0, hasAnyRecord false", aggregatedNoRecords.resultCount === 0 && !aggregatedNoRecords.hasAnyRecord);
  ok("custo por resultado indisponível (null) quando não há registro nenhum", computeCostPerResult(620, aggregatedNoRecords.resultCount, aggregatedNoRecords.hasAnyRecord) === null);

  const zeroRecorded: PerformanceRecordRow[] = [{ channel: "meta", resultType: "leads", resultCount: 0, source: "meta", sourceUpdatedAt: "2026-11-15T10:00:00Z" }];
  const aggregatedZero = aggregatePerformanceResults(zeroRecorded, "leads");
  ok("zero CONFIRMADO (linha existe, resultCount=0) -> ainda resultCount 0, mas hasAnyRecord true (distinto de 'sem dado')", aggregatedZero.resultCount === 0 && aggregatedZero.hasAnyRecord);
  ok("custo por resultado indisponível (null) mesmo com zero confirmado — nunca divide por zero", computeCostPerResult(620, aggregatedZero.resultCount, aggregatedZero.hasAnyRecord) === null);
}

// ---------------------------------------------------------------------------
console.log("\nG — didGestorEditBodyTextVerbatim: decide se a Server Action pode religar o próximo passo no template ou se preserva o texto literal do gestor\n");
{
  ok("texto IDÊNTICO ao atual -> não foi editado verbatim (safe religar o próximo passo)", !didGestorEditBodyTextVerbatim("texto A", "texto A"));
  ok("texto DIFERENTE do atual -> foi editado verbatim (preserva literal, nunca sobrescreve)", didGestorEditBodyTextVerbatim("texto A", "texto B"));
}

// ---------------------------------------------------------------------------
console.log("\nH — countWeeklyReportsByStatus: as 3 situações sempre, mesmo em 0 (contador de progresso)\n");
{
  const counts = countWeeklyReportsByStatus([{ status: "pronto_para_enviar" }, { status: "enviado" }, { status: "enviado" }]);
  ok("contagem correta (16 de 20 enviados = counts.enviado / soma das 3)", counts.enviado === 2 && counts.pronto_para_enviar === 1 && counts.aguardando_dados === 0);
  ok("'aguardando_dados' aparece com 0, nunca omitido do objeto", "aguardando_dados" in counts);
}

// ---------------------------------------------------------------------------
console.log("\nI — generate-weekly-reports.ts: escopo, dedup, congelamento de 'enviado', preservação de edição manual\n");
{
  const genSource = loadSource("src", "lib", "weekly-reports", "generate-weekly-reports.ts");

  ok(
    "clientes ativos sem métrica ou integração aparecem com pendência",
    genSource.includes('.eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)') && genSource.includes("for (const client of clients)") && genSource.includes("waitingReason: reason"),
  );
  ok(
    "dedup: busca a linha existente por client_id+period_start+period_end ANTES de decidir inserir — nunca um INSERT direto sem checar (pedido: 'reprocessamento sem duplicatas')",
    genSource.includes('.eq("client_id", client.id)') && genSource.includes('.eq("period_start", period.periodStart)') && genSource.includes('.eq("period_end", period.periodEnd)'),
  );
  ok(
    "report já ENVIADO nunca é tocado de novo por um reprocessamento (pedido: 'mantenha a versão enviada no histórico mesmo quando a origem atualizar os números')",
    genSource.includes('if (existing?.status === "enviado") return "unchanged";'),
  );
  ok(
    "dado incompleto nunca conclui prematuramente — status só avança pra pronto depois de isPeriodFullySynced confirmar",
    genSource.includes("if (!isPeriodFullySynced(dates, confirmed))"),
  );
  ok(
    "texto editado manualmente (text_edited_at) nunca é sobrescrito por um reprocessamento automático seguinte",
    genSource.includes("if (!existing.text_edited_at) {") && genSource.includes("patch.body_text = renderedText;"),
  );
  ok("destaques calculados SÓ com os dados do período do report (nunca um histórico maior)", genSource.includes("getAdCreativeDailyMetricsForPeriod") && genSource.includes("buildCreativeSummaries(creativeRows)"));
  ok("thresholds de volume mínimo centralizados, nunca hardcoded de novo aqui", genSource.includes("DEFAULT_AD_HIGHLIGHT_THRESHOLDS"));

  ok("cron compara status e revisão antes de gravar e ignora inserção concorrente",
    genSource.includes('.eq("status", existing.status).eq("updated_at", existing.updated_at)') && genSource.includes("ignoreDuplicates: true"));
  const day = "2026-11-15";
  const base = {
    day, goal: "leads", usesGoal: true, manual: false, explicitSpend: false, explicitResult: false,
    channelSources: [{ id: "source", status: "active", last_success_at: "2026-11-16T12:00:00Z", last_imported_date: day }],
    covered: new Set([`source:${day}`]), mapped: new Set(["source:leads"]),
  };
  ok("sincronização completa confirma dia sem linhas e com zero resultados", isReportDayConfirmed(base));
  ok("investimento sozinho não confirma resultados", !isReportDayConfirmed({ ...base, covered: new Set(), explicitSpend: true }));
  ok("fonte sem métrica mapeada não confirma zero", !isReportDayConfirmed({ ...base, mapped: new Set() }));
  ok("legado comprova dia com linhas explícitas de investimento e resultado", isReportDayConfirmed({ ...base, covered: new Set(), explicitSpend: true, explicitResult: true }));

  const sqlSource = loadSource("supabase", "weekly-reports.sql");
  ok("migration: dedup garantido no banco (unique client_id/period_start/period_end), nunca só na aplicação", sqlSource.includes("unique (client_id, period_start, period_end)"));
  ok("migration: histórico imutável (weekly_report_events), mesmo padrão de alert_events", sqlSource.includes("create table if not exists weekly_report_events"));
  ok("migration: NÃO reaproveita client_reports/client_updates (tabelas já existentes, nunca usadas por nenhuma UI) — fluxo deliberadamente separado", sqlSource.includes("NÃO reaproveita"));
}

// ---------------------------------------------------------------------------
console.log("\nJ — reports-filters.tsx: selects já nascem com largura limitada (lição da Etapa Alertas — nunca repetir o bug de overflow no mobile)\n");
{
  const filtersSource = loadSource("src", "app", "reports", "reports-filters.tsx");
  ok("os 2 <select> (cliente/gestor) têm max-w + truncate desde a 1ª versão", (filtersSource.match(/max-w-\[40vw\] truncate/g) ?? []).length === 2);
  ok("o <input type=\"date\"> também tem max-w no mobile", filtersSource.includes('max-w-[46vw]'));
  ok("filtros preservam a ABA ativa e a DATA selecionada na URL ao trocar cliente/gestor", filtersSource.includes('params.set("aba", activeTab)') && filtersSource.includes('params.set("data", next.date)'));
}

// ---------------------------------------------------------------------------
console.log("\nK — page.tsx/reports-tabs.tsx: abas com contagem, padrão 'Pronto para enviar', estado vazio distinto por aba\n");
{
  const pageSource = loadSource("src", "app", "reports", "page.tsx");
  const tabsSource = loadSource("src", "app", "reports", "reports-tabs.tsx");

  ok("aba padrão é 'pronto_para_enviar' (a fila de ação) quando ?aba= é inválido/ausente", pageSource.includes("DEFAULT_REPORTS_TAB"));
  ok(
    "estado vazio tem uma frase CURTA e DIFERENTE pra cada uma das 3 abas",
    pageSource.includes("Nenhum report aguardando dados nesta semana.") &&
      pageSource.includes("Nenhum report pronto para enviar nesta semana.") &&
      pageSource.includes("Nenhum report enviado ainda nesta semana."),
  );
  ok("contador de progresso no topo ('X de Y enviados')", pageSource.includes("de ${total} enviados"));
  ok("abas mostram contagem ao lado do rótulo", tabsSource.includes("({counts[tab]})"));
  ok("tabs nunca estouram a largura no mobile (overflow-x-auto, mesmo padrão de AlertsTabs)", tabsSource.includes("overflow-x-auto"));
}

// ---------------------------------------------------------------------------
console.log("\nL — report-card.tsx/report-action-buttons.tsx: ações por estado, cópia client-side, atalho pro ranking de anúncios no MESMO período\n");
{
  const cardSource = loadSource("src", "app", "reports", "report-card.tsx");
  const actionsSource = loadSource("src", "app", "reports", "report-action-buttons.tsx");

  ok("card 'aguardando_dados' nunca mostra o texto final (ainda não existe) — só a mensagem de espera", cardSource.includes('"aguardando_dados"') && cardSource.includes("Aguardando a sincronização"));
  ok("card 'pronto_para_enviar' mostra as 3 ações (Editar texto/Copiar/Marcar como enviado)", cardSource.includes("<ReportReadyActions") && actionsSource.includes("Editar texto") && actionsSource.includes("Copiar para WhatsApp") && actionsSource.includes("Marcar como enviado"));
  ok("'Copiar' é Clipboard API pura, nunca uma Server Action (pedido: 'copiar mantém o status atual')", actionsSource.includes("navigator.clipboard") && !actionsSource.includes('formData.set("note"'));
  ok("card 'enviado' mostra quem/quando enviou e o botão Desfazer", cardSource.includes('"enviado"') && cardSource.includes("Enviado por") && cardSource.includes("<ReportUndoSentButton"));
  ok(
    "'Ver ranking de anúncios' usa o MESMO período do report (pedido, seção 3: 'usando o mesmo período')",
    cardSource.includes("period=custom&start=${report.periodStart}&end=${report.periodEnd}"),
  );
  ok("'Ver cliente' preservado em todos os estados", cardSource.includes("Ver cliente"));
}

// ---------------------------------------------------------------------------
console.log("\nM — navegação: 'Reports' entra junto dos outros menus do cliente (mesma posição de 'Alertas'), cron registrado\n");
{
  const sidebarSource = loadSource("src", "app", "sidebar.tsx");
  ok(
    "'Reports' está em buildClientNavItems, cross-cliente (href fixo '/reports', nunca escopado por clientId)",
    sidebarSource.includes('{ label: "Reports", href: "/reports", icon: FileText, isActive: (p) => p.startsWith("/reports") }'),
  );

  const vercelConfig = loadSource("vercel.json");
  ok("cron de geração registrado em vercel.json", vercelConfig.includes('"/api/cron/generate-weekly-reports"'));
}

console.log(`\n${passed} verificações OK.\n`);
