/**
 * Testes da Etapa "KOFF Analytics — Redesign definitivo da página do
 * cliente" (pedido explícito do usuário): reorganização em 3 áreas —
 * Visão executiva, Evolução da performance, Exploração de campanhas —
 * eliminando a fragmentação/duplicação da composição anterior (Meta &
 * Ritmo/Diagnóstico/Canais/Performance Meta Ads como seções separadas,
 * repetindo Investimento/Resultado/Custo em 3 lugares diferentes, dois
 * motores de gráfico de evolução distintos).
 *
 * Cobre, via grep de código-fonte (mesmo padrão já usado pelas suites
 * anteriores, sem DOM/React Testing Library neste ambiente):
 *  - Visão executiva: um bloco só, Diagnóstico discreto (nunca uma seção
 *    própria), indicadores consolidados sem duplicar Investimento/
 *    Resultado/Custo, quebra por canal condicional.
 *  - Evolução da performance: módulo único (Recharts), nunca mais dois
 *    gráficos separados; métrica padrão nunca duplicada.
 *  - Exploração de campanhas: seção própria, prioritária, lógica/
 *    funcionalidades intocadas (busca/ordenação/colunas/drill-down).
 *  - Preservação: metas/orçamento, saldo Meta, atualização de dados,
 *    indicadores personalizáveis persistidos por cliente, relatórios/
 *    integrações.
 *
 * Rodar: npx tsx scripts/test-cockpit-redesign.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SELECTED_METRIC_IDS, ALL_METRIC_CARD_IDS } from "../src/lib/meta-ads-dashboard/metric-cards";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}
function fileExists(...segments: string[]): boolean {
  return existsSync(join(__dirname, "..", ...segments));
}

const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const evolutionSource = loadSource("src", "app", "clients", "cockpit-evolution-section.tsx");
const mergeLibSource = loadSource("src", "lib", "cockpit-evolution-merge.ts");
const metricCardsSource = loadSource("src", "app", "clients", "cockpit-ad-metric-cards.tsx");
const explorationSectionSource = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");
const channelBreakdownSource = loadSource("src", "app", "clients", "cockpit-channel-breakdown.tsx");
const diagnosticsCardSource = loadSource("src", "app", "clients", "cockpit-diagnostics-card.tsx");

console.log("\n1 — Arquivos superados pelo redesign saíram do disco (consolidados, nunca duplicados em paralelo)\n");

ok("cockpit-daily-evolution-section.tsx (gráfico SVG artesanal) não existe mais", !fileExists("src", "app", "clients", "cockpit-daily-evolution-section.tsx"));
ok("cockpit-ad-evolution-section.tsx (gráfico Recharts isolado) não existe mais — virou cockpit-evolution-section.tsx", !fileExists("src", "app", "clients", "cockpit-ad-evolution-section.tsx"));
ok("cockpit-ad-performance-section.tsx (abas Indicadores/Evolução) não existe mais — conteúdo espalhado nas 2 áreas certas", !fileExists("src", "app", "clients", "cockpit-ad-performance-section.tsx"));
ok("dashboard-channel-section.tsx (card por canal) não existe mais — virou channel-data-issue.ts (só o tipo) + cockpit-channel-breakdown.tsx (quebra compacta)", !fileExists("src", "app", "clients", "dashboard-channel-section.tsx"));

console.log("\n2 — VISÃO EXECUTIVA: um bloco só, nunca mais Meta & Ritmo/Diagnóstico/Canais/Indicadores como seções separadas\n");

ok("heading único 'Visão executiva'", pageSource.includes('>Visão executiva<'));
ok("nenhum heading 'Meta & Ritmo' isolado sobrevive (consolidado na Visão executiva)", !pageSource.includes("Meta &amp; Ritmo"));
ok("Resultado/Custo/Orçamento continuam renderizados (CockpitResultCard/CockpitCostCard/CockpitBudgetCard, mesmos dados/edição de sempre)", pageSource.includes("<CockpitResultCard") && pageSource.includes("<CockpitCostCard") && pageSource.includes("<CockpitBudgetCard"));
ok(
  "Diagnóstico é discreto: devolve null sozinho quando vazio (nunca ocupa uma seção inteira à toa)",
  diagnosticsCardSource.includes("if (insights.length === 0) return null;"),
);
ok("quebra por canal só aparece com MAIS de um canal — card por canal isolado não existe mais", channelBreakdownSource.includes("if (rows.length < 2) return null;"));
ok(
  "Indicadores Meta Ads (personalizáveis) continuam, movidos pra dentro da Visão executiva — mesmo componente CockpitAdMetricCards",
  pageSource.includes("<CockpitAdMetricCards"),
);

console.log("\n3 — Indicadores: Investimento/Resultado/Custo por resultado NUNCA duplicados entre Visão executiva e Indicadores Meta Ads\n");

ok("ALL_METRIC_CARD_IDS (catálogo selecionável dos indicadores Meta Ads) não inclui mais investment/results/costPerResult", !ALL_METRIC_CARD_IDS.some((id) => id === "investment" || id === "results" || id === "costPerResult"));
ok("ALL_METRIC_CARD_IDS tem 11 ids (14 originais - 3 já cobertos pelos cards de Resultado/Custo/Orçamento)", ALL_METRIC_CARD_IDS.length === 11);
ok("seleção padrão (6 indicadores) continua um subconjunto válido, nenhum deles duplicado", DEFAULT_SELECTED_METRIC_IDS.every((id) => ALL_METRIC_CARD_IDS.includes(id)));
ok("painel de personalização não oferece mais a categoria 'Resultados' (Investimento/Resultado/Custo saíram)", !metricCardsSource.includes('"Resultados"'));
ok("personalização continua persistida por cliente via localStorage (nenhuma tabela nova)", metricCardsSource.includes("window.localStorage") && metricCardsSource.includes("${STORAGE_KEY_PREFIX}${clientId}"));

console.log("\n4 — EVOLUÇÃO DA PERFORMANCE: módulo único, nunca mais dois gráficos separados\n");

ok("page.tsx renderiza um CockpitEvolutionSection só (nenhum CockpitDailyEvolutionSection/CockpitAdEvolutionSection remanescente)", pageSource.includes("<CockpitEvolutionSection") && !pageSource.includes("CockpitDailyEvolutionSection") && !pageSource.includes("CockpitAdEvolutionSection"));
ok(
  "séries por objetivo (Resultado/Custo/Investimento diário) e séries Meta Ads são concatenadas no MESMO array — um seletor só, nunca dois gráficos lado a lado",
  pageSource.includes("const mergedEvolutionSeries: EvolutionSeriesOption[] = [") && pageSource.includes("...goalEvolutionSeries,"),
);
ok(
  "Investimento/Resultado/Custo por resultado das métricas Meta Ads são excluídos da fusão quando já existe série por objetivo — nunca duplicados no mesmo seletor",
  pageSource.includes('s.id !== "investment" && s.id !== "results" && s.id !== "costPerResult"'),
);
ok(
  "o merge é só PONTE de dados — importa só o TIPO de CockpitDailyEvolutionPoint (nunca a função, nenhum cálculo novo aqui)",
  mergeLibSource.includes('import type { CockpitDailyEvolutionPoint } from "./cockpit-daily-evolution";'),
);
ok("escalas/unidades preservadas — cada métrica mantém seu próprio eixo (ChartMetricUnit), nunca dual-axis", evolutionSource.includes("formatMetricValue(unit, value)") && !evolutionSource.includes("yAxisId"));
ok("comparação entre métricas preservada ('Outra métrica', cada painel com sua régua)", evolutionSource.includes('"other_metric"') && evolutionSource.includes("EvolutionChartPanel"));
ok("estado vazio nunca fabrica gráfico — mensagem explícita decidida por quem monta a página", evolutionSource.includes("emptyMessage"));

console.log("\n5 — EXPLORAÇÃO DE CAMPANHAS: seção própria, prioritária, funcionalidades intocadas\n");

ok("page.tsx renderiza CockpitAdExplorationSection como ÁREA 3, própria (fora de qualquer aba)", /ÁREA 3[\s\S]{0,700}<CockpitAdExplorationSection/.test(pageSource));
ok("heading com o mesmo peso visual da Visão executiva (text-base, nunca mais o rótulo pequeno de antes)", /Campanhas, conjuntos e an.{1}ncios<\/h2>/.test(pageSource) && /text-base font-medium[\s\S]{0,40}Campanhas, conjuntos/.test(pageSource));
ok("busca + personalização de colunas preservadas (nenhuma funcionalidade removida)", explorationSectionSource.includes("SlidersHorizontal") && explorationSectionSource.includes("loadStoredColumns"));
ok("drill-down Campanha->Conjunto/Anúncio preservado, mesma limitação documentada (abas irmãs, nunca filtro cruzado)", explorationSectionSource.includes("abas IRMÃS"));

console.log("\n6 — Preservação: nada essencial foi removido\n");

ok("saldo Meta Ads continua no cabeçalho", pageSource.includes("<CockpitAdAccountBalance"));
ok("atualização de dados (DataFreshnessTimer) continua no cabeçalho", pageSource.includes("<DataFreshnessTimer"));
ok("MonthSelect continua a única fonte de período", pageSource.includes("<MonthSelect"));
ok("Ver Metas -> continua apontando pro planejamento completo", pageSource.includes("Ver Metas"));
ok("/clients/[id]/relatorio (Integrações Meta Ads e Stract, Relatórios) continua existindo, intocado", loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx").length > 0);
ok("nenhum número/gráfico fictício — view-models continuam vindo 100% do servidor, nenhum Math.random/valor mockado no componente", !evolutionSource.includes("Math.random") && !channelBreakdownSource.includes("Math.random"));

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
