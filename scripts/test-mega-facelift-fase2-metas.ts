/**
 * Testes da Etapa "MEGA FACELIFT — Fase 2: Metas" — núcleo puro
 * (`lib/metas-table.ts`, `lib/monthly-budget.ts#computeNeededDailyRate`) e
 * checagens estruturais do loader (`src/app/clients/metas-data.ts`) e da
 * página (`src/app/clients/[id]/metas/page.tsx`), mesmo padrão de sempre
 * neste ambiente (sem Supabase real — ver `test-client-workspace.ts`).
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase2-metas.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCumulativeRow, buildRatioRow, sumByDate } from "../src/lib/metas-table";
import { computeNeededDailyRate, listDatesInclusive } from "../src/lib/monthly-budget";
import { buildMetasHref } from "../src/app/clients/[id]/metas/page";

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
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

console.log("\n1 — Grade de dias cobre corretamente meses de 28/29/30/31 dias\n");
{
  check("Fevereiro não-bissexto (2026) tem 28 dias", listDatesInclusive("2026-02-01", "2026-02-28").length, 28);
  check("Fevereiro bissexto (2024) tem 29 dias", listDatesInclusive("2024-02-01", "2024-02-29").length, 29);
  check("Abril tem 30 dias", listDatesInclusive("2026-04-01", "2026-04-30").length, 30);
  check("Janeiro tem 31 dias", listDatesInclusive("2026-01-01", "2026-01-31").length, 31);

  const row28 = buildCumulativeRow({
    key: "resultado",
    label: "Leads",
    unit: "count",
    monthRange: { firstDay: "2026-02-01", lastDay: "2026-02-28" },
    todayStr: "2026-03-15",
    eligibleDaysCount: 0,
    targetMonth: 100,
    realizedMonth: 90,
    hasRealizedData: true,
    dailyValues: null,
    sensitivity: "any",
  });
  check("A linha gerada tem exatamente 28 células (uma por dia de fevereiro não-bissexto)", row28.days.length, 28);
}

console.log("\n2 — Mês passado: nenhum dia futuro, nenhum ritmo necessário (não há mais o que perseguir)\n");
{
  const row = buildCumulativeRow({
    key: "investimento",
    label: "Investimento",
    unit: "currency",
    monthRange: { firstDay: "2026-01-01", lastDay: "2026-01-31" },
    todayStr: "2026-03-01",
    eligibleDaysCount: 0,
    targetMonth: 10000,
    realizedMonth: 9500,
    hasRealizedData: true,
    dailyValues: new Map([["2026-01-05", 1000]]),
    sensitivity: "any",
  });
  ok("mês encerrado — nenhuma célula marcada como futura", row.days.every((d) => !d.isFuture));
  ok("mês encerrado — nenhuma célula de ritmo necessário (eligibleDaysCount = 0)", row.days.every((d) => !d.isNeededRate));
  check("dia com dado real mostra o valor real, nunca '—' fabricado", row.days.find((d) => d.date === "2026-01-05")?.value, 1000);
  check("dia sem dado real (passado) mostra null — nunca 0 fabricado", row.days.find((d) => d.date === "2026-01-06")?.value, null);
}

console.log("\n3 — Mês futuro: todo dia é futuro, ritmo necessário repetido (meta inteira ÷ dias do mês, nada ainda realizado)\n");
{
  const row = buildCumulativeRow({
    key: "resultado",
    label: "Vendas",
    unit: "count",
    monthRange: { firstDay: "2026-12-01", lastDay: "2026-12-31" },
    todayStr: "2026-10-01",
    eligibleDaysCount: 31,
    targetMonth: 310,
    realizedMonth: 0,
    hasRealizedData: false,
    dailyValues: null,
    sensitivity: "any",
  });
  ok("mês futuro — toda célula marcada como futura", row.days.every((d) => d.isFuture));
  ok("mês futuro — toda célula recebe o ritmo necessário (meta calculável)", row.days.every((d) => d.isNeededRate));
  check("ritmo necessário = meta inteira ÷ dias do mês (nada realizado ainda)", row.days[0].value, 10);
  check("'Realizado' sai null quando não há nenhum registro (hasRealizedData=false) — nunca 0 fabricado", row.realizedMonth, null);
}

console.log("\n4 — Mês atual: passado real + hoje real + futuro com ritmo necessário, nunca misturados\n");
{
  const row = buildCumulativeRow({
    key: "investimento",
    label: "Investimento",
    unit: "currency",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-31" },
    todayStr: "2026-10-10",
    eligibleDaysCount: 21, // dias 10..31
    targetMonth: 3100,
    realizedMonth: 1000,
    hasRealizedData: true,
    dailyValues: sumByDate([
      { date: "2026-10-01", value: 100 },
      { date: "2026-10-10", value: 100 },
    ]),
    sensitivity: "any",
  });
  check("dia passado com dado real", row.days.find((d) => d.date === "2026-10-01")?.value, 100);
  check("hoje (10/10) nunca é tratado como futuro", row.days.find((d) => d.date === "2026-10-10")?.isFuture, false);
  check("hoje com dado real mostra o valor real", row.days.find((d) => d.date === "2026-10-10")?.value, 100);
  ok("dia futuro (11/10 em diante) marcado como futuro", row.days.find((d) => d.date === "2026-10-11")!.isFuture);
  check("ritmo necessário = (meta - realizado) / dias elegíveis restantes = (3100-1000)/21", row.days.find((d) => d.date === "2026-10-11")?.value, 100);
  ok("dia passado sem dado real NUNCA recebe o ritmo necessário por engano", !row.days.find((d) => d.date === "2026-10-05")!.isNeededRate);
}

console.log("\n5 — computeNeededDailyRate: núcleo da fórmula de ritmo necessário\n");
{
  check("meta ausente -> null (nada a perseguir)", computeNeededDailyRate(null, 500, 10), null);
  check("sem dias elegíveis restantes -> null (mês encerrado, nunca 0 fabricado)", computeNeededDailyRate(1000, 500, 0), null);
  check("meta já atingida -> 0 (não 'negativo', remaining nunca abaixo de 0)", computeNeededDailyRate(1000, 1500, 10), 0);
  check("cálculo simples: (1000-400)/6", computeNeededDailyRate(1000, 400, 6), 100);
}

console.log("\n6 — Linha de RAZÃO (CPA/CPL/ROAS): nunca soma, sempre derivada por divisão — e nunca tem ritmo necessário futuro\n");
{
  const row = buildRatioRow({
    key: "custo",
    label: "CPL",
    unit: "currency",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-05" },
    todayStr: "2026-10-03",
    targetMonth: 50,
    realizedMonth: 42,
    resultCountForReliability: 20,
    diagnosticKind: "cpa",
    unavailableNote: null,
    dailyNumerator: sumByDate([
      { date: "2026-10-01", value: 400 },
      { date: "2026-10-02", value: 0 },
    ]),
    dailyDenominator: sumByDate([
      { date: "2026-10-01", value: 10 },
      { date: "2026-10-03", value: 5 },
    ]),
  });

  check("'Realizado' do mês é EXATAMENTE o valor passado (derivado fora, nunca recomputado a partir da soma dos dias)", row.realizedMonth, 42);
  check("dia com spend e resultado: CPA diário derivado por divisão (400/10)", row.days.find((d) => d.date === "2026-10-01")?.value, 40);
  check("spend sem resultado no dia (resultado ausente) -> null, nunca Infinity/0 fabricado", row.days.find((d) => d.date === "2026-10-02")?.value, null);
  check("resultado sem spend no dia (spend ausente) -> null", row.days.find((d) => d.date === "2026-10-03")?.value, null);
  ok("nenhum dia futuro de uma linha de razão recebe ritmo necessário (não existe fórmula segura pra isso)", row.days.every((d) => !d.isNeededRate));
  ok("dia futuro de uma linha de razão é sempre '—', nunca um valor", row.days.find((d) => d.date === "2026-10-04")?.value === null);
}

console.log("\n7 — CPA/ROAS nunca dividem por zero\n");
{
  const cpaZeroResult = buildRatioRow({
    key: "custo",
    label: "CPA",
    unit: "currency",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-02" },
    todayStr: "2026-10-02",
    targetMonth: 50,
    realizedMonth: null,
    diagnosticKind: "cpa",
    unavailableNote: null,
    dailyNumerator: sumByDate([{ date: "2026-10-01", value: 500 }]),
    dailyDenominator: sumByDate([{ date: "2026-10-01", value: 0 }]),
  });
  check("spend > 0 com resultado 0 no mesmo dia -> '—' (null), nunca Infinity", cpaZeroResult.days.find((d) => d.date === "2026-10-01")?.value, null);

  const roasZeroSpend = buildRatioRow({
    key: "roas",
    label: "ROAS",
    unit: "ratio_x",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-02" },
    todayStr: "2026-10-02",
    targetMonth: null,
    realizedMonth: null,
    diagnosticKind: "none",
    unavailableNote: null,
    dailyNumerator: sumByDate([{ date: "2026-10-01", value: 1000 }]),
    dailyDenominator: sumByDate([{ date: "2026-10-01", value: 0 }]),
  });
  check("receita > 0 com investimento 0 no mesmo dia -> '—' (null), nunca Infinity", roasZeroSpend.days.find((d) => d.date === "2026-10-01")?.value, null);
}

console.log("\n8 — Objetivo primário vs. secundário: meta de investimento nunca fabricada pro secundário\n");
{
  const primaryInvestmentRow = buildCumulativeRow({
    key: "investimento",
    label: "Investimento",
    unit: "currency",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-05" },
    todayStr: "2026-10-03",
    eligibleDaysCount: 3,
    targetMonth: 5000,
    realizedMonth: 2000,
    hasRealizedData: true,
    dailyValues: null,
    sensitivity: "any",
  });
  ok("objetivo PRINCIPAL: meta de investimento real gera ritmo necessário", primaryInvestmentRow.days.some((d) => d.isNeededRate));

  const secondaryInvestmentRow = buildCumulativeRow({
    key: "investimento",
    label: "Investimento",
    unit: "currency",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-05" },
    todayStr: "2026-10-03",
    eligibleDaysCount: 3,
    // Auditoria seção 9: objetivo SECUNDÁRIO nunca tem meta de investimento
    // real (nunca o placeholder 0 de `set_goal_monthly_target`) — o loader
    // sempre passa `null` aqui pra objetivo não-principal.
    targetMonth: null,
    realizedMonth: 800, // derivado de campanhas classificadas (goalSpend)
    hasRealizedData: true,
    dailyValues: null,
    sensitivity: "any",
  });
  check("objetivo SECUNDÁRIO: 'Meta' de investimento é sempre '—' (null), nunca 0 fabricado", secondaryInvestmentRow.targetMonth, null);
  ok("objetivo SECUNDÁRIO: sem meta, nenhuma célula futura recebe ritmo necessário", secondaryInvestmentRow.days.every((d) => !d.isNeededRate));
  check("objetivo SECUNDÁRIO: 'Realizado' continua real (derivado de campanhas classificadas)", secondaryInvestmentRow.realizedMonth, 800);
}

console.log("\n9 — Cliente sem meta configurada pra um indicador: '—', nunca 0/NaN fabricado, diagnóstico neutro\n");
{
  const row = buildCumulativeRow({
    key: "resultado",
    label: "Seguidores",
    unit: "count",
    monthRange: { firstDay: "2026-10-01", lastDay: "2026-10-05" },
    todayStr: "2026-10-03",
    eligibleDaysCount: 3,
    targetMonth: null,
    realizedMonth: 40,
    hasRealizedData: true,
    dailyValues: null,
    sensitivity: "any",
  });
  check("sem meta configurada -> targetMonth null", row.targetMonth, null);
  check("sem meta -> nenhum ritmo necessário calculável, mesmo em dia futuro", row.days.find((d) => d.date === "2026-10-04")?.value, null);
  check("sem meta -> diagnóstico sempre 'normal' (nenhuma base de comparação, nunca um desvio inventado)", row.tone, "normal");
}

console.log("\n10 — sumByDate: agrega por data somando múltiplos canais, nunca sobrescreve\n");
{
  const sums = sumByDate([
    { date: "2026-10-01", value: 100 },
    { date: "2026-10-01", value: 50 },
    { date: "2026-10-02", value: 30 },
  ]);
  check("dois canais no mesmo dia somam (nunca o último sobrescreve o primeiro)", sums.get("2026-10-01"), 150);
  check("dia com um canal só", sums.get("2026-10-02"), 30);
  check("dia sem nenhuma linha simplesmente não existe no mapa (nunca 0 fabricado)", sums.get("2026-10-03"), undefined);
}

console.log("\n11 — buildMetasHref: troca de mês/objetivo preserva o outro parâmetro, mesmo vocabulário ?month=/?goal= do Painel\n");
{
  check("troca de mês preserva o objetivo selecionado", buildMetasHref("c1", { month: "2026-09", goal: "sales" }, { month: "2026-10" }), "/clients/c1/metas?month=2026-10&goal=sales");
  check("troca de objetivo preserva o mês selecionado", buildMetasHref("c1", { month: "2026-09", goal: "sales" }, { goal: "leads" }), "/clients/c1/metas?month=2026-09&goal=leads");
  check("objetivo principal navega SEM o param goal (ausência = estado default, mesmo padrão do Painel)", buildMetasHref("c1", { month: "2026-09", goal: "sales" }, { goal: null }), "/clients/c1/metas?month=2026-09");
  check("sem nenhum param -> rota limpa", buildMetasHref("c1", {}, {}), "/clients/c1/metas");
}

console.log("\n12 — Checagens estruturais do loader: nenhum N+1 por dia, nenhuma mistura de objetivo, nenhuma segunda consulta de spend\n");
{
  const dataSource = loadSource("src", "app", "clients", "metas-data.ts");

  ok(
    "Resultado filtra SEMPRE por result_type do objetivo selecionado (automático e manual) — nunca mistura objetivos na mesma soma",
    /r\.result_type === selectedGoal\.resultType/.test(dataSource),
  );
  ok(
    "daily_spend é buscado uma única vez (nenhuma segunda query de spend que poderia divergir/duplicar)",
    dataSource.match(/\.from\("daily_spend"\)/g)?.length === 1,
  );
  ok(
    "o mesmo `dailySpendInScope` alimenta tanto o total do mês (sumActualSpendForMonth) quanto a grade diária — nunca duas somas independentes",
    /sumActualSpendForMonth\(sprints, monthRange, dailySpendInScope\)/.test(dataSource) &&
      /sumByDate\(dailySpendInScope\.map/.test(dataSource),
  );
  ok(
    "nenhuma busca ao Supabase vive dentro de um loop por data (grep negativo: 'from(' nunca aparece dentro de um for/map sobre dias)",
    !/for\s*\([^)]*date[^)]*\)\s*\{[\s\S]*?\.from\(/.test(dataSource) && !/listDatesInclusive[\s\S]{0,200}\.from\(/.test(dataSource),
  );
  ok(
    "investimento de objetivo SECUNDÁRIO nunca lê monthly_budget_changes como meta real — é sempre null, explícito no código",
    /targetCostPerResult = null/.test(dataSource) && dataSource.includes("investmentTargetMonth: number | null = null"),
  );
  ok(
    "gap de granularidade diária pro investimento de objetivo secundário está documentado no próprio código (nunca silencioso)",
    /Sem grade diária nesta rodada/.test(dataSource),
  );
}

console.log("\n13 — ChannelPlanEditor permanece restrito ao objetivo principal na tela de Metas (mesma trava do Painel)\n");
{
  const pageSource = loadSource("src", "app", "clients", "[id]", "metas", "page.tsx");
  ok("ChannelPlanEditor só renderiza quando data.isPrimary", /data\.isPrimary \? \(\s*<ChannelPlanEditor/.test(pageSource));
  ok("objetivo secundário usa o formulário seguro dedicado (setGoalMonthlyTargetAction, via MetasSecondaryTargetForm)", pageSource.includes("<MetasSecondaryTargetForm"));
  ok("edição só aparece para admin, mês não encerrado", pageSource.includes("!isAdmin || isClosedMonth || !effectiveDate"));
}

console.log("\n14 — BUGFIX (produção): scroll horizontal vazando por trás das colunas sticky de MetasSummaryTable\n");
{
  const tableSource = loadSource("src", "app", "clients", "metas-summary-table.tsx");

  ok(
    "table-layout:fixed (nunca auto) — colunas nunca mais são redimensionadas pelo conteúdo (rótulo longo como 'Custo por novo seguidor')",
    /className="table-fixed/.test(tableSource),
  );
  ok(
    "<colgroup> com <col> explícito pra cada coluna sticky E pra cada dia — header e body herdam a MESMA largura, nunca duas fontes de verdade",
    /<colgroup>/.test(tableSource) && /days\.map\(\(day\) => \(\s*<col key=\{day\.date\} style=\{\{ width: DAY_COLUMN_WIDTH \}\} \/>/.test(tableSource),
  );
  ok(
    "a <table> tem width explícito (soma de STICKY_COLUMN_WIDTH + dias × DAY_COLUMN_WIDTH) — sem isso, table-layout:fixed não respeita o <colgroup> pixel a pixel (achado real: 'Meta do mês' renderizava 114px em vez de 110px, dias 78px em vez de 64px, mesmo com colgroup correto)",
    /const totalTableWidth = STICKY_COLUMN_WIDTH\.indicador \+ STICKY_COLUMN_WIDTH\.meta \+ STICKY_COLUMN_WIDTH\.realizado \+ days\.length \* DAY_COLUMN_WIDTH/.test(
      tableSource,
    ) && /style=\{\{ width: totalTableWidth \}\}/.test(tableSource),
  );
  ok(
    "left de cada coluna sticky é DERIVADO por soma cumulativa de STICKY_COLUMN_WIDTH, nunca um valor solto escrito à mão (causa raiz original do bug)",
    /realizado: STICKY_COLUMN_WIDTH\.indicador \+ STICKY_COLUMN_WIDTH\.meta/.test(tableSource),
  );
  ok(
    "nenhuma classe Tailwind arbitrária left-[Npx]/w-[Npx] sobrevive no código real (fora de comentário) — só style inline derivado das constantes",
    !tableSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .some((line) => /left-\[\d+px\]|w-\[\d+px\]/.test(line)),
  );
  ok(
    "nenhuma coluna sticky usa width ausente — o mesmo STICKY_COLUMN_WIDTH alimenta tanto <col> (colgroup) quanto o style inline de cada th/td sticky",
    (tableSource.match(/style=\{\{ left: STICKY_LEFT\.\w+, width: STICKY_COLUMN_WIDTH\.\w+ \}\}/g) ?? []).length === 6,
  );
  ok("células sticky têm background opaco (bg-overview-surface/-subtle), nunca transparente", /STICKY_COL_CLASSES = "sticky z-10 box-border bg-overview-surface"/.test(tableSource));
  ok("células sticky têm z-10 (> auto das células roláveis)", tableSource.includes("sticky z-10"));
  ok("borda direita do bloco sticky (Realizado) permanece visualmente clara", /border-r border-overview-border/.test(tableSource));
  ok(
    "border-separate + border-spacing-0 (nunca border-collapse em código real) — evita o artefato de borda sticky 'roubada' pela célula rolável vizinha durante o scroll",
    /border-separate border-spacing-0/.test(tableSource) &&
      !tableSource
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .some((line) => line.includes("border-collapse")),
  );
  ok(
    "rótulo do Indicador trunca com ellipsis (nunca estoura a largura fixa da coluna) e preserva o texto completo via title",
    /TRUNCATE_CLASSES = "overflow-hidden text-ellipsis whitespace-nowrap"/.test(tableSource) && /title=\{row\.label\}/.test(tableSource),
  );
  ok(
    "o componente continua só lendo MetasRow/MetasRowUnit de lib/metas-table.ts — nenhum cálculo/projeção de dado novo, só apresentação",
    tableSource.includes('import type { MetasRow, MetasRowUnit } from "@/lib/metas-table"'),
  );
}

console.log(`\n${passed} verificações passaram.`);
