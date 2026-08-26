/**
 * Testes do motor de Conquistas — cobre a lógica pura (`achievement-sample.ts`,
 * `achievement-dates.ts`, `achievement-client-rules.ts`), sem nenhum I/O.
 * Cenários pedidos na aprovação da Auditoria (seção 39, A-I) + as 4
 * determinações fechadas antes da implementação (amostra por janela,
 * recorde fechado × ritmo mensal, `partial` bloqueando, streak por dias
 * elegíveis).
 *
 * Rodar: npx tsx scripts/test-achievement-engine.ts
 */
import assert from "node:assert/strict";
import { addDays, daysElapsedInMonth, isLastDayOfMonth, lastDayOfMonth, listDatesInclusive, yearMonthOf } from "../src/lib/achievement-dates";
import {
  aggregateWindow,
  classifyStreakDay,
  dailyCpa,
  scanBackwardStreak,
  windowSampleIsValid,
  type ClientDailyPoint,
  type StreakDayState,
} from "../src/lib/achievement-sample";
import { DAILY_ELIGIBILITY_POLICY, WINDOW_SAMPLE_POLICY } from "../src/lib/achievement-thresholds";
import {
  CLIENT_RULES,
  ruleConsistencyCpaBelowTarget,
  ruleEvolutionCpaImproved,
  ruleEvolutionRoasGrowth,
  ruleGoalMonthlyResultReached,
  ruleRecordBestCpaWeek,
  ruleRecordBestMonthClosed,
  ruleRecordCurrentMonthPaceBeatsHistory,
  ruleRecoveryCpaBackWithinTarget,
  ruleScaleInvestmentGrowthWithEfficiency,
  type ClientAchievementContext,
  type ClientMonthlyGoalInfo,
} from "../src/lib/achievement-client-rules";

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

// ---------------------------------------------------------------------------
// Helpers de dados sintéticos
// ---------------------------------------------------------------------------

function point(date: string, opts: Partial<ClientDailyPoint> & { spend?: number; resultCount?: number }): ClientDailyPoint {
  return {
    date,
    dataPresent: true,
    spend: 0,
    resultCount: 0,
    revenue: null,
    ...opts,
  };
}

function missingPoint(date: string): ClientDailyPoint {
  return { date, dataPresent: false, spend: 0, resultCount: 0, revenue: null };
}

/** Gera pontos "saudáveis" (spend/result estáveis, CPA fixo) de `from` até
 * `to`, todos dentro de uma meta arbitrária — usado como base pra cenários
 * que só querem uma sequência longa "boa" sem pensar dia a dia. */
function healthyRange(from: string, to: string, spend: number, resultCount: number, revenue: number | null = null): ClientDailyPoint[] {
  return listDatesInclusive(from, to).map((d) => point(d, { spend, resultCount, revenue }));
}

function makeGoal(targetCostPerResult: number | null, targetResultCount: number | null = null, scopeComparable = true): ClientMonthlyGoalInfo {
  return { targetCostPerResult, targetResultCount, scopeComparable };
}

function makeContext(overrides: Partial<ClientAchievementContext> & { yesterday: string; dailyPoints: ClientDailyPoint[] }): ClientAchievementContext {
  return {
    clientId: "client-1",
    clientName: "Pet Fast",
    performanceGoal: "leads",
    tracksRevenue: false,
    goalByMonth: new Map(),
    sourceInfo: null,
    ...overrides,
  };
}

function goalMapForMonths(yesterday: string, goal: ClientMonthlyGoalInfo): Map<string, ClientMonthlyGoalInfo> {
  const map = new Map<string, ClientMonthlyGoalInfo>();
  map.set(yearMonthOf(yesterday), goal);
  map.set(yearMonthOf(addDays(yesterday, -35)), goal);
  return map;
}

// ---------------------------------------------------------------------------
// A — Recorde
// ---------------------------------------------------------------------------
console.log("\nA — Recorde\n");
{
  // Baseline: 60 dias de histórico com CPA=20 (spend 200/result 10), depois
  // uma semana final (ontem) com CPA=10 (novo recorde de verdade).
  const yesterday = "2026-03-31";
  const baseline = healthyRange(addDays(yesterday, -66), addDays(yesterday, -7), 200, 10); // CPA 20
  const recordWeek = healthyRange(addDays(yesterday, -6), yesterday, 100, 10); // CPA 10 — melhor
  const ctx = makeContext({ yesterday, dailyPoints: [...baseline, ...recordWeek] });

  const candidate = ruleRecordBestCpaWeek(ctx);
  ok("A1 — novo recorde verdadeiro de CPA é detectado", candidate !== null);
  check("A1 — severidade record", candidate?.severity, "record");
  check("A1 — windowKey determinística (baseada na data final)", candidate?.windowKey, `week_record:${yesterday}`);

  // Igual ao recorde anterior (mesmo CPA da melhor semana já vista) — não é
  // recorde novo, `better` exige estritamente menor.
  const tiedWeek = healthyRange(addDays(yesterday, -6), yesterday, 200, 10); // CPA 20, igual ao baseline
  const ctxTied = makeContext({ yesterday, dailyPoints: [...baseline, ...tiedWeek] });
  check("A2 — empatado com o recorde anterior não gera conquista", ruleRecordBestCpaWeek(ctxTied), null);

  // Pior que o recorde (CPA maior).
  const worseWeek = healthyRange(addDays(yesterday, -6), yesterday, 400, 10); // CPA 40
  const ctxWorse = makeContext({ yesterday, dailyPoints: [...baseline, ...worseWeek] });
  check("A3 — semana pior que o recorde não gera conquista", ruleRecordBestCpaWeek(ctxWorse), null);

  // Amostra insuficiente: poucos resultados/pouco investimento na semana.
  const tinyWeek = healthyRange(addDays(yesterday, -6), yesterday, 5, 1); // R$5, 1 resultado
  const ctxTiny = makeContext({ yesterday, dailyPoints: [...baseline, ...tinyWeek] });
  check("A4 — amostra insuficiente (R$5 + 1 resultado) nunca vira recorde", ruleRecordBestCpaWeek(ctxTiny), null);

  // Primeira janela válida da história — nunca é "recorde" (sem baseline real).
  const onlyRecordWeek = healthyRange(addDays(yesterday, -6), yesterday, 100, 10);
  const ctxFirstEver = makeContext({ yesterday, dailyPoints: onlyRecordWeek });
  check("A5 — primeira semana válida da história não é recorde (sem baseline pra bater)", ruleRecordBestCpaWeek(ctxFirstEver), null);
}

// ---------------------------------------------------------------------------
// A (mês) — Recorde de mês fechado × ritmo mensal (determinação nº2)
// ---------------------------------------------------------------------------
console.log("\nA (mês) — Recorde de mês fechado vs. mês em andamento\n");
{
  // Janeiro fechado: 310 resultados/dia * 31 = ... vamos usar valores
  // simples: 10 resultados/dia em jan (31 dias) = 310. Fevereiro (28 dias,
  // 2026 não é bissexto) com 8/dia = 224 (pior). Março com 15/dia até o dia
  // 20 = 300 (ainda não bate jan). Só até o dia 31 é que bate (10 alto).
  const jan = healthyRange("2026-01-01", "2026-01-31", 300, 10); // 31*10=310 resultados
  const feb = healthyRange("2026-02-01", "2026-02-28", 240, 8); // 28*8=224 resultados
  const marPartial = healthyRange("2026-03-01", "2026-03-20", 450, 15); // 20*15=300 < 310 (ainda não é recorde)

  const ctxMarNotYet = makeContext({ yesterday: "2026-03-20", dailyPoints: [...jan, ...feb, ...marPartial] });
  check("A-mês — mês em andamento ainda abaixo do recorde não dispara", ruleRecordCurrentMonthPaceBeatsHistory(ctxMarNotYet), null);

  // Dia 21: acumulado passa a 315 (> 310) — primeira vez que ultrapassa.
  const mar21 = [...marPartial, point("2026-03-21", { spend: 450, resultCount: 15 })];
  const ctxMar21 = makeContext({ yesterday: "2026-03-21", dailyPoints: [...jan, ...feb, ...mar21] });
  const paceCandidate = ruleRecordCurrentMonthPaceBeatsHistory(ctxMar21);
  ok("A-mês — mês em andamento que ACABA de superar o recorde de mês fechado dispara", paceCandidate !== null);
  check("A-mês — severidade highlight (não record — mês ainda não fechou)", paceCandidate?.severity, "highlight");

  // Dia 22: já tinha superado ontem — não repete.
  const mar22 = [...mar21, point("2026-03-22", { spend: 450, resultCount: 15 })];
  const ctxMar22 = makeContext({ yesterday: "2026-03-22", dailyPoints: [...jan, ...feb, ...mar22] });
  check("A-mês — não repete no dia seguinte (já tinha ultrapassado ontem)", ruleRecordCurrentMonthPaceBeatsHistory(ctxMar22), null);

  // Mês fechado (31/03): compara só contra meses FECHADOS anteriores
  // (jan/fev), nunca contra março parcial de antes.
  const marFull = healthyRange("2026-03-01", "2026-03-31", 450, 15); // 31*15=465, novo recorde de mês fechado
  const ctxMarClosed = makeContext({ yesterday: "2026-03-31", dailyPoints: [...jan, ...feb, ...marFull] });
  const closedCandidate = ruleRecordBestMonthClosed(ctxMarClosed);
  ok("A-mês — mês fechado que bate os meses fechados anteriores dispara (severidade record)", closedCandidate?.severity === "record");
  check("A-mês — não avalia recorde de mês fechado em dia que não é o último do mês", ruleRecordBestMonthClosed(ctxMar21), null);
}

// ---------------------------------------------------------------------------
// B — Meta mensal
// ---------------------------------------------------------------------------
console.log("\nB — Meta mensal\n");
{
  const yesterday = "2026-05-15";
  const target = makeGoal(null, 100); // meta de 100 resultados no mês
  const goalByMonth = goalMapForMonths(yesterday, target);

  // Exatamente na meta (100%).
  const exact = healthyRange("2026-05-01", yesterday, 50, 100 / 15); // ~6,67/dia * 15 dias ~ 100
  const ctxExact = makeContext({ yesterday, dailyPoints: exact, goalByMonth });
  const exactCandidate = ruleGoalMonthlyResultReached(ctxExact);
  ok("B1 — meta batida exatamente (100%) dispara", exactCandidate !== null);

  // Abaixo da meta — não dispara.
  const below = healthyRange("2026-05-01", yesterday, 50, 3); // 15*3=45 << 100
  const ctxBelow = makeContext({ yesterday, dailyPoints: below, goalByMonth });
  check("B2 — abaixo da meta não dispara", ruleGoalMonthlyResultReached(ctxBelow), null);

  // 125% — patamar maior, cruzado EXATAMENTE ontem (dias 1-14 somam só
  // 112 = 112%, ainda no patamar 1.0; o resultado de ontem sozinho empurra
  // o acumulado pra 152 = 152%, cruzando o patamar 1.25 pela primeira vez).
  const above125: ClientDailyPoint[] = [
    ...healthyRange("2026-05-01", addDays(yesterday, -1), 50, 8), // 14 dias * 8 = 112
    point(yesterday, { spend: 200, resultCount: 40 }), // total 152
  ];
  const ctxAbove = makeContext({ yesterday, dailyPoints: above125, goalByMonth });
  const above125Candidate = ruleGoalMonthlyResultReached(ctxAbove);
  ok("B3 — 125%+ da meta dispara no patamar maior", above125Candidate?.windowKey.endsWith(":1.25") ?? false);

  // Anti-spam: dia seguinte no MESMO patamar não duplica (mesma windowKey,
  // dedupe real acontece no banco via idempotency_key — aqui confirmamos
  // que a regra nem tenta de novo).
  const above125Day2 = [...above125, point(addDays(yesterday, 1), { spend: 50, resultCount: 9 })];
  const ctxAboveDay2 = makeContext({ yesterday: addDays(yesterday, 1), dailyPoints: above125Day2, goalByMonth });
  check("B4 — mesmo patamar no dia seguinte não gera novo candidato (anti-spam)", ruleGoalMonthlyResultReached(ctxAboveDay2), null);

  // Meta com alvo trivial (abaixo do piso) não gera conquista.
  const tinyTarget = makeGoal(null, 2);
  const ctxTinyTarget = makeContext({ yesterday, dailyPoints: exact, goalByMonth: goalMapForMonths(yesterday, tinyTarget) });
  check("B5 — alvo mensal menor que o piso mínimo não gera conquista", ruleGoalMonthlyResultReached(ctxTinyTarget), null);
}

// ---------------------------------------------------------------------------
// C — Consistência (streak) + determinação nº4 (dias elegíveis)
// ---------------------------------------------------------------------------
console.log("\nC — Consistência / streak por dias de mídia elegíveis\n");
{
  const TARGET = 30;
  const goal = makeGoal(TARGET);

  // 2 dias dentro — não atinge nem o menor patamar (7).
  const yesterday = "2026-06-10";
  const days2 = healthyRange(addDays(yesterday, -1), yesterday, 100, 5); // CPA 20 <= 30
  const ctx2 = makeContext({ yesterday, dailyPoints: days2, goalByMonth: goalMapForMonths(yesterday, goal) });
  check("C1 — 2 dias dentro da meta não atinge nenhum patamar da V1", ruleConsistencyCpaBelowTarget(ctx2), null);

  // Exatamente 7 dias — dispara o patamar de 7.
  const days7 = healthyRange(addDays(yesterday, -6), yesterday, 100, 5);
  const ctx7 = makeContext({ yesterday, dailyPoints: days7, goalByMonth: goalMapForMonths(yesterday, goal) });
  const c7 = ruleConsistencyCpaBelowTarget(ctx7);
  ok("C2 — exatamente 7 dias dispara o patamar de 7", c7 !== null);
  check("C2 — windowKey usa o início real da sequência + patamar", c7?.windowKey, `consistency_cpa:${addDays(yesterday, -6)}:7`);

  // Sequência quebrada por um dia "fora" da meta no meio — reinicia.
  const daysBroken: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -9), addDays(yesterday, -8), 100, 5), // 2 dias bons antigos
    point(addDays(yesterday, -7), { spend: 400, resultCount: 5 }), // CPA 80 — fora da meta, quebra
    ...healthyRange(addDays(yesterday, -6), yesterday, 100, 5), // 7 dias bons — sequência nova
  ];
  const ctxBroken = makeContext({ yesterday, dailyPoints: daysBroken, goalByMonth: goalMapForMonths(yesterday, goal) });
  const cBroken = ruleConsistencyCpaBelowTarget(ctxBroken);
  check("C3 — sequência quebrada reinicia a contagem (só os 7 dias após a quebra contam)", cBroken?.windowKey, `consistency_cpa:${addDays(yesterday, -6)}:7`);

  // Dia neutro (sem mídia relevante) no meio NÃO quebra nem conta — a
  // sequência "pula" o dia (determinação nº4).
  const daysWithNeutral: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -6), addDays(yesterday, -5), 100, 5), // 2 dias dentro
    point(addDays(yesterday, -4), { spend: 5, resultCount: 0 }), // neutro: gasto abaixo do piso diário
    ...healthyRange(addDays(yesterday, -3), yesterday, 100, 5), // mais 4 dias dentro = total 6 dias de mídia
  ];
  const ctxNeutral = makeContext({ yesterday, dailyPoints: daysWithNeutral, goalByMonth: goalMapForMonths(yesterday, goal) });
  const streakDaysForNeutral = daysWithNeutral.map((p) => ({
    date: p.date,
    state: classifyStreakDay({
      point: p,
      scopeComparable: true,
      target: TARGET,
      metricValue: dailyCpa,
      isWithinTarget: (v, t) => v <= t,
    }),
  }));
  const neutralScan = scanBackwardStreak(streakDaysForNeutral);
  check("C4 — dia neutro não quebra nem conta: 6 dias de mídia elegíveis (não 7 corridos, não 2)", neutralScan.currentLength, 6);
  check("C4 — ainda não atinge o patamar de 7 (só 6 dias de mídia)", ruleConsistencyCpaBelowTarget(ctxNeutral), null);

  // Dia sem sincronização confiável (dataPresent=false) QUEBRA a sequência
  // — diferente do dia neutro.
  const daysWithGap: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -9), addDays(yesterday, -8), 100, 5),
    missingPoint(addDays(yesterday, -7)), // sem dado — inválido, quebra
    ...healthyRange(addDays(yesterday, -6), yesterday, 100, 5),
  ];
  const streakDaysForGap = daysWithGap.map((p) => ({
    date: p.date,
    state: classifyStreakDay({
      point: p,
      scopeComparable: true,
      target: TARGET,
      metricValue: dailyCpa,
      isWithinTarget: (v, t) => v <= t,
    }),
  }));
  check("C5 — dia sem dado sincronizado é 'invalido' (quebra), não 'neutro'", streakDaysForGap.find((d) => d.date === addDays(yesterday, -7))?.state, "invalido");

  // Nova sequência futura: depois de quebrar, uma NOVA sequência de 7 tem
  // windowKey diferente (início diferente) — nunca colide com a anterior.
  const laterYesterday = addDays(yesterday, 20);
  const newSequence: ClientDailyPoint[] = [
    ...days7,
    point(addDays(yesterday, 1), { spend: 500, resultCount: 5 }), // quebra
    ...healthyRange(addDays(laterYesterday, -6), laterYesterday, 100, 5), // nova sequência de 7
  ];
  const ctxNewSeq = makeContext({ yesterday: laterYesterday, dailyPoints: newSequence, goalByMonth: goalMapForMonths(laterYesterday, goal) });
  const cNewSeq = ruleConsistencyCpaBelowTarget(ctxNewSeq);
  ok("C6 — nova sequência de 7 dias (após quebra) gera uma windowKey NOVA", cNewSeq !== null && cNewSeq.windowKey !== c7?.windowKey);
}

// ---------------------------------------------------------------------------
// D — Evolução
// ---------------------------------------------------------------------------
console.log("\nD — Evolução\n");
{
  const yesterday = "2026-07-20";

  // Períodos equivalentes + melhora de 20%+: 20 dias de histórico com CPA
  // 25, últimos 7 dias com CPA 19,75 (melhora de exatamente 21% — barata o
  // suficiente pra que o dia anterior, cuja janela de 7 dias ainda mistura
  // 1 dia antigo, fique abaixo dos 20% e não dispare de novo em D1b).
  const improved: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -20), addDays(yesterday, -7), 250, 10), // CPA 25
    ...healthyRange(addDays(yesterday, -6), yesterday, 197.5, 10), // CPA 19,75 (-21%)
  ];
  const ctxImproved = makeContext({ yesterday, dailyPoints: improved });
  const dImproved = ruleEvolutionCpaImproved(ctxImproved);
  ok("D1 — melhora de CPA >= 20% vs. 7 dias anteriores dispara", dImproved !== null);

  // Não repete no dia seguinte (mesma condição sustentada).
  const improvedDay2: ClientDailyPoint[] = [...improved, point(addDays(yesterday, 1), { spend: 197.5, resultCount: 10 })];
  const ctxImprovedDay2 = makeContext({ yesterday: addDays(yesterday, 1), dailyPoints: improvedDay2 });
  check("D1b — não repete no dia seguinte (só no dia do cruzamento)", ruleEvolutionCpaImproved(ctxImprovedDay2), null);

  // Piora — não dispara.
  const worsened: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -13), addDays(yesterday, -7), 150, 10), // CPA 15
    ...healthyRange(addDays(yesterday, -6), yesterday, 250, 10), // CPA 25 (pior)
  ];
  const ctxWorsened = makeContext({ yesterday, dailyPoints: worsened });
  check("D2 — CPA piorou — não dispara", ruleEvolutionCpaImproved(ctxWorsened), null);

  // Amostra insuficiente numa das duas pernas.
  const tinyPrevious: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -13), addDays(yesterday, -7), 5, 1), // amostra minúscula
    ...healthyRange(addDays(yesterday, -6), yesterday, 150, 10),
  ];
  const ctxTinyPrevious = makeContext({ yesterday, dailyPoints: tinyPrevious });
  check("D3 — amostra insuficiente na perna anterior invalida a comparação", ruleEvolutionCpaImproved(ctxTinyPrevious), null);

  // ROAS: cresceu >= 25% (histórico com folga antes do bloco antigo, mesma
  // razão do ajuste em D1 — crescimento barato o suficiente pra que a
  // janela do dia anterior, ainda diluída por 1 dia antigo, fique abaixo
  // dos 25% e não dispare de novo).
  const roasGrowth: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -20), addDays(yesterday, -7), 100, 10, 200), // ROAS 2
    ...healthyRange(addDays(yesterday, -6), yesterday, 100, 10, 252), // ROAS 2,52 (+26%)
  ];
  const ctxRoas = makeContext({ yesterday, dailyPoints: roasGrowth, tracksRevenue: true });
  ok("D4 — crescimento de ROAS >= 25% dispara (cliente com receita)", ruleEvolutionRoasGrowth(ctxRoas) !== null);

  const ctxRoasNoRevenue = makeContext({ yesterday, dailyPoints: roasGrowth, tracksRevenue: false });
  check("D5 — cliente sem receita rastreada nunca recebe conquista de ROAS", ruleEvolutionRoasGrowth(ctxRoasNoRevenue), null);
}

// ---------------------------------------------------------------------------
// E — Escala
// ---------------------------------------------------------------------------
console.log("\nE — Escala\n");
{
  const yesterday = "2026-08-10";
  const goal = makeGoal(30);
  const goalByMonth = goalMapForMonths(yesterday, goal);

  // Investimento sobe 22% mantendo CPA dentro da meta (histórico com folga
  // antes do bloco antigo, mesma razão do ajuste em D1 — crescimento
  // barato o suficiente pra que a janela do dia anterior, ainda diluída
  // por 1 dia antigo, fique abaixo dos 20% e não dispare de novo).
  const scaled: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -20), addDays(yesterday, -7), 100, 5), // spend 100/dia, CPA 20
    ...healthyRange(addDays(yesterday, -6), yesterday, 122, 5), // spend 122/dia (+22%), CPA 24,4 (ainda <= 30)
  ];
  const ctxScaled = makeContext({ yesterday, dailyPoints: scaled, goalByMonth });
  ok("E1 — investimento sobe mantendo eficiência dispara", ruleScaleInvestmentGrowthWithEfficiency(ctxScaled) !== null);

  // Investimento sobe, mas CPA deteriora pra fora da meta.
  const scaledBad: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -13), addDays(yesterday, -7), 100, 5), // CPA 20
    ...healthyRange(addDays(yesterday, -6), yesterday, 200, 4), // spend +100%, CPA 50 (> meta 30)
  ];
  const ctxScaledBad = makeContext({ yesterday, dailyPoints: scaledBad, goalByMonth });
  check("E2 — investimento sobe mas eficiência deteriora não dispara", ruleScaleInvestmentGrowthWithEfficiency(ctxScaledBad), null);

  // Eficiência melhora, mas SEM crescimento de investimento — não é escala.
  const noScale: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -13), addDays(yesterday, -7), 100, 5), // CPA 20
    ...healthyRange(addDays(yesterday, -6), yesterday, 100, 10), // mesmo spend, CPA 10 (melhora, mas não escalou)
  ];
  const ctxNoScale = makeContext({ yesterday, dailyPoints: noScale, goalByMonth });
  check("E3 — eficiência melhora sem crescer investimento não é 'escala'", ruleScaleInvestmentGrowthWithEfficiency(ctxNoScale), null);

  // Escala sem amostra suficiente.
  const scaleTiny: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -13), addDays(yesterday, -7), 5, 1),
    ...healthyRange(addDays(yesterday, -6), yesterday, 10, 1),
  ];
  const ctxScaleTiny = makeContext({ yesterday, dailyPoints: scaleTiny, goalByMonth });
  check("E4 — escala sem amostra suficiente não dispara", ruleScaleInvestmentGrowthWithEfficiency(ctxScaleTiny), null);
}

// ---------------------------------------------------------------------------
// F — Recuperação
// ---------------------------------------------------------------------------
console.log("\nF — Recuperação\n");
{
  const TARGET = 30;
  const goal = makeGoal(TARGET);

  // Estado ruim (6 dias fora) → confirmação (3 dias dentro) = recuperação.
  const yesterday = "2026-09-15";
  const recovered: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -20), addDays(yesterday, -9), 100, 5), // dias bons antigos (irrelevante)
    ...healthyRange(addDays(yesterday, -8), addDays(yesterday, -3), 400, 5), // 6 dias ruins: CPA 80
    ...healthyRange(addDays(yesterday, -2), yesterday, 100, 5), // 3 dias bons: CPA 20 — confirma
  ];
  const ctxRecovered = makeContext({ yesterday, dailyPoints: recovered, goalByMonth: goalMapForMonths(yesterday, goal) });
  const recoveredCandidate = ruleRecoveryCpaBackWithinTarget(ctxRecovered);
  ok("F1 — período ruim (6d) seguido de confirmação (3d) dispara recuperação", recoveredCandidate !== null);

  // Saudável → saudável (nunca ficou ruim) — não é recuperação.
  const alwaysHealthy = healthyRange(addDays(yesterday, -20), yesterday, 100, 5);
  const ctxAlwaysHealthy = makeContext({ yesterday, dailyPoints: alwaysHealthy, goalByMonth: goalMapForMonths(yesterday, goal) });
  check("F2 — sempre saudável não é recuperação (nada pra recuperar)", ruleRecoveryCpaBackWithinTarget(ctxAlwaysHealthy), null);

  // Oscilação de 1 dia ruim não conta como período ruim real.
  const oneDayBlip: ClientDailyPoint[] = [
    ...healthyRange(addDays(yesterday, -20), addDays(yesterday, -4), 100, 5),
    point(addDays(yesterday, -3), { spend: 400, resultCount: 5 }), // só 1 dia ruim
    ...healthyRange(addDays(yesterday, -2), yesterday, 100, 5),
  ];
  const ctxBlip = makeContext({ yesterday, dailyPoints: oneDayBlip, goalByMonth: goalMapForMonths(yesterday, goal) });
  check("F3 — oscilação de 1 dia não é tratada como recuperação", ruleRecoveryCpaBackWithinTarget(ctxBlip), null);

  // Recuperação sustentada: no dia seguinte à confirmação mínima, não
  // dispara de novo (mesma windowKey, mas a regra só emite no dia exato do
  // cruzamento).
  const recoveredDay2: ClientDailyPoint[] = [...recovered, point(addDays(yesterday, 1), { spend: 100, resultCount: 5 })];
  const ctxRecoveredDay2 = makeContext({ yesterday: addDays(yesterday, 1), dailyPoints: recoveredDay2, goalByMonth: goalMapForMonths(addDays(yesterday, 1), goal) });
  check("F4 — recuperação sustentada não dispara de novo no dia seguinte", ruleRecoveryCpaBackWithinTarget(ctxRecoveredDay2), null);
}

// ---------------------------------------------------------------------------
// G — Idempotência (determinismo da windowKey)
// ---------------------------------------------------------------------------
console.log("\nG — Idempotência\n");
{
  const yesterday = "2026-06-10";
  const goal = makeGoal(30);
  const days7 = healthyRange(addDays(yesterday, -6), yesterday, 100, 5);
  const ctx = makeContext({ yesterday, dailyPoints: days7, goalByMonth: goalMapForMonths(yesterday, goal) });

  const first = ruleConsistencyCpaBelowTarget(ctx);
  const second = ruleConsistencyCpaBelowTarget(ctx);
  check("G1 — processar duas vezes o mesmo estado produz a MESMA windowKey (dedupe real acontece no banco)", first?.windowKey, second?.windowKey);

  for (const rule of CLIENT_RULES) {
    const a = rule(ctx);
    const b = rule(ctx);
    ok(`G2 — regra "${rule.name}" é determinística (mesmo input -> mesmo resultado)`, JSON.stringify(a) === JSON.stringify(b));
  }
}

// ---------------------------------------------------------------------------
// H — Histórico / baseline (seção 30 — nunca retroagir)
// ---------------------------------------------------------------------------
console.log("\nH — Histórico / baseline\n");
{
  // Cliente cujo único dado é a própria semana avaliada — não há baseline
  // anterior, então nenhum recorde pode ser declarado (mesmo sendo,
  // isoladamente, um ótimo CPA).
  const yesterday = "2026-10-05";
  const onlyWeek = healthyRange(addDays(yesterday, -6), yesterday, 50, 10); // CPA 5, ótimo
  const ctx = makeContext({ yesterday, dailyPoints: onlyWeek });
  check("H1 — sem baseline histórico anterior, nenhuma conquista de recorde é criada", ruleRecordBestCpaWeek(ctx), null);
}

// ---------------------------------------------------------------------------
// I — Dados faltantes
// ---------------------------------------------------------------------------
console.log("\nI — Dados faltantes\n");
{
  const yesterday = "2026-11-01";

  // Sem meta configurada — Consistência/Recuperação/Escala não avaliam.
  const days7 = healthyRange(addDays(yesterday, -6), yesterday, 100, 5);
  const ctxNoGoal = makeContext({ yesterday, dailyPoints: days7, goalByMonth: new Map() });
  check("I1 — sem meta de CPA configurada, Consistência não dispara", ruleConsistencyCpaBelowTarget(ctxNoGoal), null);
  check("I1b — sem meta de CPA configurada, Recuperação não dispara", ruleRecoveryCpaBackWithinTarget(ctxNoGoal), null);

  // Escopo não comparável (determinação nº3, extensão pra escopo) —
  // trava como se não houvesse meta.
  const goalNotComparable = makeGoal(30, null, false);
  const ctxNotComparable = makeContext({ yesterday, dailyPoints: days7, goalByMonth: goalMapForMonths(yesterday, goalNotComparable) });
  check("I2 — escopo planejado×realizado não comparável trava Consistência", ruleConsistencyCpaBelowTarget(ctxNotComparable), null);

  // Sem spend — dia inválido pro streak (dataPresent controla isso, não
  // spend=0 isolado, que já é tratado como "neutro" acima).
  const missingDay = classifyStreakDay({
    point: missingPoint(yesterday),
    scopeComparable: true,
    target: 30,
    metricValue: dailyCpa,
    isWithinTarget: (v, t) => v <= t,
  });
  check("I3 — dia sem nenhuma linha de daily_spend/daily_performance é 'invalido'", missingDay, "invalido" as StreakDayState);

  // Sem revenue — ROAS não calculável, `aggregateWindow.revenue` fica null.
  const noRevenue = healthyRange(addDays(yesterday, -6), yesterday, 100, 5, null);
  const agg = aggregateWindow(noRevenue);
  check("I4 — sem revenue em nenhum dia, agregado tem revenue=null (nunca 0 fabricado)", agg.revenue, null);
  check("I4b — sem revenue, ROAS agregado é null", agg.roas, null);
}

// ---------------------------------------------------------------------------
// J — Timezone / virada de dia e mês
// ---------------------------------------------------------------------------
console.log("\nJ — Timezone / virada de dia e mês\n");
{
  check("J1 — 31/01 é o último dia de janeiro", isLastDayOfMonth("2026-01-31"), true);
  check("J2 — 28/02/2026 é o último dia de fevereiro (2026 não é bissexto)", isLastDayOfMonth("2026-02-28"), true);
  check("J3 — 15/03 não é o último dia do mês", isLastDayOfMonth("2026-03-15"), false);
  check("J4 — 15 de março: 15 dias decorridos no mês", daysElapsedInMonth("2026-03-15"), 15);
  check("J5 — último dia de fevereiro/2026 (calendário correto, não hardcoded 30)", lastDayOfMonth("2026-02-10"), "2026-02-28");
  check("J6 — último dia de fevereiro/2028 (bissexto)", lastDayOfMonth("2028-02-10"), "2028-02-29");
}

// ---------------------------------------------------------------------------
// Amostra de janela — política nomeada (determinação nº1)
// ---------------------------------------------------------------------------
console.log("\nAmostra de janela por política nomeada\n");
{
  const weekPoints = healthyRange("2026-01-01", "2026-01-07", 30, 5); // spend 210, result 35 — passa fácil
  const weekAgg = aggregateWindow(weekPoints);
  ok("Amostra — semana com volume normal passa na política 'week'", windowSampleIsValid(weekAgg, WINDOW_SAMPLE_POLICY.week));

  const tinyWeekPoints = healthyRange("2026-01-01", "2026-01-07", 2, 1); // spend 14, result 7 — abaixo do piso de spend
  const tinyAgg = aggregateWindow(tinyWeekPoints);
  ok("Amostra — semana com investimento mínimo (R$14) não passa na política 'week'", !windowSampleIsValid(tinyAgg, WINDOW_SAMPLE_POLICY.week));

  // Piso diário do classificador de streak é DELIBERADAMENTE menor que o
  // piso de janela — não são a mesma política (determinação nº1).
  ok("Amostra — piso diário de streak é menor que o piso mínimo de investimento semanal", DAILY_ELIGIBILITY_POLICY.minSpend < WINDOW_SAMPLE_POLICY.week.minSpend);
}

console.log(`\n${passed} verificações passaram.`);
