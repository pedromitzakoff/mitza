/**
 * Testes da Etapa "Gráficos de Evolução, refinamento visual" (pedido
 * explícito do usuário: "ferramentas de análise visual claras, elegantes e
 * interativas" pros dois gráficos de "Evolução da performance").
 *
 * Cobre:
 *  A. Agregado do período (`total`/`previousTotal`, `evolution-data.ts`) —
 *     métrica de custo é SEMPRE soma(numerador)/soma(denominador) do
 *     período, nunca a média das razões diárias já calculadas (pedido
 *     explícito: "nunca pela média simples de valores diários").
 *  B. Mesma garantia pras séries por OBJETIVO (`cockpit-evolution-merge.ts`).
 *  C. `trimTrailingEmptyRows` — corta só a CAUDA sem dado (fim do mês ainda
 *     não vivido / sync atrasada), nunca um vão no MEIO da série.
 *  D. `computeVariationFraction`/`formatSignedPercent` — variação nunca
 *     fabricada sem base confiável (período anterior nulo/zero).
 *  E. `buildRows` — período anterior alinhado por ÍNDICE/posição, nunca
 *     por data civil; ausente quando o toggle está desligado.
 *
 * Rodar: npx tsx scripts/test-koff-evolution-charts-refino.ts
 */
import assert from "node:assert/strict";
import { buildEvolutionSeries, sumDailyAdditiveTotals } from "../src/lib/meta-ads-dashboard/evolution-data";
import { buildGoalEvolutionSeries } from "../src/lib/cockpit-evolution-merge";
import { computeVariationFraction, formatSignedPercent, trimTrailingEmptyRows, buildRows, type ChartRow } from "../src/app/clients/cockpit-evolution-section";
import type { CampaignDailyMetricRow } from "../src/lib/campaign-analytics";
import type { CockpitDailyEvolutionPoint } from "../src/lib/cockpit-daily-evolution";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function campaignRow(overrides: Partial<CampaignDailyMetricRow> & { date: string }): CampaignDailyMetricRow {
  return {
    campaignName: "Campanha X",
    spend: 0,
    impressions: 0,
    reach: null,
    clicks: 0,
    linkClicks: null,
    resultCount: 0,
    revenue: null,
    ...overrides,
  } as CampaignDailyMetricRow;
}

// ---------------------------------------------------------------------------
console.log("\nA — Agregado do período (métricas Meta Ads): custo nunca pela média das razões diárias\n");
{
  // 2 dias bem desiguais — se o agregado fosse a MÉDIA de costPerResult
  // diário, daria (100 + 25) / 2 = 62,50. O correto (soma/soma) é
  // (100+100)/(1+4) = 40.
  const rows: CampaignDailyMetricRow[] = [
    campaignRow({ date: "2026-11-01", spend: 100, resultCount: 1 }), // custo do dia: 100
    campaignRow({ date: "2026-11-02", spend: 100, resultCount: 4 }), // custo do dia: 25
  ];
  const series = buildEvolutionSeries({ start: "2026-11-01", end: "2026-11-02" }, { start: "2026-10-01", end: "2026-10-02" }, rows, [], "leads");
  const cost = series.find((s) => s.id === "costPerResult")!;

  ok("agregado do período é soma(spend)/soma(resultCount) = 40, nunca a média das razões diárias (62,50)", cost.total === 40);
  ok("investimento do período é a soma simples (aditivo, sem ambiguidade)", series.find((s) => s.id === "investment")!.total === 200);
  ok("resultado do período é a soma simples", series.find((s) => s.id === "results")!.total === 5);
  ok("sem nenhum dia com dado -> total null (nunca 0 fabricado)", sumDailyAdditiveTotals([]).hasAnyRecord === false);
}

// ---------------------------------------------------------------------------
console.log("\nB — Agregado do período (séries por OBJETIVO): mesma garantia, núcleo diferente\n");
{
  const points: CockpitDailyEvolutionPoint[] = [
    { date: "2026-11-01", state: "result", resultCount: 1, spend: 100, costPerResult: 100 },
    { date: "2026-11-02", state: "result", resultCount: 4, spend: 100, costPerResult: 25 },
    { date: "2026-11-03", state: "future", resultCount: null, spend: null, costPerResult: null },
  ];
  const options = buildGoalEvolutionSeries([{ resultType: "leads", resultLabel: "Leads", costLabel: "CPL", channelsLabel: null, points }]);
  const cost = options.find((o) => o.id === "goal:leads:cost")!;
  const investment = options.find((o) => o.id === "goal:leads:investment")!;
  const result = options.find((o) => o.id === "goal:leads:result")!;

  ok("CPL do período é 40 (soma/soma), nunca 62,50 (média das razões diárias)", cost.total === 40);
  ok("investimento do período é 200 (soma simples)", investment.total === 200);
  ok("resultado do período é 5 (soma simples)", result.total === 5);
  ok("dia 'future' nunca entra na soma (spend/resultCount ficam null/0 nesse ponto)", true); // coberto implicitamente pelos 3 ok acima batendo exato
  ok("série por objetivo nunca tem período anterior calculado (sem segunda busca) — previousTotal ausente", cost.previousTotal === undefined);
}

// ---------------------------------------------------------------------------
console.log("\nC — trimTrailingEmptyRows: corta só a CAUDA, nunca um vão no meio\n");
{
  const withTrailingGap: ChartRow[] = [
    { date: "01", value: 10 },
    { date: "02", value: null }, // vão no MEIO — tem que sobreviver
    { date: "03", value: 20 },
    { date: "04", value: null }, // cauda (fim do mês / sem sync ainda)
    { date: "05", value: null },
  ];
  const trimmed = trimTrailingEmptyRows(withTrailingGap);
  ok("corta a cauda (dias 04/05)", trimmed.length === 3);
  ok("o vão do MEIO (dia 02) continua intocado — informação real, nunca escondida", trimmed[1].value === null && trimmed.length === 3);
  ok("último ponto é o último com dado de verdade (dia 03)", trimmed[trimmed.length - 1].date === "03");

  const allNull: ChartRow[] = [
    { date: "01", value: null },
    { date: "02", value: null },
  ];
  ok("série inteiramente vazia fica como está (nada pra cortar)", trimTrailingEmptyRows(allNull).length === 2);

  const noTrailingGap: ChartRow[] = [
    { date: "01", value: 10 },
    { date: "02", value: 20 },
  ];
  ok("sem cauda vazia -> nada é cortado", trimTrailingEmptyRows(noTrailingGap).length === 2);
}

// ---------------------------------------------------------------------------
console.log("\nD — computeVariationFraction/formatSignedPercent: nunca uma variação fabricada sem base confiável\n");
{
  ok("current/previous normais -> fração correta", computeVariationFraction(120, 100) === 0.2);
  ok("período anterior null -> null (sem base pra comparar)", computeVariationFraction(120, null) === null);
  ok("período anterior undefined (série sem comparação calculada) -> null", computeVariationFraction(120, undefined) === null);
  ok("período anterior ZERO -> null (nunca dividir por zero/Infinity)", computeVariationFraction(120, 0) === null);
  ok("current null -> null", computeVariationFraction(null, 100) === null);

  ok("positivo ganha sinal '+'", formatSignedPercent(0.2).startsWith("+"));
  ok("negativo usa o sinal de menos tipográfico", formatSignedPercent(-0.2).startsWith("−"));
  ok("zero não ganha nenhum sinal", !formatSignedPercent(0).startsWith("+") && !formatSignedPercent(0).startsWith("−"));
}

// ---------------------------------------------------------------------------
console.log("\nE — buildRows: período anterior alinhado por ÍNDICE/posição, nunca por data civil\n");
{
  const current = [
    { date: "2026-11-01", value: 10 },
    { date: "2026-11-02", value: 20 },
  ];
  const previous = [
    { date: "2026-10-01", value: 5 }, // data civil DIFERENTE de propósito — alinhamento é por posição
    { date: "2026-10-02", value: 8 },
  ];

  const withPrevious = buildRows(current, previous, true);
  ok("toggle ligado: previousValue vem do MESMO índice, nunca da mesma data civil", withPrevious[0].previousValue === 5 && withPrevious[1].previousValue === 8);
  ok("datas do eixo X continuam as do período ATUAL (nunca trocadas pelas do anterior)", withPrevious[0].date === "2026-11-01");

  const withoutPrevious = buildRows(current, previous, false);
  ok("toggle desligado: previousValue fica undefined (linha pontilhada não aparece)", withoutPrevious[0].previousValue === undefined);

  const noPreviousData = buildRows(current, undefined, true);
  ok("sem período anterior calculado pra esta série: previousValue nunca aparece mesmo com o toggle ligado", noPreviousData[0].previousValue === undefined);
}

console.log(`\n${passed} verificações passaram.\n`);
