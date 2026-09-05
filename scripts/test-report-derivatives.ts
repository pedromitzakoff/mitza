/**
 * Testes puros da camada de derivados do Performance Report
 * (`lib/performance-report/report-derivatives.ts`) — Etapa "Otimização do
 * Performance Report". Cobre exatamente os cenários pedidos: variação
 * percentual vs. meta (acima/abaixo/igual/meta nula/meta zero/sem custo),
 * melhor campanha por custo, maior volume, empate determinístico, campanhas
 * sem resultado, leitura do período (lead/venda, singular/plural, sem
 * resultado), e badges de campanha (nenhum resultado global comparável,
 * meta ausente). Nunca testa HTML/renderização — isso é
 * `test-performance-report.ts`.
 *
 * Rodar: npx tsx scripts/test-report-derivatives.ts
 */
import assert from "node:assert/strict";
import {
  buildCampaignBadges,
  buildPeriodReading,
  buildTargetVariationLabel,
  findBestCostCampaign,
  findHighestVolumeCampaign,
  resolveCampaignTargetBadge,
} from "../src/lib/performance-report/report-derivatives";
import type { CostComparison, PerformanceSummary } from "../src/lib/performance";
import { compareCostToTarget } from "../src/lib/performance";
import type { CampaignSummary } from "../src/lib/campaign-analytics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function campaign(name: string, overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    campaignName: name,
    channel: "meta",
    totalSpend: 100,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: "leads",
    totalResultCount: 10,
    totalRevenue: null,
    cpa: 10,
    cpc: null,
    ctr: null,
    roas: null,
    ...overrides,
  };
}

function baseSummary(overrides: Partial<PerformanceSummary> = {}): PerformanceSummary {
  return {
    scope: "consolidated",
    resultType: "leads",
    resultCount: 10,
    hasAnyRecord: true,
    actualSpend: 300,
    costPerResult: 30,
    costUnavailableReason: "available",
    targetCostPerResult: null,
    comparison: { variation: null, status: "not_available" },
    revenue: null,
    roas: null,
    averageTicket: null,
    latestSource: "meta",
    latestUpdatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("1 — buildTargetVariationLabel: custo acima da meta\n");

const comparisonAbove: CostComparison = compareCostToTarget(34.01, 30);
check(
  "34,4% acima (34,01 vs 30) formatado com meta e direção",
  buildTargetVariationLabel(comparisonAbove, 30),
  "Meta: R$ 30,00 · 13,4% acima da meta",
);

// ---------------------------------------------------------------------------
console.log("\n2 — buildTargetVariationLabel: custo abaixo da meta\n");

const comparisonBelow: CostComparison = compareCostToTarget(24, 30);
check("20% abaixo da meta", buildTargetVariationLabel(comparisonBelow, 30), "Meta: R$ 30,00 · 20,0% abaixo da meta");

// ---------------------------------------------------------------------------
console.log("\n3 — buildTargetVariationLabel: custo exatamente igual à meta\n");

const comparisonEqual: CostComparison = compareCostToTarget(30, 30);
check("variação 0% vira 'Na meta', nunca 'acima'/'abaixo'", buildTargetVariationLabel(comparisonEqual, 30), "Meta: R$ 30,00 · Na meta");

// ---------------------------------------------------------------------------
console.log("\n4 — buildTargetVariationLabel: meta nula → sem variação calculada\n");

const comparisonNoTarget: CostComparison = compareCostToTarget(30, null);
check("targetCostPerResult null → null (nunca uma variação inventada)", buildTargetVariationLabel(comparisonNoTarget, null), null);

// ---------------------------------------------------------------------------
console.log("\n5 — buildTargetVariationLabel: meta zero → sem variação calculada (nunca divisão por zero)\n");

const comparisonZeroTarget: CostComparison = compareCostToTarget(30, 0);
check("targetCostPerResult 0 → null (safeDivide/computeVariationFromTarget já protegem)", buildTargetVariationLabel(comparisonZeroTarget, 0), null);

// ---------------------------------------------------------------------------
console.log("\n6 — buildTargetVariationLabel: sem custo disponível → sem variação\n");

const comparisonNoCost: CostComparison = compareCostToTarget(null, 30);
check("costPerResult null → null", buildTargetVariationLabel(comparisonNoCost, 30), null);

// ---------------------------------------------------------------------------
console.log("\n7 — findBestCostCampaign: só entre campanhas com resultado > 0\n");

const campaignsForBestCost = [
  campaign("Sem resultado", { totalResultCount: 0, cpa: null }),
  campaign("Sem mapeamento", { totalResultCount: null, cpa: null }),
  campaign("Custo alto", { totalResultCount: 5, cpa: 40 }),
  campaign("Custo baixo", { totalResultCount: 8, cpa: 15 }),
];
check("melhor custo é a de menor CPA entre as elegíveis", findBestCostCampaign(campaignsForBestCost)?.campaignName, "Custo baixo");
check("nenhuma campanha elegível (todas resultado 0/null) → null", findBestCostCampaign([campaign("A", { totalResultCount: 0, cpa: null })]), null);
check("lista vazia → null", findBestCostCampaign([]), null);

// ---------------------------------------------------------------------------
console.log("\n8 — findBestCostCampaign: empate de custo resolvido deterministicamente\n");

const tiedCost = [
  campaign("Zebra", { totalResultCount: 5, cpa: 20 }),
  campaign("Abacate", { totalResultCount: 5, cpa: 20 }),
  campaign("Mango", { totalResultCount: 9, cpa: 20 }),
];
check(
  "empate de CPA: desempata por MAIOR volume, depois nome (pt-BR)",
  findBestCostCampaign(tiedCost)?.campaignName,
  "Mango",
);
const tiedCostAndVolume = [campaign("Zebra", { totalResultCount: 5, cpa: 20 }), campaign("Abacate", { totalResultCount: 5, cpa: 20 })];
check("empate total (custo e volume) desempata por nome alfabético", findBestCostCampaign(tiedCostAndVolume)?.campaignName, "Abacate");

// ---------------------------------------------------------------------------
console.log("\n9 — findHighestVolumeCampaign: maior volume de resultado\n");

const campaignsForVolume = [
  campaign("Baixo volume", { totalResultCount: 3, cpa: 10 }),
  campaign("Alto volume", { totalResultCount: 20, cpa: 25 }),
  campaign("Zero", { totalResultCount: 0, cpa: 5 }),
];
check("maior volume entre as com resultado > 0", findHighestVolumeCampaign(campaignsForVolume)?.campaignName, "Alto volume");
check("nenhuma campanha com resultado > 0 → null", findHighestVolumeCampaign([campaign("A", { totalResultCount: 0 })]), null);

// ---------------------------------------------------------------------------
console.log("\n10 — findHighestVolumeCampaign: empate de volume resolvido deterministicamente\n");

const tiedVolume = [
  campaign("Zebra", { totalResultCount: 10, cpa: 30 }),
  campaign("Abacate", { totalResultCount: 10, cpa: 15 }),
];
check("empate de volume: desempata por MENOR custo, depois nome", findHighestVolumeCampaign(tiedVolume)?.campaignName, "Abacate");

// ---------------------------------------------------------------------------
console.log("\n11 — resolveCampaignTargetBadge: acima/abaixo/sem meta\n");

check("cpa acima da meta → 'above'", resolveCampaignTargetBadge(40, 30), "above");
check("cpa abaixo da meta → 'below'", resolveCampaignTargetBadge(20, 30), "below");
check("cpa igual à meta → null (nem acima nem abaixo)", resolveCampaignTargetBadge(30, 30), null);
check("sem meta → null", resolveCampaignTargetBadge(40, null), null);
check("sem custo → null", resolveCampaignTargetBadge(null, 30), null);
check("meta zero/negativa → null (nunca badge chutado)", resolveCampaignTargetBadge(40, 0), null);

// ---------------------------------------------------------------------------
console.log("\n12 — buildCampaignBadges: combinação de badges, nunca mais de um por categoria\n");

const bestCost = campaign("Melhor custo", { totalResultCount: 8, cpa: 15 });
const highestVolume = campaign("Maior volume", { totalResultCount: 20, cpa: 25 });
const plainAbove = campaign("Só acima da meta", { totalResultCount: 5, cpa: 50 });
const plainNoTarget = campaign("Sem meta nenhuma", { totalResultCount: 5, cpa: 50 });

check("campanha de melhor custo ganha só 'Melhor custo' (sem meta configurada)", buildCampaignBadges(bestCost, bestCost, highestVolume, null), ["Melhor custo"]);
check("campanha de maior volume ganha só 'Maior volume'", buildCampaignBadges(highestVolume, bestCost, highestVolume, null), ["Maior volume"]);
check("campanha comum acima da meta ganha só 'Acima da meta'", buildCampaignBadges(plainAbove, bestCost, highestVolume, 30), ["Acima da meta"]);
check("sem meta configurada → nenhum badge de meta", buildCampaignBadges(plainNoTarget, bestCost, highestVolume, null), []);
check(
  "campanha que é best-cost E está acima da meta ganha os dois badges",
  buildCampaignBadges(bestCost, bestCost, null, 10),
  ["Melhor custo", "Acima da meta"],
);
check("identidade por (channel, campaignName), nunca por posição", buildCampaignBadges(campaign("Outra", { cpa: 15 }), bestCost, null, null), []);

// ---------------------------------------------------------------------------
console.log("\n13 — buildPeriodReading: leitura neutra sem nenhum resultado\n");

check(
  "resultCount 0 → frase neutra, singular do objetivo, sem 2ª/3ª frase",
  buildPeriodReading({ performanceGoal: "leads", performanceSummary: baseSummary({ resultCount: 0, costPerResult: null, comparison: { variation: null, status: "not_available" } }), campaigns: [] }),
  ["Nenhum lead foi registrado no período."],
);
check(
  "objetivo 'sales' usa o singularLabel de PERFORMANCE_GOALS ('venda')",
  buildPeriodReading({ performanceGoal: "sales", performanceSummary: baseSummary({ resultCount: 0, resultType: "sales", costPerResult: null, comparison: { variation: null, status: "not_available" } }), campaigns: [] }),
  ["Nenhum venda foi registrado no período."],
);

// ---------------------------------------------------------------------------
console.log("\n14 — buildPeriodReading: leads, plural, com meta e melhor campanha\n");

const leadsSummary = baseSummary({
  resultCount: 12,
  costPerResult: 25,
  targetCostPerResult: 30,
  comparison: compareCostToTarget(25, 30),
});
const leadsReading = buildPeriodReading({
  performanceGoal: "leads",
  performanceSummary: leadsSummary,
  campaigns: [campaign("A", { totalResultCount: 6, cpa: 20 }), campaign("B", { totalResultCount: 6, cpa: 30 })],
});
check("1ª frase: volume plural + CPL", leadsReading[0], "Foram registrados 12 leads, com CPL de R$ 25,00.");
check("2ª frase: variação vs. meta em forma de frase", leadsReading[1], "O custo ficou 16,7% abaixo da meta de R$ 30,00.");
check("3ª frase: melhor campanha (menor CPL entre as com resultado > 0)", leadsReading[2], "A campanha com melhor eficiência apresentou CPL de R$ 20,00.");
check("no máximo 3 frases", leadsReading.length, 3);

// ---------------------------------------------------------------------------
console.log("\n15 — buildPeriodReading: singular (1 resultado), sem meta, sem campanha elegível\n");

const singularSummary = baseSummary({ resultCount: 1, costPerResult: 40, targetCostPerResult: null, comparison: { variation: null, status: "not_available" } });
const singularReading = buildPeriodReading({ performanceGoal: "leads", performanceSummary: singularSummary, campaigns: [campaign("Sem resultado", { totalResultCount: 0, cpa: null })] });
check("1 lead → singular ('lead', não 'leads')", singularReading[0], "Foram registrados 1 lead, com CPL de R$ 40,00.");
check("sem meta → sem 2ª frase; sem campanha elegível → sem 3ª frase", singularReading.length, 1);

// ---------------------------------------------------------------------------
console.log(`\nTodos os ${passed} testes passaram.`);
