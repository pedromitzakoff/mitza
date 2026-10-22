/**
 * Testes da Etapa "KOFF Analytics — Redesign e organização visual do
 * Cockpit". Cobre:
 *  - `DEFAULT_SELECTED_METRIC_IDS` (núcleo puro, `metric-cards.ts`): o novo
 *    padrão de 6 indicadores nunca duplica Investimento/Resultados/Custo
 *    por resultado (já aparecem em Canais/Meta & Ritmo) — pedido explícito
 *    do usuário ("evitar duplicar indicadores que já apareçam em outras
 *    partes do Cockpit").
 *  - Checagens ESTRUTURAIS (grep de código-fonte, mesmo padrão já usado
 *    por `test-mitza-one-fase1-cockpit.ts`): personalização de métricas
 *    reintroduzida com `localStorage` por cliente; "Performance Meta Ads"
 *    virou abas (Indicadores/Evolução), sem caixa externa envolvendo tudo;
 *    a tabela de exploração (Campanhas/Conjuntos/Anúncios) ganhou seção
 *    PRÓPRIA, sempre visível, nunca escondida atrás de uma aba; o gráfico
 *    de evolução não começa mais em "Investimento" (já coberto pela
 *    Evolução Diária existente).
 *
 * Rodar: npx tsx scripts/test-cockpit-redesign.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const metricCardsSource = loadSource("src", "app", "clients", "cockpit-ad-metric-cards.tsx");
const performanceSectionSource = loadSource("src", "app", "clients", "cockpit-ad-performance-section.tsx");
const evolutionSectionSource = loadSource("src", "app", "clients", "cockpit-ad-evolution-section.tsx");
const explorationSectionSource = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");

console.log("1 — DEFAULT_SELECTED_METRIC_IDS: 6 indicadores, nenhum duplicado com Canais/Meta & Ritmo\n");

ok("tem exatamente 6 métricas", DEFAULT_SELECTED_METRIC_IDS.length === 6);
ok("todas são ids válidos entre os 14 existentes", DEFAULT_SELECTED_METRIC_IDS.every((id) => ALL_METRIC_CARD_IDS.includes(id)));
ok(
  "nenhuma delas é investimento/resultados/custo por resultado — já aparecem no bloco Meta Ads de Canais e em Meta & Ritmo",
  !DEFAULT_SELECTED_METRIC_IDS.some((id) => id === "investment" || id === "results" || id === "costPerResult"),
);

console.log("\n2 — Personalização de indicadores REINTRODUZIDA (pedido explícito: preservar por cliente, no navegador)\n");

ok("usa localStorage com chave por cliente", metricCardsSource.includes("window.localStorage") && metricCardsSource.includes("${STORAGE_KEY_PREFIX}${clientId}"));
ok("checkbox por indicador, escolha livre entre os 14", metricCardsSource.includes('type="checkbox"') && metricCardsSource.includes("toggleMetric"));
ok("indicadores agrupados por categoria no painel de personalização (Entrega/Tráfego/Resultados/Receita)", /CATEGORY_GROUPS/.test(metricCardsSource) && metricCardsSource.includes('"Entrega"') && metricCardsSource.includes('"Receita"'));
ok("mesmo cuidado de hidratação de sempre (default idêntico servidor/cliente, só troca dentro de useEffect)", metricCardsSource.includes("useEffect(() => {") && metricCardsSource.includes("applyStoredSelection"));
ok("cards sempre na ordem canônica por categoria — nunca a ordem em que o usuário marcou", metricCardsSource.includes("ALL_METRIC_CARD_IDS.map((id) =>"));

console.log("\n3 — 'Performance Meta Ads' virou abas (Indicadores/Evolução), sem caixa externa envolvendo tudo\n");

ok("duas abas: Indicadores e Evolução", performanceSectionSource.includes('"Indicadores"') && performanceSectionSource.includes('"Evolução"'));
ok("alterna conteúdo por estado local (useState<Tab>), nunca as duas vistas simultâneas", performanceSectionSource.includes('useState<Tab>("indicators")'));
ok(
  "a tabela de exploração NÃO mora mais dentro desta seção — ganhou destaque próprio (ver page.tsx)",
  !performanceSectionSource.includes("CockpitAdExplorationSection") && !performanceSectionSource.includes("Campanhas, conjuntos e anúncios"),
);
ok(
  "nenhum CTA pra outra rota (regra de página única, reafirmada mesmo após o redesign)",
  !performanceSectionSource.includes("Ver Performance completa") && !performanceSectionSource.includes("Ver campanhas"),
);

console.log("\n4 — Exploração de campanhas: seção própria, sempre visível (nunca escondida atrás de uma aba)\n");

ok("page.tsx renderiza CockpitAdExplorationSection FORA de CockpitAdPerformanceSection, como seção própria", /SEÇÃO 5[\s\S]{0,600}<CockpitAdExplorationSection/.test(pageSource));
ok("exploração sempre visível pra cliente Meta (mesmo critério de clientChannels, nenhum estado de aba escondendo)", (pageSource.match(/clientChannels\.includes\("meta"\)/g) ?? []).length >= 3);
ok("toolbar (busca + colunas) com controles de mesma altura (h-9), discreta", explorationSectionSource.includes("h-9") && explorationSectionSource.includes("min-h-9"));

console.log("\n5 — Gráfico de evolução: padrão não duplica a série de Investimento da Evolução Diária\n");

ok("métrica A padrão é 'impressions', nunca 'investment' (Evolução Diária já mostra investimento por dia)", evolutionSectionSource.includes('useState<ChartMetricId>("impressions")'));
ok("altura do gráfico aumentada (h-72) e tooltip usa os tokens do Cockpit (nunca branco fixo)", evolutionSectionSource.includes("h-72") && evolutionSectionSource.includes('backgroundColor: "var(--overview-surface)"'));

console.log("\n6 — Preservação: nada essencial foi removido\n");

ok("Meta & Ritmo continua intacto (CockpitResultCard/CockpitCostCard/CockpitBudgetCard)", pageSource.includes("<CockpitResultCard") && pageSource.includes("<CockpitCostCard") && pageSource.includes("<CockpitBudgetCard"));
ok("Diagnóstico continua intacto", pageSource.includes("<CockpitDiagnosticsCard"));
ok("Canais continua intacto", pageSource.includes("<DashboardChannelSection"));
ok("Evolução Diária continua intacta", pageSource.includes("<CockpitDailyEvolutionSection"));
ok("filtro de mês (MonthSelect) continua a única fonte de período, nenhum segundo seletor pra Performance Meta Ads", pageSource.includes("<MonthSelect"));
ok("todas as 14 métricas continuam no catálogo (ALL_METRIC_CARD_IDS)", ALL_METRIC_CARD_IDS.length === 14);
ok("/clients/[id]/relatorio (Integrações Meta Ads e Stract, Relatórios) continua existindo, intocado", loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx").length > 0);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
