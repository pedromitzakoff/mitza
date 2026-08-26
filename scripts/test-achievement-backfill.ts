/**
 * Testes do backfill de 30 dias das Conquistas — cobre os 10 cenários
 * pedidos (A auditoria original já cobre as regras em si, ver
 * `scripts/test-achievement-engine.ts`; este arquivo cobre especificamente
 * o comportamento NOVO desta etapa: janela/ordem do backfill, guarda de
 * cruzamento em regras cumulativas de Agência/Pessoa, e a decisão pura de
 * frescor).
 *
 * `evaluateAchievementsForDate`/`runBackfill` em si são I/O-bound (Supabase)
 * e não têm como ser exercitados sem um banco real — este ambiente não tem
 * credenciais (ver relatório da etapa). Por isso os cenários abaixo testam
 * cada peça relevante na sua forma PURA (extraída especificamente pra isso
 * — `lastNClosedDaysEndingYesterday`, `buildIdempotencyKey`,
 * `resolveTrustFromLatestStatuses`, e as regras de Agência/Pessoa com o
 * campo `*PreviousDay`), que é exatamente o que decide o comportamento do
 * backfill; a garantia de "nunca duplica no banco" em si (`ON CONFLICT ...
 * DO NOTHING`) é a mesma da RPC já usada em produção por
 * `complete_task_and_record_event`, não uma peça nova.
 *
 * Rodar: npx tsx scripts/test-achievement-backfill.ts
 */
import assert from "node:assert/strict";
import { addDays, lastNClosedDaysEndingYesterday } from "../src/lib/achievement-dates";
import { resolveTrustFromLatestStatuses } from "../src/lib/achievement-metrics";
import { buildIdempotencyKey } from "../src/lib/achievement-engine";
import { BACKFILL_WINDOW_DAYS } from "./backfill-achievements";
import {
  ruleAgencyActiveClientsMilestone,
  ruleAgencyMediaScaleMilestone,
  ruleAgencyReviewsMilestone,
  AGENCY_BACKFILL_SAFE_RULES,
  type AgencyAchievementContext,
} from "../src/lib/achievement-agency-rules";
import { rulePersonReviewsMilestone, type PersonAchievementContext } from "../src/lib/achievement-person-rules";
import {
  ruleConsistencyCpaBelowTarget,
  ruleRecordBestCpaWeek,
  type ClientAchievementContext,
  type ClientMonthlyGoalInfo,
} from "../src/lib/achievement-client-rules";
import type { ClientDailyPoint } from "../src/lib/achievement-sample";
import type { AchievementCandidate } from "../src/lib/achievement-types";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, cond: boolean) {
  assert.ok(cond, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function point(date: string, opts: Partial<ClientDailyPoint> & { spend?: number; resultCount?: number }): ClientDailyPoint {
  return { date, dataPresent: true, spend: 0, resultCount: 0, revenue: null, ...opts };
}
function healthyRange(from: string, to: string, spend: number, resultCount: number): ClientDailyPoint[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates.map((d) => point(d, { spend, resultCount }));
}
function makeGoal(targetCostPerResult: number | null): ClientMonthlyGoalInfo {
  return { targetCostPerResult, targetResultCount: null, scopeComparable: true };
}
function makeClientContext(overrides: Partial<ClientAchievementContext> & { yesterday: string; dailyPoints: ClientDailyPoint[] }): ClientAchievementContext {
  return { clientId: "client-1", clientName: "Pet Fast", performanceGoal: "leads", tracksRevenue: false, goalByMonth: new Map(), sourceInfo: null, ...overrides };
}

// ---------------------------------------------------------------------------
// 1, 2, 10 — janela do backfill: exatamente 30 dias fechados, ordem
// cronológica, nunca inclui hoje.
// ---------------------------------------------------------------------------
console.log("\n1/2/10 — Janela do backfill\n");
{
  const today = "2026-08-20";
  const dates = lastNClosedDaysEndingYesterday(BACKFILL_WINDOW_DAYS, today);

  check("1 — processa exatamente 30 dias", dates.length, 30);
  check("1 — primeiro dia é 30 dias antes de ontem (21/07)", dates[0], "2026-07-21");
  check("1 — último dia é ontem (19/08), nunca hoje (20/08)", dates[dates.length - 1], "2026-08-19");
  ok("10 — hoje (20/08) nunca está na lista", !dates.includes(today));

  const sorted = [...dates].sort();
  check("2 — já vem em ordem cronológica crescente (mais antigo primeiro)", dates, sorted);
}

// ---------------------------------------------------------------------------
// 3 — rerun não duplica: a chave de idempotência é 100% determinística a
// partir do candidato — processar o mesmo dia (ou os 30 dias) de novo
// sempre produz a MESMA chave, que o banco já rejeita via
// `ON CONFLICT ... DO NOTHING` (mesmo mecanismo de sempre).
// ---------------------------------------------------------------------------
console.log("\n3 — Idempotência determinística\n");
{
  const candidate: AchievementCandidate = {
    type: "client_consistency_cpa_below_target",
    scope: "client",
    family: "consistencia",
    severity: "highlight",
    occurredOnDate: "2026-08-05",
    windowKey: "consistency_cpa:2026-07-30:7",
    clientId: "client-1",
    clientName: "Pet Fast",
    metric: { metric: "cpa", actual: 20, unit: "currency" },
    headline: "x",
    detail: "y",
  };

  const key1 = buildIdempotencyKey(candidate, "org-1");
  const key2 = buildIdempotencyKey(candidate, "org-1");
  check("3 — mesmo candidato produz a mesma chave em execuções diferentes", key1, key2);
  ok("3 — a chave não depende de quando é calculada, só do conteúdo do candidato", key1 === key2);
}

// ---------------------------------------------------------------------------
// 4 — recorde usa histórico ANTERIOR à janela como baseline (reaproveita a
// mesma regra já coberta em test-achievement-engine.ts, aqui explicitamente
// no cenário de backfill: o baseline vem de fora da janela de 30 dias).
// ---------------------------------------------------------------------------
console.log("\n4 — Recorde usa baseline anterior à janela do backfill\n");
{
  // "Hoje" é 2026-08-20 -> janela de backfill é 21/07-19/08. Baseline
  // (CPA 20) fica em junho, MUITO antes da janela — exatamente o cenário
  // do exemplo do pedido ("histórico anterior tinha mínimo R$20").
  const evaluationDate = "2026-08-05"; // dentro da janela de backfill
  const baseline = healthyRange("2026-06-01", "2026-07-20", 200, 10); // CPA 20, fora da janela
  const recordWeek = healthyRange(addDays(evaluationDate, -6), evaluationDate, 90, 10); // CPA 9 — novo recorde
  const ctx = makeClientContext({ yesterday: evaluationDate, dailyPoints: [...baseline, ...recordWeek] });

  const candidate = ruleRecordBestCpaWeek(ctx);
  ok("4 — recorde detectado usando baseline de FORA da janela de 30 dias", candidate !== null);
  check("4 — comparação usa o CPA 20 do baseline anterior (não um universo vazio)", candidate?.metric.comparisonActual, 20);
}

// ---------------------------------------------------------------------------
// 5 — streak funciona atravessando a fronteira da janela de 30 dias: uma
// sequência que começou ANTES do primeiro dia da janela continua sendo
// contada corretamente quando avaliada num dia DENTRO da janela.
// ---------------------------------------------------------------------------
console.log("\n5 — Streak atravessa a fronteira da janela do backfill\n");
{
  const TARGET = 30;
  const windowStart = "2026-07-21"; // primeiro dia de uma janela de 30 dias hipotética

  // A sequência começou 5 dias ANTES do início da janela de backfill — o
  // patamar de 7 dias é cruzado no 2º dia DENTRO da janela (16/07 a 22/07
  // = 7 dias de mídia), não no dia em que o backfill "começaria a contar"
  // do zero. `evaluationDate` é exatamente esse dia de cruzamento.
  const streakStart = addDays(windowStart, -5);
  const evaluationDate = addDays(streakStart, 6); // 2026-07-22, dentro da janela (windowStart + 1)
  const dailyPoints = healthyRange(streakStart, evaluationDate, 100, 5); // CPA 20, dentro da meta o tempo todo
  const goalByMonth = new Map([[evaluationDate.slice(0, 7), makeGoal(TARGET)]]);
  const ctx = makeClientContext({ yesterday: evaluationDate, dailyPoints, goalByMonth });

  const candidate = ruleConsistencyCpaBelowTarget(ctx);
  ok("5 — sequência iniciada antes da janela de backfill é reconhecida corretamente dentro dela", candidate !== null);
  check(
    "5 — windowKey usa o início REAL da sequência (anterior ao início da janela), não a data em que o backfill começou a olhar",
    candidate?.windowKey,
    `consistency_cpa:${streakStart}:7`,
  );
}

// ---------------------------------------------------------------------------
// 6 — sync inválido pula o dia: a decisão pura de frescor (determinação de
// aprovação nº3) nunca libera avaliação sem `success`/`empty`.
// ---------------------------------------------------------------------------
console.log("\n6 — Sync inválido bloqueia a avaliação daquele cliente\n");
{
  check("6 — success libera", resolveTrustFromLatestStatuses(1, ["success"]), { trusted: true, reason: "success" });
  // `empty` também libera (zero real de investimento/resultado é dado
  // confiável, não falha) — o rótulo interno continua "success" pros dois
  // casos (decisão original da implementação: o que importa é `trusted`,
  // nunca distinguir success/empty na leitura de quem chama).
  check("6 — empty libera (zero real, não falha)", resolveTrustFromLatestStatuses(1, ["empty"]), { trusted: true, reason: "success" });
  check("6 — partial bloqueia (determinação nº3)", resolveTrustFromLatestStatuses(1, ["partial"]), { trusted: false, reason: "partial" });
  check("6 — failed bloqueia", resolveTrustFromLatestStatuses(1, ["failed"]), { trusted: false, reason: "failed" });
  check("6 — running (sync em andamento) bloqueia", resolveTrustFromLatestStatuses(1, ["running"]), { trusted: false, reason: "running" });
  check("6 — sem nenhum run ainda bloqueia", resolveTrustFromLatestStatuses(1, []), { trusted: false, reason: "no_run_yet" });
  check("6 — sem fonte ativa nenhuma bloqueia", resolveTrustFromLatestStatuses(0, []), { trusted: false, reason: "no_active_source" });
  // "Meta entrou, Google não entrou": 1 das 2 fontes com sucesso, a outra
  // partial — o pior status entre as fontes ativas vence, consolidado
  // inteiro invalidado.
  check("6 — uma fonte partial invalida o cliente mesmo com outra em success", resolveTrustFromLatestStatuses(2, ["success", "partial"]), {
    trusted: false,
    reason: "partial",
  });
}

// ---------------------------------------------------------------------------
// 7 — milestone de PESSOA já atingido ANTES da janela não é recriado.
// ---------------------------------------------------------------------------
console.log("\n7 — Milestone de Pessoa já atingido antes da janela não é recriado\n");
{
  function personCtx(overrides: Partial<PersonAchievementContext>): PersonAchievementContext {
    return {
      teamMemberId: "person-1",
      teamMemberName: "Filipe",
      evaluatedOnDate: "2026-08-05",
      reviewsCount: 100,
      reviewsCountPreviousDay: 100,
      optimizationsCount: 0,
      optimizationsCountPreviousDay: 0,
      distinctClientsServedCount: 0,
      distinctClientsServedCountPreviousDay: 0,
      reportsSentCount: 0,
      reportsSentCountPreviousDay: 0,
      tenureMonths: 0,
      tenureMonthsPreviousDay: 0,
      firstMeetingCompleted: false,
      firstCreativeDeliveryCompleted: false,
      ...overrides,
    };
  }

  // Já tinha 100 revisões ANTES do primeiro dia da janela (contagem de
  // ontem, relativa a esse dia, também já é 100 — nada mudou hoje).
  const alreadyCrossed = personCtx({ reviewsCount: 100, reviewsCountPreviousDay: 100 });
  check("7 — 100 revisões já atingidas antes da janela não geram conquista artificial hoje", rulePersonReviewsMilestone(alreadyCrossed), null);
}

// ---------------------------------------------------------------------------
// 8 — milestone de AGÊNCIA já atingido antes da janela não é recriado.
// ---------------------------------------------------------------------------
console.log("\n8 — Milestone de Agência já atingido antes da janela não é recriado\n");
{
  function agencyCtx(overrides: Partial<AgencyAchievementContext>): AgencyAchievementContext {
    return {
      organizationId: "org-1",
      evaluatedOnDate: "2026-08-05",
      activeClientsCount: 0,
      healthyWalletFraction: null,
      noCriticalWallet: false,
      totalReviewsCount: 100,
      totalReviewsCountPreviousDay: 100,
      totalOptimizationsCount: 0,
      totalOptimizationsCountPreviousDay: 0,
      totalReportsSentCount: 0,
      totalReportsSentCountPreviousDay: 0,
      closedMonthTotalSpend: null,
      ...overrides,
    };
  }

  const alreadyCrossed = agencyCtx({ totalReviewsCount: 100, totalReviewsCountPreviousDay: 100 });
  check("8 — 100 revisões já atingidas antes da janela não geram conquista artificial hoje", ruleAgencyReviewsMilestone(alreadyCrossed), null);

  check("8 — subconjunto seguro do backfill tem exatamente 3 regras de Agência", AGENCY_BACKFILL_SAFE_RULES.length, 3);
  ok("8 — regra cumulativa (com guarda de cruzamento) está no subconjunto seguro", AGENCY_BACKFILL_SAFE_RULES.includes(ruleAgencyReviewsMilestone));
  ok(
    "8 — regra sem histórico de estado (clients.status atual) está EXCLUÍDA do backfill",
    !AGENCY_BACKFILL_SAFE_RULES.includes(ruleAgencyActiveClientsMilestone),
  );
  ok(
    "8 — regra de escala de mídia (precisaria comparar contra todo mês fechado anterior) está EXCLUÍDA do backfill",
    !AGENCY_BACKFILL_SAFE_RULES.includes(ruleAgencyMediaScaleMilestone),
  );
}

// ---------------------------------------------------------------------------
// 9 — threshold CRUZADO dentro da janela é criado normalmente (contraste
// direto com 7/8: a única diferença é a contagem de ontem estar ABAIXO do
// patamar).
// ---------------------------------------------------------------------------
console.log("\n9 — Threshold cruzado dentro da janela é criado\n");
{
  function personCtx(overrides: Partial<PersonAchievementContext>): PersonAchievementContext {
    return {
      teamMemberId: "person-1",
      teamMemberName: "Filipe",
      evaluatedOnDate: "2026-08-05",
      reviewsCount: 0,
      reviewsCountPreviousDay: 0,
      optimizationsCount: 0,
      optimizationsCountPreviousDay: 0,
      distinctClientsServedCount: 0,
      distinctClientsServedCountPreviousDay: 0,
      reportsSentCount: 0,
      reportsSentCountPreviousDay: 0,
      tenureMonths: 0,
      tenureMonthsPreviousDay: 0,
      firstMeetingCompleted: false,
      firstCreativeDeliveryCompleted: false,
      ...overrides,
    };
  }

  // Ontem 99 revisões (abaixo de 100), hoje 100 — cruzamento genuíno
  // acontecendo DENTRO do dia avaliado pelo backfill.
  const justCrossed = personCtx({ reviewsCount: 100, reviewsCountPreviousDay: 99 });
  const candidate = rulePersonReviewsMilestone(justCrossed);
  ok("9 — cruzamento genuíno dentro da janela gera a conquista", candidate !== null);
  check("9 — patamar correto (100)", candidate?.windowKey, "reviews:100");

  function agencyCtx(overrides: Partial<AgencyAchievementContext>): AgencyAchievementContext {
    return {
      organizationId: "org-1",
      evaluatedOnDate: "2026-08-05",
      activeClientsCount: 0,
      healthyWalletFraction: null,
      noCriticalWallet: false,
      totalReviewsCount: 0,
      totalReviewsCountPreviousDay: 0,
      totalOptimizationsCount: 0,
      totalOptimizationsCountPreviousDay: 0,
      totalReportsSentCount: 0,
      totalReportsSentCountPreviousDay: 0,
      closedMonthTotalSpend: null,
      ...overrides,
    };
  }
  const agencyJustCrossed = agencyCtx({ totalReviewsCount: 100, totalReviewsCountPreviousDay: 99 });
  ok("9 — mesmo cruzamento genuíno pro lado Agência", ruleAgencyReviewsMilestone(agencyJustCrossed) !== null);
}

console.log(`\n${passed} verificações passaram.`);
