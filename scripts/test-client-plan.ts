/**
 * Testes puros do resolvedor de Planejamento por canal (Etapa "Planejamento
 * por Canal") — `resolveClientMonthlyPlan` (lib/client-plan.ts). Cobre a mesma
 * garantia central da arquitetura multicanal: CPA planejado nunca é lido de
 * uma coluna, sempre derivado; canal sem plano ainda entra com tudo null
 * (nunca omitido); consolidado é sempre a soma dos canais com plano.
 *
 * Rodar: npx tsx scripts/test-client-plan.ts
 */
import assert from "node:assert/strict";
import { resolveClientMonthlyPlan, resolveConsolidatedMonthlyPlanned, type ClientPlanChangeRow } from "../src/lib/client-plan";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("resolveClientMonthlyPlan\n");

check(
  "canal sem nenhuma versão elegível ainda -> entra no byChannel com tudo null (nunca omitido)",
  resolveClientMonthlyPlan({ channels: ["meta", "google"], changes: [], selectedMonth: "2026-08-01" }),
  {
    byChannel: {
      meta: { investment: null, resultCount: null, cpa: null },
      google: { investment: null, resultCount: null, cpa: null },
    },
    consolidated: { investment: null, resultCount: null, revenue: undefined, cpa: null, roas: undefined },
  },
);

const changes: ClientPlanChangeRow[] = [
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 6000, targetResultCount: 300 },
  { channel: "meta", month: "2026-08-01", changedAt: "2026-08-15T10:00:00Z", investment: 8000, targetResultCount: 400 },
  { channel: "google", month: "2026-08-01", changedAt: "2026-08-05T10:00:00Z", investment: 2000, targetResultCount: 100 },
];

check(
  "pega a versão mais recente por canal (Meta: 15/08 vence 01/08), CPA sempre derivado (nunca de uma coluna)",
  resolveClientMonthlyPlan({ channels: ["meta", "google"], changes, selectedMonth: "2026-08-01" }),
  {
    byChannel: {
      meta: { investment: 8000, resultCount: 400, cpa: 20 },
      google: { investment: 2000, resultCount: 100, cpa: 20 },
    },
    consolidated: { investment: 10000, resultCount: 500, revenue: undefined, cpa: 20, roas: undefined },
  },
);

check(
  "mês anterior ao selecionado -> versão vigente é a do mês anterior mais recente (arrasta pra frente)",
  resolveClientMonthlyPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-07-01", changedAt: "2026-07-10T10:00:00Z", investment: 5000, targetResultCount: 250 }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: 5000, resultCount: 250, cpa: 20 },
);

check(
  "mês futuro (month > selectedMonth) nunca vaza pro mês selecionado",
  resolveClientMonthlyPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-09-01", changedAt: "2026-08-01T10:00:00Z", investment: 9999, targetResultCount: 999 }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: null, resultCount: null, cpa: null },
);

check(
  "sem meta de resultado definida (targetResultCount null) -> CPA null, nunca dividido por null",
  resolveClientMonthlyPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: null }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: 5000, resultCount: null, cpa: null },
);

check(
  "só Meta tem plano (cliente Meta-only, retrocompatibilidade) -> consolidado igual ao canal único",
  resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 4000, targetResultCount: 200 }],
    selectedMonth: "2026-08-01",
  }).consolidated,
  { investment: 4000, resultCount: 200, revenue: undefined, cpa: 20, roas: undefined },
);

// Etapa "Planejamento Mensal por Canal" (Etapa 2) — checagem prévia
// confirmou que schema/função Postgres/resolvedor já existiam desde a Etapa
// "Planejamento por Canal"; os testes abaixo cobrem exatamente a lista de
// cenários pedida nesta etapa que ainda não estava coberta.

check(
  "só Google tem plano -> consolidado igual ao canal único (mesma retrocompatibilidade que Meta-only, no outro canal)",
  resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [{ channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 3000, targetResultCount: 150 }],
    selectedMonth: "2026-08-01",
  }).consolidated,
  { investment: 3000, resultCount: 150, revenue: undefined, cpa: 20, roas: undefined },
);

check(
  "mesmo investimento/resultado nos dois canais -> consolidado soma os dois (nunca reaproveita um valor só)",
  resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [
      { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: 250 },
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: 250 },
    ],
    selectedMonth: "2026-08-01",
  }).consolidated,
  { investment: 10000, resultCount: 500, revenue: undefined, cpa: 20, roas: undefined },
);

check(
  "Google com investimento mas sem meta de resultado (Meta tem) -> Google.cpa null isoladamente; consolidado soma investimento dos dois, mas resultado só do canal que tem (canal sem meta não conta como 0)",
  resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [
      { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 6000, targetResultCount: 300 },
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 4000, targetResultCount: null },
    ],
    selectedMonth: "2026-08-01",
  }),
  {
    byChannel: {
      meta: { investment: 6000, resultCount: 300, cpa: 20 },
      google: { investment: 4000, resultCount: null, cpa: null },
    },
    consolidated: { investment: 10000, resultCount: 300, revenue: undefined, cpa: 10000 / 300, roas: undefined },
  },
);

check(
  "meta de resultado explicitamente ZERO -> CPA null (nunca dividir por zero), resultCount 0 preservado (meta zero é diferente de 'sem meta', nunca vira null por engano)",
  resolveClientMonthlyPlan({
    channels: ["meta"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: 0 }],
    selectedMonth: "2026-08-01",
  }).byChannel.meta,
  { investment: 5000, resultCount: 0, cpa: null },
);

{
  const baseChanges: ClientPlanChangeRow[] = [
    { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000, targetResultCount: 250 },
    { channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 3000, targetResultCount: 150 },
  ];
  const before = resolveClientMonthlyPlan({ channels: ["meta", "google"], changes: baseChanges, selectedMonth: "2026-08-01" });

  const afterGoogleChanged = resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [
      ...baseChanges,
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-10T10:00:00Z", investment: 4000, targetResultCount: 200 },
    ],
    selectedMonth: "2026-08-01",
  });

  check("alterar só Google não muda o plano do Meta (canais são independentes)", afterGoogleChanged.byChannel.meta, before.byChannel.meta);
  check(
    "alterar só Google atualiza o plano do Google pra nova versão",
    afterGoogleChanged.byChannel.google,
    { investment: 4000, resultCount: 200, cpa: 20 },
  );

  const afterMetaChanged = resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [
      ...baseChanges,
      { channel: "meta", month: "2026-08-01", changedAt: "2026-08-10T10:00:00Z", investment: 7000, targetResultCount: 350 },
    ],
    selectedMonth: "2026-08-01",
  });

  check("alterar só Meta não muda o plano do Google (canais são independentes)", afterMetaChanged.byChannel.google, before.byChannel.google);
  check(
    "alterar só Meta atualiza o plano do Meta pra nova versão",
    afterMetaChanged.byChannel.meta,
    { investment: 7000, resultCount: 350, cpa: 20 },
  );
}

// Nota de arquitetura (não é um `check` numérico porque não há nada
// numérico pra comparar): `resolveClientMonthlyPlan` recebe só `{channels,
// changes, selectedMonth}` — nenhum parâmetro de horizonte/evento existe na
// assinatura, então não há como este resolvedor reimplementar essa lógica
// por conta própria. O horizonte (`resolvePlanningHorizon`) entra
// exclusivamente no caminho de ESCRITA, via `apply_monthly_channel_plan_change`
// (`p_first_day`/`p_last_day` já resolvidos, ver `monthly-budget-actions.ts`)
// — testado em `scripts/test-planning-horizon.ts`. Um cliente com horizonte
// até 21/08 e outro sem nenhum horizonte especial produzem o mesmo
// `ClientChannelMetrics` aqui pro mesmo `selectedMonth`: o horizonte muda
// ONDE o investimento é distribuído dia a dia (sprint_planned_allocations),
// nunca o snapshot mensal que este resolvedor lê.
console.log("\n(nota) horizonte de evento: resolveClientMonthlyPlan não tem parâmetro de horizonte — ver scripts/test-planning-horizon.ts");

console.log("\nresolveConsolidatedMonthlyPlanned (Etapa \"Migração Multicanal dos Consumidores\")\n");

// Cenário A — Meta-only: consolidado deve ser IDÊNTICO ao legado (Sprints,
// Dashboard, Painel Mensal, Relatórios, Saúde da Conta).
check(
  "A — Meta-only: consolidado = 10.000 (igual ao que Meta sozinho já mostrava)",
  resolveConsolidatedMonthlyPlanned(
    ["meta", "google"],
    [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 10000 }],
    "2026-08-01",
    0,
  ),
  10000,
);

// Cenário B — Meta + Google: consolidado soma os dois (nunca só Meta).
check(
  "B — Meta (10.000) + Google (5.000): consolidado = 15.000",
  resolveConsolidatedMonthlyPlanned(
    ["meta", "google"],
    [
      { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 10000 },
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 5000 },
    ],
    "2026-08-01",
    0,
  ),
  15000,
);

// Cenário C — Meta configurado, Google inexistente: sem regressão, e sem
// fabricar um plano Google zerado que mudaria o consolidado.
check(
  "C — Google nunca configurado -> consolidado é só o Meta (nunca 10.000 + 0 fabricado, seria o mesmo número aqui, mas a garantia real é no byChannel)",
  resolveConsolidatedMonthlyPlanned(
    ["meta", "google"],
    [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 10000 }],
    "2026-08-01",
    0,
  ),
  10000,
);
check(
  "C — confirmação via resolveClientMonthlyPlan: Google entra em byChannel com tudo null, nunca omitido nem zerado",
  resolveClientMonthlyPlan({
    channels: ["meta", "google"],
    changes: [{ channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 10000, targetResultCount: null }],
    selectedMonth: "2026-08-01",
  }).byChannel.google,
  { investment: null, resultCount: null, cpa: null },
);

// Cenário D — alteração de planejamento durante o mês: a versão vigente é
// sempre a mais recente por changedAt, nunca a primeira digitada nem uma
// soma das duas.
check(
  "D — Google alterado de 5.000 pra 7.000 no meio do mês -> consolidado usa a versão vigente (10.000 + 7.000), nunca soma as duas versões nem fica com a antiga",
  resolveConsolidatedMonthlyPlanned(
    ["meta", "google"],
    [
      { channel: "meta", month: "2026-08-01", changedAt: "2026-08-01T10:00:00Z", investment: 10000 },
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-05T10:00:00Z", investment: 5000 },
      { channel: "google", month: "2026-08-01", changedAt: "2026-08-15T10:00:00Z", investment: 7000 },
    ],
    "2026-08-01",
    0,
  ),
  17000,
);

// Fallback (comportamento de sempre, `resolveMonthlyBudget`): nenhum canal
// com nenhuma versão pra este mês -> cai pra soma das alocações diárias já
// persistidas (nunca 0/null fabricado quando existe dado real de sprint).
check(
  "Fallback — nenhum canal com plano definido pra este mês -> usa a soma de sprint_planned_allocations (fallbackPlannedSum)",
  resolveConsolidatedMonthlyPlanned(["meta", "google"], [], "2026-08-01", 4200),
  4200,
);

console.log(`\n${passed} verificações passaram.`);
