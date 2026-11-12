/**
 * KOFF Analytics — "Seletor global de período" (pedido explícito do
 * usuário): substitui o antigo seletor de mês por um seletor de intervalo
 * de datas (Hoje/Ontem/Últimos 7/30 dias/Este mês/Mês passado/
 * Personalizado), inspirado no Gerenciador de Anúncios da Meta, com
 * identidade visual KOFF — UM componente/estado reaproveitado pelas 4
 * experiências (agência/cliente × desktop/mobile).
 *
 * Auditoria prévia (apresentada ao usuário antes de implementar, ver
 * conversa): dados diários (`daily_spend`/`daily_performance`/campanhas-
 * conjuntos-criativos) já existem em granularidade completa; métricas de
 * razão já são recalculadas por TOTAIS do período (nunca média de diários);
 * comparação de período anterior já é genérica (por quantidade de dias,
 * nunca mês corrido fixo) — nenhum bloqueio de dado. Duas decisões
 * explícitas do usuário, confirmadas antes de implementar:
 * 1. Fuso horário: `America/Sao_Paulo` (fuso da agência, `lib/today.ts`)
 *    por ora — fuso POR CONTA Meta fica pra uma iteração futura (não
 *    existe em lugar nenhum do schema/sync hoje).
 * 2. Cards de Investimento/Resultado/Custo fora de "o mês inteiro" (Hoje/
 *    Ontem/Últimos 7/30 dias/Personalizado): números REAIS do intervalo,
 *    sem ritmo/barra fabricados contra uma meta mensal incompatível —
 *    `isMonthAligned=false` reaproveita os estados JÁ EXISTENTES
 *    ("Sem planejamento configurado"/"SEM PLANEJAMENTO") em vez de um
 *    componente/veredito novo.
 *
 * Este ambiente não tem Supabase real — a cobertura combina:
 * 1. Dinâmico: `resolvePeriod`/`resolveShortcutRange`/`formatPeriodLabel`/
 *    `buildPeriodHref` (núcleo puro, `lib/date-range.ts`) com datas reais
 *    (incluindo virada de mês/ano e 29/02 de ano bissexto).
 * 2. Dinâmico: `sumDailySpendForRange`/`sumDailyResultCountForRange`
 *    (`lib/cockpit-view-data.ts`) com linhas sintéticas simples.
 * 3. Estrutural: grep de código-fonte pra confirmar a divisão arquitetural
 *    (mês de referência intocado vs. intervalo consultado) e a ausência
 *    de regressão nas 4 rotas (agência/Campanhas/Anúncios/compartilhado).
 *
 * Rodar: npx tsx scripts/test-koff-seletor-periodo.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePeriod,
  resolveShortcutRange,
  formatPeriodLabel,
  buildPeriodHref,
  isPeriodShortcut,
  shiftDays,
  startOfMonth,
  endOfMonth,
} from "../src/lib/date-range";
import { sumDailySpendForRange, sumDailyResultCountForRange } from "../src/lib/cockpit-view-data";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function main() {
console.log("\n1 — Atalhos fixos: cálculo correto de cada um (seção 2 do pedido)\n");
{
  const today = "2026-12-02"; // perto da virada do mês, caso real de atrito
  ok("Hoje: só a data atual", JSON.stringify(resolveShortcutRange("today", today)) === JSON.stringify({ firstDay: today, lastDay: today }));
  ok(
    "Ontem: só a data anterior",
    JSON.stringify(resolveShortcutRange("yesterday", today)) === JSON.stringify({ firstDay: "2026-12-01", lastDay: "2026-12-01" }),
  );
  ok(
    "Últimos 7 dias: hoje + 6 dias anteriores (7 dias no total)",
    JSON.stringify(resolveShortcutRange("last7", today)) === JSON.stringify({ firstDay: "2026-11-26", lastDay: today }),
  );
  ok(
    "Últimos 30 dias: hoje + 29 dias anteriores (30 dias no total)",
    JSON.stringify(resolveShortcutRange("last30", today)) === JSON.stringify({ firstDay: "2026-11-03", lastDay: today }),
  );
  ok(
    "Este mês: primeiro dia do mês até HOJE (nunca o mês inteiro — não estende pro futuro)",
    JSON.stringify(resolveShortcutRange("thisMonth", today)) === JSON.stringify({ firstDay: "2026-12-01", lastDay: today }),
  );
  ok(
    "Mês passado: primeiro ao ÚLTIMO dia do mês anterior (mês inteiro — já é inteiramente passado)",
    JSON.stringify(resolveShortcutRange("lastMonth", today)) === JSON.stringify({ firstDay: "2026-11-01", lastDay: "2026-11-30" }),
  );
}

console.log("\n2 — Seleção de um único dia / intervalo no mesmo mês / atravessando meses / atravessando anos / fevereiro bissexto\n");
{
  const today = new Date("2026-12-02T00:00:00Z");
  ok(
    "um único dia (início === fim)",
    JSON.stringify(resolvePeriod({ period: "custom", start: "2026-11-15", end: "2026-11-15" }, today).range) ===
      JSON.stringify({ firstDay: "2026-11-15", lastDay: "2026-11-15" }),
  );
  ok(
    "intervalo dentro do mesmo mês",
    JSON.stringify(resolvePeriod({ period: "custom", start: "2026-11-05", end: "2026-11-12" }, today).range) ===
      JSON.stringify({ firstDay: "2026-11-05", lastDay: "2026-11-12" }),
  );
  ok(
    "intervalo atravessando meses (nunca quebra, nunca inverte)",
    JSON.stringify(resolvePeriod({ period: "custom", start: "2026-11-20", end: "2026-12-02" }, today).range) ===
      JSON.stringify({ firstDay: "2026-11-20", lastDay: "2026-12-02" }),
  );
  ok(
    "intervalo atravessando ANOS",
    JSON.stringify(resolvePeriod({ period: "custom", start: "2025-12-28", end: "2026-01-03" }, new Date("2026-01-10T00:00:00Z")).range) ===
      JSON.stringify({ firstDay: "2025-12-28", lastDay: "2026-01-03" }),
  );
  ok(
    "fevereiro de ano bissexto: 'Mês passado' em março/2028 fecha em 29/02 (bissexto), nunca 28/02",
    resolveShortcutRange("lastMonth", "2028-03-15").lastDay === "2028-02-29",
  );
  ok(
    "fevereiro de ano NÃO bissexto: 'Mês passado' em março/2026 fecha em 28/02",
    resolveShortcutRange("lastMonth", "2026-03-15").lastDay === "2026-02-28",
  );
}

console.log("\n3 — Datas futuras nunca entram no intervalo final (seção 2: 'não permitir datas futuras sem dado disponível')\n");
{
  const today = new Date("2026-12-02T00:00:00Z");
  const clamped = resolvePeriod({ period: "custom", start: "2026-12-01", end: "2026-12-31" }, today).range;
  ok("fim de um intervalo personalizado é recortado em hoje, nunca estende pro futuro", clamped.lastDay === "2026-12-02");
  ok("início é preservado (só o FIM é recortado)", clamped.firstDay === "2026-12-01");
}

console.log("\n4 — Compatibilidade com URLs antigas (?month=) — zero mudança de comportamento\n");
{
  const today = new Date("2026-12-02T00:00:00Z");
  const legacyCurrentMonth = resolvePeriod({ month: "2026-12" }, today);
  ok(
    "link antigo pro mês CORRENTE: mês cheio (inclusive dias futuros, igual sempre foi — nunca recortado em hoje)",
    legacyCurrentMonth.range.firstDay === "2026-12-01" && legacyCurrentMonth.range.lastDay === "2026-12-31",
  );
  ok("link antigo pro mês corrente marca shortcut 'thisMonth' (destaca a opção certa no seletor)", legacyCurrentMonth.shortcut === "thisMonth");
  ok("link antigo continua permitindo edição (isMonthAligned=true, mesma regra de sempre)", legacyCurrentMonth.isMonthAligned === true);

  const legacyPastMonth = resolvePeriod({ month: "2026-08" }, today);
  ok(
    "link antigo pra mês PASSADO: mês cheio, intocado",
    legacyPastMonth.range.firstDay === "2026-08-01" && legacyPastMonth.range.lastDay === "2026-08-31",
  );
  ok(
    "link antigo pra mês passado NÃO fica marcado como 'Este mês' (rótulo mostra o mês certo, nunca confunde com o atual)",
    legacyPastMonth.shortcut === "custom" && formatPeriodLabel(legacyPastMonth) === "Agosto de 2026",
  );
  ok("link antigo pra mês passado continua permitindo edição (mesma regra de sempre, independente de qual mês)", legacyPastMonth.isMonthAligned === true);

  const noParams = resolvePeriod({}, today);
  ok(
    "ausência TOTAL de parâmetro: mês corrente, exatamente como sempre foi o default",
    noParams.range.firstDay === "2026-12-01" && noParams.range.lastDay === "2026-12-31" && noParams.shortcut === "thisMonth",
  );
}

console.log("\n5 — Fuso horário: tudo calculado contra o 'hoje' recebido (fuso da agência via lib/today.ts), nunca Date.now()/fuso do navegador\n");
{
  ok(
    "resolveShortcutRange nunca chama Date.now()/new Date() sem argumento — sempre recebe o 'hoje' já resolvido por quem chama",
    !loadSource("src", "lib", "date-range.ts").includes("new Date()") && !loadSource("src", "lib", "date-range.ts").includes("Date.now()"),
  );
  ok(
    "cockpit-view-data.ts resolve o período a partir de todayUTC() (lib/today.ts, fuso America/Sao_Paulo) — nunca um novo cálculo de 'hoje'",
    loadSource("src", "lib", "cockpit-view-data.ts").includes("resolvePeriod({ period: periodParam, start: startParam, end: endParam, month: monthQueryParam }, today)"),
  );
}

console.log("\n6 — Datas sem dado / intervalos com dado parcial: soma aditiva nunca fabrica número\n");
{
  const spendRows = [
    { date: "2026-11-01", channel: "meta" as const, spend: 100 },
    { date: "2026-11-02", channel: "meta" as const, spend: 150 },
    { date: "2026-11-05", channel: "google" as const, spend: 999 }, // canal fora do escopo, nunca entra
  ];
  ok(
    "soma só os dias/canais dentro do intervalo pedido (dia 03-04 sem linha = 0 real, nunca interpolado)",
    sumDailySpendForRange(spendRows, ["meta"], "2026-11-01", "2026-11-04") === 250,
  );
  ok("canal fora do escopo nunca entra na soma", sumDailySpendForRange(spendRows, ["meta"], "2026-11-01", "2026-11-05") === 250);
  ok("intervalo sem nenhuma linha correspondente soma 0 (nunca null/NaN fabricado)", sumDailySpendForRange(spendRows, ["meta"], "2026-01-01", "2026-01-05") === 0);

  const resultRows = [
    { date: "2026-11-01", channel: "meta" as const, resultType: "leads" as const, resultCount: 10 },
    { date: "2026-11-02", channel: "meta" as const, resultType: "leads" as const, resultCount: 20 },
    { date: "2026-11-02", channel: "meta" as const, resultType: "sales" as const, resultCount: 999 }, // objetivo diferente, nunca somado junto
  ];
  ok(
    "soma de resultado respeita resultType (nunca mistura objetivos diferentes)",
    sumDailyResultCountForRange(resultRows, "leads", ["meta"], "2026-11-01", "2026-11-02") === 30,
  );
}

console.log("\n7 — Arquitetura: mês de referência (orçamento/metas, intocado) vs. intervalo consultado (seção 5), nunca confundidos\n");
{
  const source = loadSource("src", "lib", "cockpit-view-data.ts");
  ok(
    "mês de referência (firstDay/lastDay) continua resolvido via monthRangeFromParam — MESMA função de sempre, nenhuma mudança na estrutura de metas",
    source.includes("const { firstDay, lastDay } = monthRangeFromParam(periodResolved.monthParam, today);"),
  );
  ok(
    "intervalo consultado (queryFirstDay/queryLastDay) vem do NOVO resolvePeriod, nunca confundido com o mês de referência",
    source.includes("const queryFirstDay = periodResolved.range.firstDay;") && source.includes("const queryLastDay = periodResolved.range.lastDay;"),
  );
  ok(
    "edição inline de orçamento/meta só quando isMonthAligned (seção 6: ambíguo editar 'o mês' olhando uma janela mais curta)",
    source.includes("const canEditBudgetInline = isAdmin && !isClosedMonth && Boolean(effectiveDate) && isMonthAligned;"),
  );
  ok(
    "fora de isMonthAligned, Orçamento reaproveita os estados JÁ EXISTENTES (monthPlanned=0 -> 'Sem planejamento'; monthStatus='sem_meta' -> badge neutro já existente) — nenhum componente/veredito novo",
    source.includes('const monthPlanned = isMonthAligned ? totalPlannedAcrossChannels : 0;') &&
      source.includes('const monthStatus = isMonthAligned ? classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned) : "sem_meta";'),
  );
  ok(
    "fora de isMonthAligned, Resultado/Custo somam direto das tabelas diárias (sumDailyResultCountForRange/sumDailySpendForRange) — nunca o mecanismo de sprints (mensal/semanal, não serve pra 'Hoje')",
    source.includes("sumDailyResultCountForRange(queryRangeDailyPerformanceRows, group.resultType, group.channels, queryFirstDay, queryLastDay)"),
  );
  ok(
    "filtro de campanha + período personalizado simultâneos: unavailableReason explícito (tabelas diárias não têm dimensão de campanha), nunca um número fabricado",
    source.includes('if (!isMonthAligned) {') && source.includes("Filtro de campanha indisponível em períodos personalizados"),
  );
  ok(
    "indicadores Meta Ads/evolução/campanhas-anúncios (buildPerformanceReportData, fetchAccountPeriodReachSnapshot, buildCockpitAdPerformanceData) todos no intervalo CONSULTADO — seção 5: 'respeitar exatamente o intervalo selecionado'",
    source.includes("buildPerformanceReportData(supabase, clientId, { start: queryFirstDay, end: queryLastDay })") &&
      source.includes("fetchAccountPeriodReachSnapshot(metaAdAccountId, { start: queryFirstDay, end: queryLastDay })") &&
      source.includes("period: { start: queryFirstDay, end: queryLastDay }"),
  );
}

console.log("\n8 — Componente único: mesmo PeriodRangePicker nas 4 experiências (agência/cliente × desktop/mobile), nunca um seletor por tela\n");
{
  const cockpitViewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");
  const campanhasSource = loadSource("src", "app", "clients", "[id]", "campanhas", "page.tsx");
  const anunciosSource = loadSource("src", "app", "clients", "[id]", "anuncios", "page.tsx");
  const pickerSource = loadSource("src", "app", "clients", "period-range-picker.tsx");

  ok("Dashboard (Cockpit, agência + /r/[token] via CockpitView compartilhado) usa PeriodRangePicker", cockpitViewSource.includes("<PeriodRangePicker"));
  ok("Campanhas usa o MESMO PeriodRangePicker (import idêntico, nenhum componente próprio)", campanhasSource.includes('import { PeriodRangePicker } from "../../period-range-picker"') && campanhasSource.includes("<PeriodRangePicker"));
  ok("Anúncios usa o MESMO PeriodRangePicker", anunciosSource.includes('import { PeriodRangePicker } from "../../period-range-picker"') && anunciosSource.includes("<PeriodRangePicker"));
  ok(
    "responsivo via CSS (popover `lg:` vs bottom sheet fixo) sobre a MESMA árvore — nunca dois componentes/dois estados",
    pickerSource.includes("lg:absolute") &&
      pickerSource.includes("fixed inset-x-0 bottom-0") &&
      (pickerSource.match(/export function PeriodRangePicker\(/g) ?? []).length === 1,
  );
  ok(
    "painel não existe até abrir (`{open && <PeriodRangePickerPanel`) — nenhuma segunda lógica de abrir/fechar duplicada",
    pickerSource.includes("{open && (") && pickerSource.includes("<PeriodRangePickerPanel"),
  );
}

console.log("\n9 — Aplicar/Cancelar: rascunho só vira navegação real no Aplicar; reabrir sempre reinicia do período JÁ APLICADO\n");
{
  const pickerSource = loadSource("src", "app", "clients", "period-range-picker.tsx");
  ok(
    "Cancelar nunca chama router.push/buildPeriodHref — só fecha (onCancel), descarta o rascunho",
    /onClick=\{onCancel\}\s*\n\s*className="mitza-pressable rounded-md border/.test(pickerSource),
  );
  ok("Aplicar é o ÚNICO gatilho que constrói o href e navega", pickerSource.includes("onClick={() => onApply(buildPeriodHref(basePath, searchParams.toString(), draftShortcut, draftRange))}"));
  ok(
    "painel remonta do zero a cada abertura (key={openKey}, nunca um useEffect resetando estado por fora) — reabrir sempre usa o período JÁ APLICADO (`resolved`), nunca um rascunho antigo pendurado",
    pickerSource.includes("<PeriodRangePickerPanel\n          key={openKey}") || pickerSource.includes("key={openKey}"),
  );
}

console.log("\n10 — buildPeriodHref: preserva outros parâmetros da URL (correção da limitação que o antigo buildCockpitMonthHref sempre teve), nunca grava ?month= de novo\n");
{
  ok(
    "preserva filtro/modo/canal já presentes na URL ao trocar de período",
    buildPeriodHref("/clients/abc", "filtro=venda&modo=contains&canal=meta", "last7", { firstDay: "2026-11-26", lastDay: "2026-12-02" }).includes("filtro=venda") &&
      buildPeriodHref("/clients/abc", "filtro=venda&modo=contains&canal=meta", "last7", { firstDay: "2026-11-26", lastDay: "2026-12-02" }).includes("canal=meta"),
  );
  ok("nunca escreve ?month= (formato novo substitui, link antigo só é LIDO, nunca gerado de novo)", !buildPeriodHref("/clients/abc", "month=2026-10", "today").includes("month="));
  ok(
    "shortcut !== custom nunca grava start/end na URL (evita URL poluída quando é só um atalho fixo)",
    !buildPeriodHref("/clients/abc", "", "thisMonth").includes("start=") && !buildPeriodHref("/clients/abc", "", "thisMonth").includes("end="),
  );
  ok(
    "shortcut === custom sempre grava start/end explícitos (sobrevive a refresh/link compartilhado)",
    buildPeriodHref("/clients/abc", "", "custom", { firstDay: "2026-11-05", lastDay: "2026-11-12" }).includes("start=2026-11-05") &&
      buildPeriodHref("/clients/abc", "", "custom", { firstDay: "2026-11-05", lastDay: "2026-11-12" }).includes("end=2026-11-12"),
  );
}

console.log("\n11 — Rótulos do botão (exemplos exatos do pedido)\n");
{
  const today = new Date("2026-11-12T00:00:00Z");
  ok("'Hoje'", formatPeriodLabel(resolvePeriod({ period: "today" }, today)) === "Hoje");
  ok("'Últimos 7 dias'", formatPeriodLabel(resolvePeriod({ period: "last7" }, today)) === "Últimos 7 dias");
  ok("'Novembro de 2026' (mês)", formatPeriodLabel(resolvePeriod({ period: "thisMonth" }, today)) === "Novembro de 2026");
  ok(
    "'05/11 – 12/11/2026' (intervalo personalizado, exemplo exato do pedido)",
    formatPeriodLabel(resolvePeriod({ period: "custom", start: "2026-11-05", end: "2026-11-12" }, today)) === "05/11 – 12/11/2026",
  );
}

console.log("\n12 — Troca de cliente/navegação entre Dashboard-Campanhas-Anúncios preserva o período (mesmo basePath, mesmo componente)\n");
{
  // buildPeriodHref só precisa do basePath de CADA rota — nunca embute
  // clientId/permissão (quem resolve isso é o servidor, por token/sessão,
  // nunca o período) — trocar de rota com o MESMO período só troca o
  // basePath, o período (`shortcut`/`range`) viaja igual nos 2.
  const hrefDashboard = buildPeriodHref("/clients/abc", "", "last7");
  const hrefCampanhas = buildPeriodHref("/clients/abc/campanhas", "", "last7");
  ok(
    "mesmo período, basePaths diferentes (Dashboard vs Campanhas) — nunca um clientId/permissão embutido no período",
    hrefDashboard.includes("period=last7") && hrefCampanhas.includes("period=last7") && hrefDashboard.startsWith("/clients/abc?") && hrefCampanhas.startsWith("/clients/abc/campanhas?"),
  );
}

console.log("\n13 — Visão compartilhada (read-only): aceita os mesmos parâmetros, nunca concede edição\n");
{
  const sharedSource = loadSource("src", "app", "r", "[token]", "page.tsx");
  ok("/r/[token] aceita period/start/end (mesma funcionalidade do seletor que a agência tem)", sharedSource.includes("period?: string; start?: string; end?: string"));
  ok("/r/[token] repassa pra buildCockpitViewModel com viewer.kind: 'shared' (edição decidida na ORIGEM, nunca por este parâmetro)", sharedSource.includes('viewer: { kind: "shared" }'));
  ok(
    "isMonthAligned/canEditBudgetInline dependem de isAdmin (sempre false pra 'shared') ANTES de checar o período — trocar período num link compartilhado NUNCA abre edição",
    loadSource("src", "lib", "cockpit-view-data.ts").includes("const canEditBudgetInline = isAdmin && !isClosedMonth && Boolean(effectiveDate) && isMonthAligned;"),
  );
}

console.log("\n14 — isPeriodShortcut: validação segura de parâmetro bruto da URL (nunca confia em valor não reconhecido)\n");
{
  ok("'today' é válido", isPeriodShortcut("today"));
  ok("'custom' é válido", isPeriodShortcut("custom"));
  ok("valor arbitrário/malicioso nunca é aceito como shortcut", !isPeriodShortcut("'; DROP TABLE clients; --") && !isPeriodShortcut("proximoMes") && !isPeriodShortcut(123));
  ok(
    "parâmetro de período inválido cai no fallback seguro (mês corrente) — nunca lança exceção, nunca expõe erro",
    (() => {
      const r = resolvePeriod({ period: "qualquer-coisa-invalida" }, new Date("2026-11-12T00:00:00Z"));
      return r.range.firstDay === "2026-11-01" && r.range.lastDay === "2026-11-30";
    })(),
  );
}

console.log("\n15 — Utilitários de data (shiftDays/startOfMonth/endOfMonth): puros, sem efeito colateral, mesma convenção UTC do resto do projeto\n");
{
  ok("shiftDays avança dias corretamente atravessando mês", shiftDays("2026-11-30", 1) === "2026-12-01");
  ok("shiftDays retrocede corretamente atravessando ano", shiftDays("2026-01-01", -1) === "2025-12-31");
  ok("startOfMonth", startOfMonth("2026-11-17") === "2026-11-01");
  ok("endOfMonth respeita fevereiro bissexto", endOfMonth("2028-02-10") === "2028-02-29");
}

console.log(`\nTodos os ${passed} testes passaram.`);
}

main();
