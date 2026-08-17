/**
 * Testes de "Evolução diária de resultados" (Visão Geral do cliente) —
 * cobre os cenários A-F pedidos explicitamente: série normal, dia sem
 * registro (deve virar 0, nunca ser omitido), multicanal (Consolidado =
 * soma, Meta/Google isolados), janela de 7 dias contínua, índices
 * Hoje/Ontem/Média corretos, e ausência total de dado (nunca fabricar 7
 * zeros quando não há como confirmar sincronização).
 *
 * Rodar: npx tsx scripts/test-daily-results.ts
 */
import assert from "node:assert/strict";
import {
  lastNDaysEndingToday,
  buildDailyResultSeries,
  computeDailyResultStats,
  type DailyResultRawRow,
  type DailySpendRawRow,
} from "../src/lib/daily-results";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("lastNDaysEndingToday — janela de 7 dias contínua (Cenário D)\n");

{
  const window = lastNDaysEndingToday("2026-08-17", 7);
  check("7 datas", window.length, 7);
  check("termina em hoje", window[6], "2026-08-17");
  check("começa 6 dias antes", window[0], "2026-08-11");
  check("sequência contínua, sem buraco", window, ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"]);
}

{
  // Virada de mês — a janela deve atravessar o mês normalmente.
  const window = lastNDaysEndingToday("2026-08-02", 7);
  check("janela atravessa a virada do mês (jul->ago)", window, ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
}

console.log("\nbuildDailyResultSeries\n");

const WINDOW_3 = ["2026-08-10", "2026-08-11", "2026-08-12"];

// Cenário A — série normal: todo dia com registro, valores corretos por data.
{
  const performanceRows: DailyResultRawRow[] = [
    { date: "2026-08-10", channel: "meta", resultType: "leads", resultCount: 4 },
    { date: "2026-08-11", channel: "meta", resultType: "leads", resultCount: 2 },
    { date: "2026-08-12", channel: "meta", resultType: "leads", resultCount: 5 },
  ];
  const series = buildDailyResultSeries({
    windowDates: WINDOW_3,
    hasActiveIntegration: true,
    goal: "leads",
    scope: "consolidated",
    performanceRows,
    spendRows: [],
  });
  check(
    "Cenário A — série normal 4, 2, 5",
    series,
    { kind: "available", points: [{ date: "2026-08-10", resultCount: 4 }, { date: "2026-08-11", resultCount: 2 }, { date: "2026-08-12", resultCount: 5 }] },
  );
}

// Cenário B — dia sem registro, mas com spend sincronizado nesse dia: vira
// 0 explícito, nunca omitido (10/08=4, 11/08=sem registro, 12/08=5 -> 4,0,5).
{
  const performanceRows: DailyResultRawRow[] = [
    { date: "2026-08-10", channel: "meta", resultType: "leads", resultCount: 4 },
    { date: "2026-08-12", channel: "meta", resultType: "leads", resultCount: 5 },
  ];
  const spendRows: DailySpendRawRow[] = [
    { date: "2026-08-10", channel: "meta" },
    { date: "2026-08-11", channel: "meta" },
    { date: "2026-08-12", channel: "meta" },
  ];
  const series = buildDailyResultSeries({
    windowDates: WINDOW_3,
    hasActiveIntegration: true,
    goal: "leads",
    scope: "consolidated",
    performanceRows,
    spendRows,
  });
  check(
    "Cenário B — dia sem resultado mas sincronizado vira 0 real, nunca omitido (4, 0, 5)",
    series,
    { kind: "available", points: [{ date: "2026-08-10", resultCount: 4 }, { date: "2026-08-11", resultCount: 0 }, { date: "2026-08-12", resultCount: 5 }] },
  );
}

// Cenário C — multicanal: Meta 10/08=3, Google 10/08=2 -> Consolidado=5,
// Meta isolado=3, Google isolado=2.
{
  const performanceRows: DailyResultRawRow[] = [
    { date: "2026-08-10", channel: "meta", resultType: "leads", resultCount: 3 },
    { date: "2026-08-10", channel: "google", resultType: "leads", resultCount: 2 },
  ];
  const spendRows: DailySpendRawRow[] = [
    { date: "2026-08-10", channel: "meta" },
    { date: "2026-08-10", channel: "google" },
  ];
  const window1 = ["2026-08-10"];

  const consolidated = buildDailyResultSeries({ windowDates: window1, hasActiveIntegration: true, goal: "leads", scope: "consolidated", performanceRows, spendRows });
  const metaOnly = buildDailyResultSeries({ windowDates: window1, hasActiveIntegration: true, goal: "leads", scope: "meta", performanceRows, spendRows });
  const googleOnly = buildDailyResultSeries({ windowDates: window1, hasActiveIntegration: true, goal: "leads", scope: "google", performanceRows, spendRows });

  check("Cenário C — Consolidado = soma dos canais (5)", consolidated, { kind: "available", points: [{ date: "2026-08-10", resultCount: 5 }] });
  check("Cenário C — Meta isolado (3)", metaOnly, { kind: "available", points: [{ date: "2026-08-10", resultCount: 3 }] });
  check("Cenário C — Google isolado (2)", googleOnly, { kind: "available", points: [{ date: "2026-08-10", resultCount: 2 }] });
}

// Cenário E — índices de Hoje/Ontem/Média: janela [4,2,5,3,6,4,7] -> Hoje=7,
// Ontem=4, Média 7d = 31/7.
{
  const points = [4, 2, 5, 3, 6, 4, 7].map((resultCount, i) => ({ date: `2026-08-${10 + i}`, resultCount }));
  const stats = computeDailyResultStats(points);
  check("Cenário E — Hoje é o último ponto (7)", stats.today, 7);
  check("Cenário E — Ontem é o penúltimo ponto (4)", stats.yesterday, 4);
  check("Cenário E — Média 7d = soma/7", stats.average7d, 31 / 7);
}

// Cenário F — ausência total: sem integração ativa (cliente manual) nunca
// vira uma série de 7 zeros fabricados.
{
  const series = buildDailyResultSeries({
    windowDates: WINDOW_3,
    hasActiveIntegration: false,
    goal: "leads",
    scope: "consolidated",
    performanceRows: [],
    spendRows: [],
  });
  check("Cenário F — cliente sem integração ativa -> unavailable, nunca 7 zeros", series, { kind: "unavailable" });
}

// Cenário F (parte 2) — integração ativa mas sem NENHUM sinal de sync no
// período (ex.: integração conectada hoje, sem histórico pros 7 dias
// anteriores) -> ainda unavailable, nunca mistura dia real com dia
// inventado.
{
  const series = buildDailyResultSeries({
    windowDates: WINDOW_3,
    hasActiveIntegration: true,
    goal: "leads",
    scope: "consolidated",
    performanceRows: [],
    spendRows: [],
  });
  check("Cenário F — integração ativa mas nenhum dia sincronizado no período -> unavailable", series, { kind: "unavailable" });
}

// Cenário F (parte 3) — integração ativa, alguns dias confirmados e um dia
// sem NENHUM sinal (nem resultado, nem spend) -> a série inteira cai pra
// unavailable (nunca preenche o dia desconhecido com um 0 fabricado).
{
  const performanceRows: DailyResultRawRow[] = [
    { date: "2026-08-10", channel: "meta", resultType: "leads", resultCount: 4 },
    { date: "2026-08-12", channel: "meta", resultType: "leads", resultCount: 5 },
  ];
  const spendRows: DailySpendRawRow[] = [
    { date: "2026-08-10", channel: "meta" },
    { date: "2026-08-12", channel: "meta" },
  ]; // 11/08 sem nenhum sinal — nem resultado nem spend.
  const series = buildDailyResultSeries({
    windowDates: WINDOW_3,
    hasActiveIntegration: true,
    goal: "leads",
    scope: "consolidated",
    performanceRows,
    spendRows,
  });
  check("Cenário F — 1 dia sem nenhum sinal de sync -> série inteira unavailable, nunca 0 fabricado", series, { kind: "unavailable" });
}

console.log(`\n${passed} verificações passaram.`);
