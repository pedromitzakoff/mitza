/**
 * Testes da Etapa "CTR como meta de Seguidores" (pedido explícito do
 * usuário: "ja que o meta nao me da a métrica de seguidores, quando o
 * objetivo da conta for seguidores eu quero que a meta seja o CTR...
 * assim sei q quero um CTR bem alto que tende a trazer seguidores").
 *
 * Achado real que motivou a mudança: "followers" nunca entrou em
 * `GRANULAR_RESULT_GOAL_PRIORITY` (`meta-api-ingest-run.ts`) porque a
 * Graph API nunca atribui "ganhou um seguidor" a uma campanha/anúncio
 * específico — as colunas "Resultado"/"Custo por resultado" ficavam
 * SEMPRE vazias nas tabelas de exploração pra esse objetivo. Decisão
 * final do usuário (depois de descartar CPC como meta junto — "ai vao
 * ter 2 metas ne, acho que fica estranho"): CTR DO LINK é a única meta;
 * cliques no link/custo por clique no link ficam só informativos.
 *
 * Escopo desta etapa (Fase 1, combinado com o usuário): só as tabelas de
 * Campanhas/Conjuntos/Anúncios. Metas mensais configuráveis e cards do
 * Cockpit ficam pra uma etapa seguinte — nenhum dos ~20 outros
 * consumidores de `PERFORMANCE_GOALS.followers` (Metas, diagnóstico,
 * relatório semanal) muda nesta etapa, todos continuam lendo
 * `resultMetricLabel`/`costMetricLabel` como antes ("Novos seguidores").
 *
 * Cobre:
 *  A. `PERFORMANCE_GOALS.followers.resultUnit === "percent"` — sinal
 *     usado só por `exploration-data.ts`; rótulos genéricos (pros outros
 *     consumidores) continuam "Novos seguidores"/"Custo por novo
 *     seguidor", nunca mudados.
 *  B. `buildExplorationColumns`: rótulo da coluna, pra "followers", é
 *     "CTR do link"/"Custo por clique no link" — nunca o rótulo genérico.
 *  C. `goalColumnValue`/`formatExplorationCell`: pra "followers", lê
 *     `linkCtr`/`linkCpc` (nunca `resultByGoal`, que é sempre vazio pra
 *     esse objetivo) e formata resultado como porcentagem (nunca
 *     contagem).
 *  D. `buildExplorationTotals` com `extraGoals: ["followers"]`: CTR/CPC
 *     recalculados dos totais somados (nunca a média das razões por
 *     linha, mesma regra das demais métricas derivadas desta função).
 *  E. Wiring estrutural: `primaryGoal` chega em `CockpitAdExplorationSection`
 *     pelos 3 pontos de uso, e é mesclado em `goalsPresent` (único jeito
 *     de "followers" aparecer, já que nenhuma linha tem esse
 *     `resultType`).
 *
 * Rodar: npx tsx scripts/test-koff-ctr-meta-seguidores.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildExplorationColumns,
  buildExplorationTotals,
  explorationSortValue,
  formatExplorationCell,
  goalsFromColumns,
  type ExplorationRow,
} from "../src/lib/meta-ads-dashboard/exploration-data";
import { PERFORMANCE_GOALS } from "../src/lib/performance-goals";
import { formatCurrency, formatPercent } from "../src/lib/format";

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
console.log("\nA — PERFORMANCE_GOALS.followers: resultUnit = 'percent', rótulos genéricos intocados\n");
{
  ok("resultUnit da entrada 'followers' é 'percent'", PERFORMANCE_GOALS.followers.resultUnit === "percent");
  ok(
    "rótulo genérico (pros ~20 outros consumidores: Metas, diagnóstico, relatório semanal) continua 'Novos seguidores' — nenhum deles muda nesta etapa",
    PERFORMANCE_GOALS.followers.resultMetricLabel === "Novos seguidores",
  );
  ok("demais objetivos não têm resultUnit 'percent' (só followers)", PERFORMANCE_GOALS.leads.resultUnit !== "percent" && PERFORMANCE_GOALS.sales.resultUnit !== "percent");
}

// ---------------------------------------------------------------------------
console.log("\nB — buildExplorationColumns: rótulo específico pra 'followers' (CTR do link / Custo por clique no link)\n");
{
  const columns = buildExplorationColumns(["followers"]);
  const resultCol = columns.find((c) => c.id === "result:followers");
  const costCol = columns.find((c) => c.id === "cost:followers");
  ok("coluna 'result:followers' existe e aparece visível por padrão (mesmo tratamento de qualquer objetivo com 1 só presente)", resultCol?.defaultVisible === true);
  ok("rótulo é 'CTR do link', nunca o genérico 'Novos seguidores'", resultCol?.label === "CTR do link");
  ok("coluna de custo tem rótulo 'Custo por clique no link', nunca 'Custo por novo seguidor'", costCol?.label === "Custo por clique no link");

  const leadsColumns = buildExplorationColumns(["leads"]);
  ok("outro objetivo (leads) continua com o rótulo genérico de sempre, intocado", leadsColumns.find((c) => c.id === "result:leads")?.label === "Leads");
}

// ---------------------------------------------------------------------------
console.log("\nC — Valor por linha: 'followers' lê linkCtr/linkCpc (nunca resultByGoal, sempre vazio pra esse objetivo)\n");
{
  // resultByGoal vazio de propósito (nunca tem chave 'followers' na prática
  // — a Graph API não atribui seguidor a campanha) pra provar que o valor
  // exibido vem de linkCtr/linkCpc, não de lá.
  const r = row({ linkCtr: 0.025, linkCpc: 0.8, resultType: null, resultByGoal: {} });

  ok("célula 'result:followers' mostra o linkCtr formatado como porcentagem (2,5%), nunca '—'", formatExplorationCell("result:followers", r) === formatPercent(2.5));
  ok("célula 'cost:followers' mostra o linkCpc formatado como moeda, nunca '—'", formatExplorationCell("cost:followers", r) === formatCurrency(0.8));
  ok(
    "ordenação de 'result:followers' usa o linkCtr diretamente (nunca -1, mesmo sem resultByGoal.followers)",
    explorationSortValue("result:followers", r) === 0.025,
  );

  const noLinkCtr = row({ linkCtr: null, linkCpc: null });
  ok("sem linkCtr -> '—' (nunca 0 fabricado)", formatExplorationCell("result:followers", noLinkCtr) === "—");
}

// ---------------------------------------------------------------------------
console.log("\nD — buildExplorationTotals com extraGoals=['followers']: CTR/CPC recalculados dos totais, nunca a média por linha\n");
{
  const rows = [
    row({ name: "A", spend: 100, impressions: 10000, linkClicks: 150 }), // linkCtr individual 1,5%
    row({ name: "B", spend: 50, impressions: 5000, linkClicks: 100 }), // linkCtr individual 2%
  ];
  // 250 linkClicks / 15000 impressões = 1,666...%
  const totals = buildExplorationTotals(rows, ["followers"]);
  ok(
    "result:followers do Total é (250/15000) recalculado, nunca a média simples das razões por linha (1,5%+2%)/2=1,75%, que seria errada",
    totals.get("result:followers") === formatPercent((250 / 15000) * 100),
  );
  ok("cost:followers do Total é investimento total ÷ cliques no link total (150/250)", totals.get("cost:followers") === formatCurrency(150 / 250));

  const withoutExtraGoal = buildExplorationTotals(rows);
  ok(
    "sem passar extraGoals, 'followers' nunca aparece sozinho (nenhuma linha tem resultType='followers' de verdade)",
    !withoutExtraGoal.has("result:followers"),
  );

  ok("sem nenhum link click -> '—' (nunca divide por zero)", buildExplorationTotals([row({ linkClicks: 0, impressions: 1000 })], ["followers"]).get("cost:followers") === "—");
}

// ---------------------------------------------------------------------------
console.log("\nE — goalsFromColumns: extrai os objetivos já resolvidos em `columns`, única fonte usada por buildExplorationTotals\n");
{
  const columns = buildExplorationColumns(["followers", "leads"]);
  const goals = goalsFromColumns(columns);
  ok("extrai 'followers' e 'leads' das colunas (nenhuma segunda fonte de verdade)", goals.includes("followers") && goals.includes("leads"));
  ok("colunas estáticas (nome, investimento...) nunca viram objetivo", goalsFromColumns(buildExplorationColumns([])).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\nF — Wiring estrutural: primaryGoal chega em CockpitAdExplorationSection pelos 3 pontos de uso\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");
  ok("recebe primaryGoal como prop", sectionSource.includes("primaryGoal: PerformanceGoal | null;"));
  ok(
    "primaryGoal é mesclado em goalsPresent — único jeito de 'followers' aparecer (nenhuma linha tem esse resultType)",
    /if \(primaryGoal\) goals\.add\(primaryGoal\);/.test(sectionSource),
  );
  ok("ExplorationTable/ExplorationCardList passam goalsFromColumns(columns) como extraGoals pro total", (sectionSource.match(/buildExplorationTotals\(rows, goalsFromColumns\(columns\)\)/g) ?? []).length === 2);

  const viewDataSource = loadSource("src", "lib", "cockpit-view-data.ts");
  ok("cockpit-view-data.ts (Cockpit, cobre /clients/[id] E /r/[token]) propaga primaryGoal", viewDataSource.includes("primaryGoal: performanceReportData.performanceGoal,"));

  const cockpitViewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");
  ok("cockpit-view.tsx passa primaryGoal={model.adExploration.primaryGoal}", cockpitViewSource.includes("primaryGoal={model.adExploration.primaryGoal}"));

  const campanhasSource = loadSource("src", "app", "clients", "[id]", "campanhas", "page.tsx");
  const anunciosSource = loadSource("src", "app", "clients", "[id]", "anuncios", "page.tsx");
  ok("[id]/campanhas/page.tsx passa primaryGoal={data.resultType} (já existia, reaproveitado)", campanhasSource.includes("primaryGoal={data.resultType}"));
  ok("[id]/anuncios/page.tsx passa primaryGoal={data.resultType} (já existia, reaproveitado)", anunciosSource.includes("primaryGoal={data.resultType}"));
}

console.log(`\n${passed} verificações OK.\n`);
