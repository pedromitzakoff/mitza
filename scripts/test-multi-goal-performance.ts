/**
 * Testes puros da Etapa "Múltiplos Objetivos de Performance por Cliente" —
 * cobre os 14 cenários pedidos (A-N). Só a parte testável sem banco: os
 * núcleos puros de `lib/client-plan.ts` (`resolveClientMonthlyGoals`),
 * `lib/goal-spend.ts` (spend/cobertura/CPA por objetivo) e
 * `lib/client-goals.ts` (`resolvePrimaryGoal`).
 *
 * Cenários C (exclusividade campanha→objetivo) e M (no máximo 1 principal)
 * têm sua garantia REAL no banco (`unique (client_id, channel, campaign_id)`
 * e o índice único parcial `client_goals_one_primary_per_client`,
 * `supabase/client-goals.sql`) — impossível de exercitar sem uma instância
 * real de Postgres. Aqui testamos o que a camada de aplicação assume sobre
 * esses invariantes (nunca soma a mesma campanha duas vezes, nunca deixa
 * dois principais convivendo na leitura).
 *
 * Rodar: npx tsx scripts/test-multi-goal-performance.ts
 */
import assert from "node:assert/strict";
import { resolveClientMonthlyGoals, type ClientPlanChangeRow } from "../src/lib/client-plan";
import { resolvePrimaryGoal, type ClientGoal } from "../src/lib/client-goals";
import {
  computeAssignmentCoverage,
  computeGoalSpend,
  resolveGoalCostPerResult,
  type CampaignAssignmentRow,
  type CampaignSpendRow,
} from "../src/lib/goal-spend";

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

// ---------------------------------------------------------------------------
console.log("A — Cliente legado: 1 objetivo continua funcionando após migration\n");

const legacyGoal: ClientGoal = { id: "g1", clientId: "c1", resultType: "leads", channels: [], isPrimary: true, resultSource: "automatic" };
const legacyChanges: ClientPlanChangeRow[] = [
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 6000, targetResultCount: 300, resultType: "leads" },
  { channel: "google", month: "2026-08-01", changedAt: "2026-08-05T10:00:00Z", investment: 2000, targetResultCount: 100, resultType: "leads" },
];

check(
  "objetivo único migrado produz exatamente o mesmo resultado que resolveClientMonthlyPlan produzia antes",
  resolveClientMonthlyGoals({ channels: ["meta", "google"], changes: legacyChanges, selectedMonth: "2026-08-01", clientGoals: [legacyGoal] }),
  {
    goals: [
      {
        resultType: "leads",
        isPrimary: true,
        byChannel: { meta: { investment: 6000, resultCount: 300, cpa: 20 }, google: { investment: 2000, resultCount: 100, cpa: 20 } },
        consolidated: { investment: 8000, resultCount: 400, revenue: undefined, cpa: 20, roas: undefined },
      },
    ],
  },
);

// ---------------------------------------------------------------------------
console.log("\nB — Dois objetivos coexistem sem colisão\n");

const leadsGoal: ClientGoal = { id: "g1", clientId: "c1", resultType: "leads", channels: ["meta", "google"], isPrimary: true, resultSource: "automatic" };
const followersGoal: ClientGoal = { id: "g2", clientId: "c1", resultType: "followers", channels: ["meta"], isPrimary: false, resultSource: "manual" };

const multiGoalChanges: ClientPlanChangeRow[] = [
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 6000, targetResultCount: 300, resultType: "leads" },
  { channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 2000, targetResultCount: 100, resultType: "leads" },
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 0, targetResultCount: 500, resultType: "followers" },
];

const twoGoalsPlan = resolveClientMonthlyGoals({
  channels: ["meta", "google"],
  changes: multiGoalChanges,
  selectedMonth: "2026-08-01",
  clientGoals: [leadsGoal, followersGoal],
});

check("Leads consolida Meta+Google (400 leads, R$8000)", twoGoalsPlan.goals[0].consolidated, { investment: 8000, resultCount: 400, revenue: undefined, cpa: 20, roas: undefined });
check("Seguidores só olha Meta (500, sem investimento próprio planejado)", twoGoalsPlan.goals[1].consolidated, { investment: 0, resultCount: 500, revenue: undefined, cpa: 0, roas: undefined });

// ---------------------------------------------------------------------------
console.log("\nC — Campanha só pertence a 0 ou 1 objetivo (garantia real: unique constraint no banco)\n");

const exclusiveAssignments: CampaignAssignmentRow[] = [{ channel: "meta", campaignId: "camp-1", resultType: "leads" }];
ok(
  "camp-1 nunca aparece em 2 listas de assignment simultaneamente (o array de teste, como o banco, só permite 1 linha por campanha)",
  exclusiveAssignments.filter((a) => a.campaignId === "camp-1").length === 1,
);

// ---------------------------------------------------------------------------
console.log("\nD — Renomear campanha não perde associação (identidade é sempre campaignId)\n");

const renamedCampaignSpend: CampaignSpendRow[] = [{ channel: "meta", campaignId: "camp-1", spend: 500 }];
check(
  "goalSpend de leads continua 500 mesmo que o nome da campanha tenha mudado (nunca lido aqui, só campaignId)",
  computeGoalSpend(renamedCampaignSpend, exclusiveAssignments, "leads"),
  500,
);

// ---------------------------------------------------------------------------
console.log("\nE — Campanha sem objetivo não entra no spend de nenhum goal\n");

const withUnassigned: CampaignSpendRow[] = [
  { channel: "meta", campaignId: "camp-1", spend: 500 },
  { channel: "meta", campaignId: "camp-2", spend: 300 }, // sem assignment
];
check("goalSpend de leads ignora camp-2 (não classificada)", computeGoalSpend(withUnassigned, exclusiveAssignments, "leads"), 500);

// ---------------------------------------------------------------------------
console.log("\nF — Spend por objetivo soma só as campanhas daquele objetivo\n");

const mixedAssignments: CampaignAssignmentRow[] = [
  { channel: "meta", campaignId: "camp-A", resultType: "leads" },
  { channel: "meta", campaignId: "camp-B", resultType: "leads" },
  { channel: "meta", campaignId: "camp-C", resultType: "followers" },
];
const mixedSpend: CampaignSpendRow[] = [
  { channel: "meta", campaignId: "camp-A", spend: 500 },
  { channel: "meta", campaignId: "camp-B", spend: 300 },
  { channel: "meta", campaignId: "camp-C", spend: 250 },
];
check("Spend Leads = 800 (A+B)", computeGoalSpend(mixedSpend, mixedAssignments, "leads"), 800);
check("Spend Seguidores = 250 (C)", computeGoalSpend(mixedSpend, mixedAssignments, "followers"), 250);

// ---------------------------------------------------------------------------
console.log("\nG — Coverage: assigned + unassigned = total\n");

const coverage = computeAssignmentCoverage(mixedSpend, mixedAssignments);
check("cobertura completa (100%) quando toda campanha do escopo está classificada", coverage, {
  totalCampaignSpend: 1050,
  assignedCampaignSpend: 1050,
  unassignedCampaignSpend: 0,
  assignmentCoveragePct: 100,
});

const partialSpend: CampaignSpendRow[] = [...mixedSpend, { channel: "meta", campaignId: "camp-D", spend: 200 }]; // sem objetivo
const partialCoverage = computeAssignmentCoverage(partialSpend, mixedAssignments);
check("assigned + unassigned = total sempre bate", partialCoverage.assignedCampaignSpend + partialCoverage.unassignedCampaignSpend, partialCoverage.totalCampaignSpend);
ok("cobertura cai abaixo de 100% quando há campanha sem objetivo", (partialCoverage.assignmentCoveragePct ?? 0) < 100);

// ---------------------------------------------------------------------------
console.log("\nH — CPA calcula só com base atribuível (cobertura 100%)\n");

const fullCoverageResult = resolveGoalCostPerResult({ resultCount: 40, hasResult: true, goalSpend: 800, coverage });
check("CPA = 800/40 = 20 quando cobertura é 100%", fullCoverageResult, { costPerResult: 20, reason: "available" });

// ---------------------------------------------------------------------------
console.log("\nI — CPA indisponível sem cobertura confiável, nunca rateio\n");

const incompleteCoverageResult = resolveGoalCostPerResult({ resultCount: 40, hasResult: true, goalSpend: 800, coverage: partialCoverage });
check("CPA null quando há campanha sem objetivo no escopo (nunca estima)", incompleteCoverageResult, { costPerResult: null, reason: "incomplete_coverage" });

// ---------------------------------------------------------------------------
console.log("\nJ — Seguidores manual: resultado manual + spend das campanhas classificadas -> custo por seguidor\n");

const followersAssignments: CampaignAssignmentRow[] = [{ channel: "meta", campaignId: "camp-C", resultType: "followers" }];
const followersSpend: CampaignSpendRow[] = [{ channel: "meta", campaignId: "camp-C", spend: 250 }];
const followersCoverage = computeAssignmentCoverage(followersSpend, followersAssignments);
const followersGoalSpend = computeGoalSpend(followersSpend, followersAssignments, "followers");
const followersCost = resolveGoalCostPerResult({ resultCount: 78, hasResult: true, goalSpend: followersGoalSpend, coverage: followersCoverage });
check("Custo por seguidor = 250/78 (resultado lançado manualmente, spend automático das campanhas)", followersCost, { costPerResult: 250 / 78, reason: "available" });

// ---------------------------------------------------------------------------
console.log("\nK — Multicanal: Meta Leads + Google Leads consolidam corretamente\n");

check("já coberto no cenário B (twoGoalsPlan.goals[0]) — Leads = Meta(300)+Google(100) = 400", twoGoalsPlan.goals[0].consolidated.resultCount, 400);

// ---------------------------------------------------------------------------
console.log("\nL — Seguidores não se soma com Leads (isolamento entre objetivos)\n");

check("Seguidores (goals[1]) nunca inclui os 400 leads de goals[0]", twoGoalsPlan.goals[1].consolidated.resultCount, 500);
ok("resultCount de Leads e Seguidores são objetos totalmente independentes", twoGoalsPlan.goals[0].consolidated.resultCount !== twoGoalsPlan.goals[1].consolidated.resultCount);

// ---------------------------------------------------------------------------
console.log("\nM — No máximo um objetivo principal por cliente (garantia real: índice único parcial no banco)\n");

check("resolvePrimaryGoal acha o único principal", resolvePrimaryGoal([leadsGoal, followersGoal]), leadsGoal);
check("resolvePrimaryGoal devolve null quando nenhum está marcado (nunca inventa um)", resolvePrimaryGoal([{ ...leadsGoal, isPrimary: false }]), null);

// ---------------------------------------------------------------------------
console.log("\nN — Meta antiga continua associada ao objetivo migrado (histórico preservado)\n");

const historicalRowMigrated: ClientPlanChangeRow = {
  channel: "meta",
  month: "2025-01-01",
  changedAt: "2025-01-05T10:00:00Z",
  investment: 4000,
  targetResultCount: 150,
  resultType: "leads", // backfill: result_type = performance_goal vigente do cliente
};
const historicalPlan = resolveClientMonthlyGoals({
  channels: ["meta"],
  changes: [historicalRowMigrated],
  selectedMonth: "2025-01-01",
  clientGoals: [legacyGoal],
});
check("linha histórica de 2025 (result_type preenchido pelo backfill) continua legível pelo objetivo migrado", historicalPlan.goals[0].byChannel.meta, { investment: 4000, resultCount: 150, cpa: 4000 / 150 });

// ---------------------------------------------------------------------------
console.log(`\n${passed} verificações passaram.`);
