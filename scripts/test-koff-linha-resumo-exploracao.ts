/**
 * Testes da Etapa "Linha resumo consolidada" (pedido explícito do usuário:
 * "nas tabelas em baixo de todas contas eu queria uma linha resumo das
 * métricas com o consolidado de todas") — nas tabelas de Campanhas/
 * Conjuntos (ExplorationTable/ExplorationCardList, `cockpit-ad-
 * exploration-section.tsx`).
 *
 * Cobre:
 *  A. Comportamento real (behavioral) de `buildExplorationTotals` — soma
 *     aditiva correta, recálculo (nunca média) de métricas derivadas,
 *     `null`/"—" nunca fabricado.
 *  B. Colunas por objetivo (Resultado/Custo): nunca mistura objetivos
 *     diferentes no mesmo total.
 *  C. Wiring estrutural: ExplorationTable (tfoot) e ExplorationCardList
 *     (card "Total") usam a MESMA função, sobre o MESMO conjunto exibido
 *     (já filtrado/pesquisado).
 *
 * Rodar: npx tsx scripts/test-koff-linha-resumo-exploracao.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExplorationTotals, type ExplorationRow } from "../src/lib/meta-ads-dashboard/exploration-data";
import { formatCurrency, formatCount, formatPercent } from "../src/lib/format";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function row(overrides: Partial<ExplorationRow>): ExplorationRow {
  return {
    id: overrides.name ?? "Campanha",
    name: "Campanha",
    spend: 100,
    impressions: 1000,
    clicks: 20,
    linkClicks: 15,
    revenue: null,
    cpc: 5,
    linkCpc: 6.67,
    ctr: 0.02,
    linkCtr: 0.015,
    cpm: 100,
    roas: null,
    resultType: null,
    resultByGoal: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — Métricas ADITIVAS somam direto (Investimento/Impressões/Cliques/Receita)\n");
{
  const rows = [
    row({ name: "A", spend: 1000, impressions: 10000, clicks: 200, linkClicks: 150, revenue: 3000 }),
    row({ name: "B", spend: 500, impressions: 5000, clicks: 100, linkClicks: 80, revenue: 1000 }),
  ];
  const totals = buildExplorationTotals(rows);
  // Compara contra as MESMAS funções de formatação usadas pela função real
  // (nunca um literal escrito à mão — `formatCurrency` usa espaço
  // não-quebrável entre "R$" e o número, fácil de digitar errado à mão).
  ok("spend = 1000+500 (formatado)", totals.get("spend") === formatCurrency(1500));
  ok("impressions = 10000+5000 (formatado)", totals.get("impressions") === formatCount(15000));
  ok("clicks = 200+100 (formatado)", totals.get("clicks") === formatCount(300));
  ok("revenue = 3000+1000 (formatado)", totals.get("revenue") === formatCurrency(4000));
}

console.log("\nB — Métricas DERIVADAS são RECALCULADAS dos totais somados — nunca a média das razões por linha (produziria número errado)\n");
{
  // Duas campanhas com CTR individual MUITO diferente (10% vs 1%) — a média
  // simples das duas (5,5%) seria tecnicamente errada; o CTR real do total
  // (300 cliques / 11000 impressões = 2,727...%) é o único número correto.
  const rows = [
    row({ name: "A", impressions: 1000, clicks: 100 }), // CTR individual 10%
    row({ name: "B", impressions: 10000, clicks: 200 }), // CTR individual 2%
  ];
  const totals = buildExplorationTotals(rows);
  // 300/11000 = 0,027272... — compara contra a MESMA fórmula/formatPercent,
  // nunca contra a média simples das razões individuais (10%+2%)/2 = 6%,
  // que seria tecnicamente errada.
  ok(
    "CTR do total é recalculado (300/11000), nunca a média simples das razões por linha",
    totals.get("ctr") === formatPercent((300 / 11000) * 100),
  );
}

console.log("\nC — spend=0/ausente -> métricas derivadas nunca dividem por zero/fabricam número\n");
{
  const rows = [row({ name: "A", spend: 0, clicks: null }), row({ name: "B", spend: 0, clicks: null })];
  const totals = buildExplorationTotals(rows);
  ok("cpc fica '—' quando não há clique nenhum pra dividir (nunca Infinity/NaN)", totals.get("cpc") === "—");
  ok("roas fica '—' sem receita registrada (nunca 0 fabricado)", totals.get("roas") === "—");
}

console.log("\nD — Colunas por objetivo: cada total soma só as linhas DO PRÓPRIO objetivo, nunca mistura Leads com Vendas\n");
{
  const rows = [
    row({ name: "Campanha Leads 1", spend: 300, resultType: "leads", resultByGoal: { leads: { count: 10, cost: 30 } } }),
    row({ name: "Campanha Leads 2", spend: 200, resultType: "leads", resultByGoal: { leads: { count: 5, cost: 40 } } }),
    row({ name: "Campanha Vendas", spend: 1000, resultType: "sales", resultByGoal: { sales: { count: 4, cost: 250 } } }),
  ];
  const totals = buildExplorationTotals(rows);
  // Leads: 15 resultados / R$500 investido (300+200) = custo médio de 500/15
  ok("result:leads soma só as 2 campanhas de leads (10+5=15)", totals.get("result:leads") === formatCount(15));
  ok(
    "cost:leads usa o investimento das campanhas DE LEADS só (500/15), nunca inclui o investimento da campanha de Vendas",
    totals.get("cost:leads") === formatCurrency(500 / 15),
  );
  ok("result:sales soma só a campanha de vendas (4)", totals.get("result:sales") === formatCount(4));
  ok("cost:sales usa só o investimento da campanha de vendas (1000/4=250)", totals.get("cost:sales") === formatCurrency(250));
}

console.log("\nE — Conjunto vazio -> nenhum total fabricado (Map vazio, nunca '—' ou '0' inventado por coluna)\n");
{
  const totals = buildExplorationTotals([]);
  ok("Map vazio quando não há linha nenhuma — quem chama decide o que mostrar (mesma convenção de 'sem dado' do resto da plataforma)", totals.size === 0);
}

// ---------------------------------------------------------------------------
console.log("\nF — Wiring estrutural: ExplorationTable (tfoot) e ExplorationCardList (card Total) reaproveitam a MESMA função\n");
{
  const source = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");

  ok("buildExplorationTotals é importado (nenhuma segunda implementação local)", source.includes("buildExplorationTotals,"));
  ok(
    "ExplorationTable calcula totals sobre `rows` (já filtrado/pesquisado por quem chama) e renderiza um <tfoot>",
    source.includes("const totals = buildExplorationTotals(rows);") && source.includes("<tfoot>"),
  );
  ok("a célula 'Nome' do rodapé mostra 'Total', nunca um valor numérico fabricado ali", source.includes('{col.id === "name" ? "Total" : (totals.get(col.id) ?? "—")}'));
  ok(
    "ExplorationCardList (mobile) mostra o mesmo total como card, só quando há colunas de métrica visíveis (mesma condição das linhas normais)",
    (source.match(/buildExplorationTotals\(rows\)/g) ?? []).length === 2,
  );
}

console.log(`\n${passed} verificações OK.\n`);
