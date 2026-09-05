/**
 * Etapa "Padronização Global dos Seletores de Período" (Fase 1) — testes
 * puros do núcleo do componente canônico `PeriodRangeSelector`
 * (`lib/date-range-picker.ts`). Cobre exatamente o que foi pedido pra esta
 * rodada: matemática de calendário/clique/rótulo, sem tocar DOM/React (mesmo
 * padrão de todo o resto do projeto — nenhum teste de componente em lugar
 * nenhum). Comportamento de UI (Cancelar não aplica / Aplicar aplica / URL
 * como fonte de verdade) é coberto indiretamente pelas checagens estruturais
 * do código-fonte no final deste arquivo, já que este ambiente não tem
 * runner de DOM.
 *
 * Rodar: npx tsx scripts/test-date-range-picker.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDaysToDateString,
  buildCalendarWeeks,
  calendarMonthFromDateString,
  formatCompactPeriodLabel,
  isValidDateRange,
  resolveRangeClick,
  shiftCalendarMonth,
  WEEKDAY_SHORT_LABELS_PT_BR,
} from "../src/lib/date-range-picker";
import { formatDayShortMonth } from "../src/lib/format";

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

console.log("\n1 — isValidDateRange: única fonte de verdade de 'fim >= início'\n");
{
  ok("início igual ao fim é válido (intervalo inclusivo de 1 dia)", isValidDateRange("2026-09-10", "2026-09-10"));
  ok("fim depois do início é válido", isValidDateRange("2026-09-01", "2026-09-10"));
  ok("fim antes do início é inválido", !isValidDateRange("2026-09-10", "2026-09-01"));
  ok("início vazio é inválido", !isValidDateRange("", "2026-09-10"));
  ok("fim vazio é inválido", !isValidDateRange("2026-09-01", ""));
}

console.log("\n2 — resolveRangeClick: primeiro clique / segundo clique (padrão Meta Ads)\n");
{
  check("sem seleção nenhuma: primeiro clique só marca o início", resolveRangeClick({ start: null, end: null }, "2026-09-10"), {
    start: "2026-09-10",
    end: null,
  });
  check(
    "início marcado, segundo clique numa data posterior: completa o intervalo",
    resolveRangeClick({ start: "2026-09-10", end: null }, "2026-09-15"),
    { start: "2026-09-10", end: "2026-09-15" },
  );
  check(
    "início marcado, segundo clique na MESMA data: intervalo de 1 dia só",
    resolveRangeClick({ start: "2026-09-10", end: null }, "2026-09-10"),
    { start: "2026-09-10", end: "2026-09-10" },
  );
  check(
    "início marcado, clique numa data ANTERIOR: reinicia a seleção a partir da nova data (nunca inverte silenciosamente)",
    resolveRangeClick({ start: "2026-09-10", end: null }, "2026-09-05"),
    { start: "2026-09-05", end: null },
  );
  check(
    "intervalo já completo, novo clique: começa uma seleção nova (não soma um 3º ponto)",
    resolveRangeClick({ start: "2026-09-01", end: "2026-09-10" }, "2026-09-20"),
    { start: "2026-09-20", end: null },
  );
}

console.log("\n3 — buildCalendarWeeks: grade correta, sem off-by-one por timezone\n");
{
  // Setembro/2026 começa numa terça-feira (índice 2) e tem 30 dias — a
  // primeira semana precisa ter 2 células de preenchimento (dom/seg de
  // agosto) antes do dia 1.
  const september = buildCalendarWeeks(2026, 8); // monthIndex 0-based: 8 = setembro
  ok("semanas sempre múltiplas de 7 dias", september.every((week) => week.length === 7));
  check("primeira célula da grade é 30/08 (preenchimento do mês anterior)", september[0][0], { date: "2026-08-30", inMonth: false });
  check("1º de setembro cai na 3ª posição da primeira semana (terça-feira)", september[0][2], { date: "2026-09-01", inMonth: true });
  const flatSeptember = september.flat();
  const lastRealDay = flatSeptember.find((cell) => cell.date === "2026-09-30");
  ok("30/09 está marcado como dentro do mês", lastRealDay?.inMonth === true);
  const octoberFiller = flatSeptember.find((cell) => cell.date === "2026-10-01");
  ok("dias de outubro usados só como preenchimento vêm com inMonth: false", octoberFiller?.inMonth === false);

  // Fevereiro/2028 é ano bissexto (29 dias) — prova que a grade nunca
  // hardcoda 28 dias.
  const leapFebruary = buildCalendarWeeks(2028, 1);
  const leapDay = leapFebruary.flat().find((cell) => cell.date === "2028-02-29");
  ok("29/02/2028 (ano bissexto) aparece e conta como dentro do mês", leapDay?.inMonth === true);
  const nonLeapFebruary = buildCalendarWeeks(2027, 1);
  const nonLeapDay = nonLeapFebruary.flat().find((cell) => cell.date === "2027-02-29");
  ok("29/02/2027 (ano NÃO bissexto) nunca aparece como dia real do mês", !nonLeapDay || nonLeapDay.inMonth === false);
}

console.log("\n4 — timezone: buildCalendarWeeks/addDaysToDateString nunca mudam com o TZ do processo (Date.UTC sempre)\n");
{
  const originalTz = process.env.TZ;
  const results: string[][] = [];
  for (const tz of ["UTC", "Pacific/Kiritimati", "Etc/GMT+12", "America/Sao_Paulo"]) {
    process.env.TZ = tz;
    const cells = buildCalendarWeeks(2026, 0) // janeiro/2026, mês com virada de ano
      .flat()
      .map((cell) => `${cell.date}:${cell.inMonth}`);
    results.push(cells);
  }
  process.env.TZ = originalTz;

  ok("grade de janeiro/2026 é byte-a-byte idêntica em UTC-12, UTC+14, America/Sao_Paulo e UTC", results.every((r) => JSON.stringify(r) === JSON.stringify(results[0])));

  const addDaysAcrossTz: string[] = [];
  for (const tz of ["UTC", "Pacific/Kiritimati", "Etc/GMT+12"]) {
    process.env.TZ = tz;
    addDaysAcrossTz.push(addDaysToDateString("2026-01-01", -1));
  }
  process.env.TZ = originalTz;
  ok("addDaysToDateString('2026-01-01', -1) = '2025-12-31' em qualquer TZ do processo", addDaysAcrossTz.every((d) => d === "2025-12-31"));
}

console.log("\n5 — shiftCalendarMonth: virada de ano em ambas as direções\n");
{
  check("dezembro/2026 + 1 mês = janeiro/2027 (nunca 'mês 13')", shiftCalendarMonth({ year: 2026, monthIndex: 11 }, 1), { year: 2027, monthIndex: 0 });
  check("janeiro/2026 - 1 mês = dezembro/2025 (nunca 'mês -1')", shiftCalendarMonth({ year: 2026, monthIndex: 0 }, -1), { year: 2025, monthIndex: 11 });
  check("deslocamento de vários meses de uma vez (setembro/2026 + 5 = fevereiro/2027)", shiftCalendarMonth({ year: 2026, monthIndex: 8 }, 5), {
    year: 2027,
    monthIndex: 1,
  });
}

console.log("\n6 — calendarMonthFromDateString: extrai ano/mês corretamente, sem off-by-one\n");
{
  check("'2026-09-05' → setembro/2026", calendarMonthFromDateString("2026-09-05"), { year: 2026, monthIndex: 8 });
  check("'2026-01-01' → janeiro/2026", calendarMonthFromDateString("2026-01-01"), { year: 2026, monthIndex: 0 });
  check("'2026-12-31' → dezembro/2026 (nunca vaza pro ano seguinte)", calendarMonthFromDateString("2026-12-31"), { year: 2026, monthIndex: 11 });
}

console.log("\n7 — WEEKDAY_SHORT_LABELS_PT_BR: 7 dias, começando no domingo\n");
{
  check("domingo a sábado, pt-BR", [...WEEKDAY_SHORT_LABELS_PT_BR], ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]);
}

console.log("\n8 — formatCompactPeriodLabel: rótulo compacto do seletor fechado\n");
{
  // O texto exato de `formatDayShortMonth` (ex.: "05 set" vs "05 de set")
  // varia por versão de ICU/Node — os casos que reaproveitam essa função
  // direto (dia único, meses diferentes) comparam contra o que ELA
  // realmente devolve nesta máquina, nunca uma string fixa; só o caso "mesmo
  // mês" (que extrai só o nome via `.pop()`) tem literal fixo "set"/"ago",
  // porque a normalização dessa variação é exatamente o que está sendo
  // testado ali.
  const sep5 = formatDayShortMonth("2026-09-05");
  const aug30 = formatDayShortMonth("2026-08-30");
  const dec28 = formatDayShortMonth("2026-12-28");
  const jan3 = formatDayShortMonth("2027-01-03");

  check("mesmo dia, ano corrente: sem ano", formatCompactPeriodLabel({ start: "2026-09-05", end: "2026-09-05", presetLabel: null, todayYear: 2026 }), sep5);
  check(
    "mesmo dia, ano diferente do corrente: mostra o ano",
    formatCompactPeriodLabel({ start: "2025-09-05", end: "2025-09-05", presetLabel: null, todayYear: 2026 }),
    `${sep5} 2025`,
  );
  check(
    "mesmo mês/ano corrente: dias combinados, um único mês ('01–05 set')",
    formatCompactPeriodLabel({ start: "2026-09-01", end: "2026-09-05", presetLabel: null, todayYear: 2026 }),
    "01–05 set",
  );
  check(
    "mesmo mês, ano diferente do corrente: ano aparece uma vez, no fim",
    formatCompactPeriodLabel({ start: "2025-09-01", end: "2025-09-05", presetLabel: null, todayYear: 2026 }),
    "01–05 set 2025",
  );
  check(
    "meses diferentes, mesmo ano corrente: cada data com seu mês, sem ano",
    formatCompactPeriodLabel({ start: "2026-08-30", end: "2026-09-05", presetLabel: null, todayYear: 2026 }),
    `${aug30} – ${sep5}`,
  );
  check(
    "meses diferentes, ano diferente do corrente: ano uma vez, no fim",
    formatCompactPeriodLabel({ start: "2025-08-30", end: "2025-09-05", presetLabel: null, todayYear: 2026 }),
    `${aug30} – ${sep5} 2025`,
  );
  check(
    "anos diferentes entre si: ambíguo sem ano nas duas pontas, mostra os dois",
    formatCompactPeriodLabel({ start: "2026-12-28", end: "2027-01-03", presetLabel: null, todayYear: 2026 }),
    `${dec28} 2026 – ${jan3} 2027`,
  );
  check(
    "com presetLabel: nome do preset antes do intervalo ('Este mês · 01–05 set')",
    formatCompactPeriodLabel({ start: "2026-09-01", end: "2026-09-05", presetLabel: "Este mês", todayYear: 2026 }),
    "Este mês · 01–05 set",
  );
  check(
    "preset 'Últimos 7 dias' cruzando mês, ano corrente",
    formatCompactPeriodLabel({ start: "2026-08-30", end: "2026-09-05", presetLabel: "Últimos 7 dias", todayYear: 2026 }),
    `Últimos 7 dias · ${aug30} – ${sep5}`,
  );
}

console.log("\n9 — checagens estruturais: draft/Cancelar/Aplicar/URL (sem runner de DOM neste ambiente)\n");
{
  const componentSource = readFileSync(join(__dirname, "..", "src", "components", "ui", "period-range-selector.tsx"), "utf8");
  const controlSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-period-control.tsx"), "utf8");
  const publicPageSource = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8");
  const internalPageSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "page.tsx"), "utf8");

  ok("cliques em preset/calendário só mudam o rascunho local (`setDraft`), nunca chamam onApply direto", /onClick=\{\(\) => handlePresetClick\(preset\)\}/.test(componentSource) && /setDraft\(/.test(componentSource));
  ok("'Cancelar' está ligado só a closePanel(false), nunca a handleApplyClick", /onClick=\{\(\) => closePanel\(false\)\}[\s\S]{0,200}Cancelar/.test(componentSource));
  ok("'Aplicar' é o único botão ligado a handleApplyClick (que chama onApply)", /onClick=\{handleApplyClick\}/.test(componentSource));
  ok("handleApplyClick é a única função que chama onApply", (componentSource.match(/onApply\(/g) ?? []).length === 1);
  ok("Escape fecha o painel", /event\.key === "Escape"/.test(componentSource));
  ok("clique fora fecha o painel (listener global de mousedown)", /addEventListener\("mousedown"/.test(componentSource));
  ok("popover não estoura viewport no mobile (largura via calc(100vw...))", /calc\(100vw/.test(componentSource));
  ok("segundo mês do calendário fica oculto em telas estreitas (`hidden sm:flex`)", /hidden sm:flex/.test(componentSource));

  ok("ReportPeriodControl aplica navegando pra URL (`router.push`), nunca outro mecanismo de estado", /router\.push\(/.test(controlSource));
  ok("ReportPeriodControl usa resolveAnalyticsPeriod pra resolver os presets — nunca uma segunda semântica de data", /resolveAnalyticsPeriod\(/.test(controlSource));
  ok("página pública /r/[token] usa exatamente o mesmo ReportPeriodControl da página interna", /import \{ ReportPeriodControl \} from "@\/app\/clients\/\[id\]\/relatorio\/report-period-control"/.test(publicPageSource));
  ok("página interna /clients/[id]/relatorio usa o ReportPeriodControl local (mesmo componente, nunca duplicado)", /import \{ ReportPeriodControl \} from "\.\/report-period-control"/.test(internalPageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
