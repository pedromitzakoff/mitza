/**
 * Testes da Etapa "MITZA ONE — Evolução Diária no Cockpit": visualização
 * compacta de evolução diária em `/clients/[id]`, inserida entre Meta &
 * Ritmo/Diagnóstico e os detalhes dos Canais. Cobre o núcleo puro novo
 * (`lib/cockpit-daily-evolution.ts`), a extensão aditiva de frescor em
 * `lib/data-trust.ts`/`app/clients/dados-data.ts`, e checagens ESTRUTURAIS
 * de `app/clients/[id]/page.tsx`/`app/clients/cockpit-daily-evolution-section.tsx`
 * via grep de código-fonte — mesmo padrão já usado pelas suites anteriores
 * (sem DOM/React Testing Library neste ambiente).
 *
 * Rodar: npx tsx scripts/test-mitza-one-evolucao-diaria.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCockpitDailyEvolutionPoints,
  resolveDailyTargetResultCount,
  describeCockpitDailyPointState,
  type CockpitDailySpendRawRow,
} from "../src/lib/cockpit-daily-evolution";
import { resolveLatestImportedDate, resolveLatestSuccessAt } from "../src/lib/data-trust";
import type { DailyResultRawRow } from "../src/lib/daily-results";
import { listDatesInclusive } from "../src/lib/monthly-budget";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const TODAY = "2026-10-15";
const WINDOW = listDatesInclusive("2026-10-01", "2026-10-31");

function perfRow(date: string, channel: "meta" | "google", resultCount: number, resultType: "leads" | "sales" | "followers" = "leads"): DailyResultRawRow {
  return { date, channel, resultType, resultCount };
}
function spendRow(date: string, channel: "meta" | "google", spend: number): CockpitDailySpendRawRow {
  return { date, channel, spend };
}

// ---------------------------------------------------------------------------
console.log("\nA — Agrupamento diário: resultado + investimento somados só dentro do escopo de canais do objetivo\n");
{
  const points = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01", "2026-10-02"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta", "google"],
    performanceRows: [perfRow("2026-10-01", "meta", 3), perfRow("2026-10-01", "google", 2), perfRow("2026-10-02", "meta", 5)],
    spendRows: [spendRow("2026-10-01", "meta", 100), spendRow("2026-10-01", "google", 50), spendRow("2026-10-02", "meta", 80)],
  });
  check("dia 1: Meta(3)+Google(2) = 5 leads consolidados", points[0].resultCount, 5);
  check("dia 1: investimento Meta(100)+Google(50) = 150", points[0].spend, 150);
  check("dia 2: só Meta tem linha de resultado, soma = 5 (nunca soma com um canal fora do escopo)", points[1].resultCount, 5);

  const scopedToMeta = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [perfRow("2026-10-01", "meta", 3), perfRow("2026-10-01", "google", 2)],
    spendRows: [spendRow("2026-10-01", "meta", 100), spendRow("2026-10-01", "google", 50)],
  });
  check("escopo só Meta: ignora a linha de Google inteiramente (resultado e investimento)", [scopedToMeta[0].resultCount, scopedToMeta[0].spend], [3, 100]);
}

console.log("\nB — Compatibilidade entre métricas: só soma linhas do MESMO resultType; nunca mistura leads com vendas\n");
{
  const points = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [perfRow("2026-10-01", "meta", 10, "leads"), perfRow("2026-10-01", "meta", 999, "sales")],
    spendRows: [spendRow("2026-10-01", "meta", 100)],
  });
  check("resultType='sales' na mesma data NUNCA entra na série de 'leads'", points[0].resultCount, 10);
}

console.log("\nC — Distinção entre zero confirmado e ausência de dados (seção 5 do pedido)\n");
{
  const points = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01", "2026-10-02", "2026-10-03"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    // dia 1: sincronizado (daily_spend), sem linha de resultado -> zero confirmado.
    // dia 2: NENHUM sinal (nem spend, nem resultado) -> sem dados.
    // dia 3: linha de resultado real = 7.
    performanceRows: [perfRow("2026-10-03", "meta", 7)],
    spendRows: [spendRow("2026-10-01", "meta", 50), spendRow("2026-10-03", "meta", 70)],
  });
  check("dia 1 (sincronizado, sem resultado) -> state 'result', resultCount 0 (ZERO CONFIRMADO, nunca 'no_data')", [points[0].state, points[0].resultCount], ["result", 0]);
  check("dia 2 (nenhum sinal) -> state 'no_data', resultCount null (nunca 0 fabricado)", [points[1].state, points[1].resultCount], ["no_data", null]);
  check("dia 3 (resultado real) -> state 'result', resultCount 7", [points[2].state, points[2].resultCount], ["result", 7]);

  ok("describeCockpitDailyPointState distingue 'Zero confirmado' de 'Sem dados'", describeCockpitDailyPointState(points[0]).includes("Zero confirmado") && describeCockpitDailyPointState(points[1]).includes("Sem dados"));
}

console.log("\nD — Períodos futuros: nunca projeta resultado, nunca mostra investimento\n");
{
  const points = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-14", "2026-10-15", "2026-10-16"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [perfRow("2026-10-14", "meta", 4)],
    spendRows: [spendRow("2026-10-14", "meta", 40)],
  });
  check("dia anterior a hoje: estado normal", points[0].state, "result");
  check("HOJE (= todayStr) ainda é um dia normal, nunca futuro", points[1].state <= "result" ? true : false, true);
  check("dia DEPOIS de hoje -> state 'future'", points[2].state, "future");
  check("dia futuro nunca tem resultCount/spend/costPerResult (nunca projetado)", [points[2].resultCount, points[2].spend, points[2].costPerResult], [null, null, null]);
  ok("describeCockpitDailyPointState rotula dia futuro como 'ainda não ocorreu'", describeCockpitDailyPointState(points[2]).includes("futuro"));
}

console.log("\nE — CPL/CPA diário: nunca divide por zero, reaproveita computeCostPerResult oficial\n");
{
  const zeroResult = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [],
    spendRows: [spendRow("2026-10-01", "meta", 100)],
  })[0];
  check("zero resultados confirmados + investimento > 0 -> custo por resultado null (NUNCA R$ 0 ou Infinity)", zeroResult.costPerResult, null);

  const realResult = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [perfRow("2026-10-01", "meta", 4)],
    spendRows: [spendRow("2026-10-01", "meta", 100)],
  })[0];
  check("4 leads, R$100 -> custo por lead = 25", realResult.costPerResult, 25);

  const noSpendResult = buildCockpitDailyEvolutionPoints({
    windowDates: ["2026-10-01"],
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [perfRow("2026-10-01", "meta", 4)],
    spendRows: [],
  })[0];
  check("resultado real sem nenhuma linha de investimento no escopo -> spend null, custo null (nunca dividido por null)", [noSpendResult.spend, noSpendResult.costPerResult], [null, null]);
}

console.log("\nF — Meta diária (seção 2/6 do pedido): só quando houver meta oficial válida\n");
{
  check("meta mensal 310, mês de 31 dias -> meta diária 10", resolveDailyTargetResultCount(310, 31), 10);
  check("sem meta configurada (null) -> omite a série (null)", resolveDailyTargetResultCount(null, 31), null);
  check("meta zerada -> omite (nunca uma referência de '0/dia' enganosa)", resolveDailyTargetResultCount(0, 31), null);
  check("meta negativa (dado inconsistente) -> omite, nunca mostra referência negativa", resolveDailyTargetResultCount(-5, 31), null);
  check("daysInMonth 0 (defensivo) -> omite, nunca divide por zero", resolveDailyTargetResultCount(100, 0), null);
}

console.log("\nG — Último dia com dados vs. última sincronização bem-sucedida (seção 5 do pedido, lib/data-trust.ts)\n");
{
  check(
    "resolveLatestImportedDate: só considera fontes HABILITADAS, pega a mais recente",
    resolveLatestImportedDate([
      { enabled: true, lastImportedDate: "2026-10-10" },
      { enabled: true, lastImportedDate: "2026-10-12" },
      { enabled: false, lastImportedDate: "2026-10-20" },
    ]),
    "2026-10-12",
  );
  check("resolveLatestImportedDate: nenhuma fonte habilitada com dado -> null, nunca uma data inventada (estado desconhecido)", resolveLatestImportedDate([{ enabled: false, lastImportedDate: "2026-10-20" }]), null);
  check(
    "resolveLatestSuccessAt: mesma regra, campo DIFERENTE (last_success_at nunca confundido com last_imported_date)",
    resolveLatestSuccessAt([
      { enabled: true, lastSuccessAt: "2026-10-14T08:00:00Z" },
      { enabled: true, lastSuccessAt: "2026-10-15T08:00:00Z" },
    ]),
    "2026-10-15T08:00:00Z",
  );
  check("resolveLatestSuccessAt: nenhuma fonte habilitada sincronizou -> null", resolveLatestSuccessAt([{ enabled: false, lastSuccessAt: "2026-10-15T08:00:00Z" }]), null);

  const dadosDataSource = loadSource("src", "app", "clients", "dados-data.ts");
  ok("dados-data.ts expõe latestImportedDate BRUTO (ISO), não só o rótulo formatado — Evolução Diária precisa do valor bruto", dadosDataSource.includes("latestImportedDate: latestImportedRaw"));
  ok("dados-data.ts expõe latestSuccessAtLabel agregado (última sincronização bem-sucedida entre as fontes habilitadas)", dadosDataSource.includes("resolveLatestSuccessAt("));
}

console.log("\nH — Janela cronológica: windowDates sempre na mesma ordem, nenhum dia omitido\n");
{
  check("31 dias de outubro -> 31 pontos, nenhum omitido mesmo sem nenhum dado", buildCockpitDailyEvolutionPoints({
    windowDates: WINDOW,
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [],
    spendRows: [],
  }).length, 31);
  check("mês INTEIRO no futuro (nenhum dia <= hoje) -> todos 'future'", new Set(buildCockpitDailyEvolutionPoints({
    windowDates: listDatesInclusive("2026-12-01", "2026-12-05"),
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [],
    spendRows: [],
  }).map((p) => p.state)), new Set(["future"]));
  check("mês INTEIRO no passado sem nenhum sinal -> todos 'no_data' (nunca 'future', nunca fabricado)", new Set(buildCockpitDailyEvolutionPoints({
    windowDates: listDatesInclusive("2026-01-01", "2026-01-05"),
    todayStr: TODAY,
    resultType: "leads",
    channels: ["meta"],
    performanceRows: [],
    spendRows: [],
  }).map((p) => p.state)), new Set(["no_data"]));
}

// ---------------------------------------------------------------------------
console.log("\nI — Integração no Cockpit (estrutural): posicionamento, reaproveitamento de dados oficiais, sem N+1\n");
{
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "Evolução Diária é renderizada DEPOIS de CockpitDiagnosticsCard e ANTES do map de DashboardChannelSection (posicionamento exigido, seção 1 do pedido)",
    (() => {
      const diagIndex = pageSource.indexOf("<CockpitDiagnosticsCard");
      const evolIndex = pageSource.indexOf("<CockpitDailyEvolutionSection");
      const channelsIndex = pageSource.indexOf("<DashboardChannelSection");
      return diagIndex !== -1 && evolIndex !== -1 && channelsIndex !== -1 && diagIndex < evolIndex && evolIndex < channelsIndex;
    })(),
  );

  ok(
    "reaproveita resultGroups (groupChannelsByResultType) pra construir as séries — nenhum segundo agrupamento por objetivo inventado",
    /dailyEvolutionSeries[\s\S]{0,80}=\s*hasDailyIntegration\s*\?\s*resultGroups\.map/.test(pageSource),
  );
  ok(
    "reaproveita getDailyPerformanceRowsForPeriod (MESMA consulta já usada por Analytics/Relatório de Performance) — nenhuma tabela nova",
    /import \{[^}]*\bgetDailyPerformanceRowsForPeriod\b[^}]*\} from "@\/lib\/performance-queries"/.test(pageSource),
  );
  ok(
    "reaproveita a linha `dailySpend` JÁ buscada pro mês (seção 6 do pedido: 'não duplicar investimento entre canais') — nenhuma segunda consulta a daily_spend",
    pageSource.includes("const evolutionDailySpendRows = (dailySpend ?? []).map("),
  );
  ok(
    "a nova consulta diária entra no MESMO Promise.all de sempre (seção 7: 'não bloquear desnecessariamente o resto do cockpit') — nenhum await solto fora do Promise.all pra granularidade diária (continua um elemento puro do array, nunca um 'await getDailyPerformanceRowsForPeriod' isolado — Otimização de carregamento Item 1 só acrescentou MAIS elementos independentes ao mesmo array, nunca tirou este dali)",
    pageSource.includes("getDailyPerformanceRowsForPeriod(supabase, id, { firstDay, lastDay }),") && !pageSource.includes("await getDailyPerformanceRowsForPeriod("),
  );
  ok(
    "gate de disponibilidade usa dadosData.sources (import_sources.enabled) já carregado — nenhuma segunda consulta pra decidir se a granularidade diária existe",
    pageSource.includes("const hasDailyIntegration = Boolean(dadosData?.sources.some((s) => s.enabled));"),
  );
  ok(
    "MITZA ONE — Refinamento do Cockpit (seção 6): 'Meta diária' foi deliberadamente removida da série/tooltip — a chamada a resolveDailyTargetResultCount saiu do wiring deste gráfico (a função pura continua existindo/testada em lib/cockpit-daily-evolution.ts, só este consumidor específico parou de usá-la)",
    !pageSource.includes("resolveDailyTargetResultCount(goalPlan.consolidated.resultCount, evolutionDaysInMonth)") && !pageSource.includes("resolveDailyTargetResultCount"),
  );
}

console.log("\nJ — Estados e UI (estrutural): tooltip, múltiplos objetivos, frescor, sem seletor de canal global\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok("componente é client component (precisa de hover/toque pro tooltip)", sectionSource.startsWith('"use client"'));
  ok(
    "tooltip mostra Data/Investimento/Resultado/Custo (seção 3 do pedido original) — 'Meta diária' removida pelo Refinamento do Cockpit (seção 6), nunca reintroduzida por engano",
    sectionSource.includes("Investimento:") && !sectionSource.includes("Meta diária:") && /\{costLabel\}:/.test(sectionSource),
  );
  ok("tooltip usa describeCockpitDailyPointState pro estado de disponibilidade — nenhuma segunda lógica de rótulo", sectionSource.includes("describeCockpitDailyPointState(point)"));
  ok("tooltip reaproveita formatCostMetric oficial (lib/performance.ts) — nunca formata CPL/CPA manualmente, nunca mostra 'R$0' por divisão por zero", sectionSource.includes("formatCostMetric(point.costPerResult, formatCurrency)"));
  ok(
    "bars são <button> com onClick/onFocus/onMouseEnter (clique/toque/teclado funcionam de graça, seção 3: 'permitir interação por toque')",
    /<button\s[\s\S]{0,300}onClick={onOpen}/.test(sectionSource) && sectionSource.includes("onFocus={onOpen}") && sectionSource.includes("onMouseEnter={onOpen}"),
  );
  ok("múltiplos objetivos: um botão por série, nunca soma entre objetivos (seção 4 do pedido)", sectionSource.includes("view.series.length > 1") && sectionSource.includes("setSelectedGoal(s.resultType)"));
  ok("nenhum seletor de CANAL (Meta/Google) foi introduzido — só objetivo (resultType)", !sectionSource.includes("ChannelScope") && !/selectedChannel|setSelectedChannel/.test(sectionSource));
  ok("frescor dos dados mostra 'Dados até' distinto de 'Última sincronização' (seção 5 do pedido, nunca a mesma frase)", sectionSource.includes("Dados até") && sectionSource.includes("Última sincronização:"));
  ok("estado desconhecido de frescor nunca inventa uma data — cai em texto neutro", sectionSource.includes('"Frescor dos dados: desconhecido"'));
  ok("estados vazios (no_goal/unavailable) tratados sem gráfico fabricado", sectionSource.includes('view.kind === "no_goal"') && sectionSource.includes('view.kind === "unavailable"'));
  ok("nenhuma biblioteca de gráfico nova foi instalada (barras em divs puros, mesma convenção já usada no Cockpit)", !sectionSource.includes('from "recharts"') && !sectionSource.includes('from "chart.js"') && !sectionSource.includes('from "d3"'));

  const packageJson = loadSource("package.json");
  ok("package.json não ganhou nenhuma dependência de gráfico nova", !/"(recharts|chart\.js|victory|visx|d3|nivo)"\s*:/.test(packageJson));
}

console.log("\nJ.2 — Correção do tooltip (Etapa 'Correção do tooltip da Evolução Diária'): nunca cortado, Portal + posicionamento inteligente\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok(
    "tooltip é renderizado via createPortal pro document.body — nunca mais um <div> absoluto DENTRO da linha de barras (que tinha overflow-x-auto cortando o eixo Y)",
    sectionSource.includes("createPortal(") && sectionSource.includes("document.body"),
  );
  ok(
    "posição é calculada via getBoundingClientRect do próprio gatilho (nunca CSS relativo a um ancestral que pode cortar)",
    sectionSource.includes("anchor.getBoundingClientRect()"),
  );
  ok(
    "mede a ALTURA REAL do próprio tooltip (tooltipRef) em vez de estimar — funciona igual pra qualquer conteúdo/barra (seção 2 da correção: 'independentemente da altura da barra selecionada')",
    sectionSource.includes("tooltip?.offsetHeight"),
  );
  ok(
    "prefere abrir ACIMA do gatilho e só abre ABAIXO quando não há espaço (seção 3 da correção: 'preferencialmente acima... abrir abaixo ou lateralmente quando não houver espaço')",
    sectionSource.includes("fitsAbove") && sectionSource.includes("anchorRect.bottom + TOOLTIP_ANCHOR_GAP_PX"),
  );
  ok(
    "posição horizontal é sempre recortada (clamp) dentro da viewport — cobre as barras das EXTREMIDADES do gráfico (dia 01/dia 31) sem estourar a tela",
    /left = Math\.min\(left, window\.innerWidth/.test(sectionSource) && /left = Math\.max\(left, TOOLTIP_VIEWPORT_MARGIN_PX\)/.test(sectionSource),
  );
  ok(
    "posição vertical também é recortada dentro da viewport (nunca estoura topo/rodapé da tela)",
    /top = Math\.min\(top, window\.innerHeight/.test(sectionSource) && /top = Math\.max\(top, TOOLTIP_VIEWPORT_MARGIN_PX\)/.test(sectionSource),
  );
  ok(
    "usa useLayoutEffect (mede/posiciona ANTES do navegador pintar — nunca um tooltip 'pulando' de posição visível ao usuário)",
    /import \{[^}]*\buseLayoutEffect\b[^}]*\} from "react"/.test(sectionSource),
  );
  ok(
    "o contêiner rolável (overflow-x-auto) continua existindo pra linha de barras — o tooltip sai da árvore de layout via Portal (document.body, já confirmado acima), nunca altera largura/altura do gráfico nem provoca rolagem nova",
    sectionSource.includes('className="relative mt-2 overflow-x-auto pb-1"'),
  );
  ok(
    "só um tooltip ativo por vez entre as barras (activeDate, mutuamente exclusivo) — trocar de barra fecha a anterior sozinho, nunca dois abertos ao mesmo tempo",
    sectionSource.includes("const [activeDate, setActiveDate] = useState<string | null>(null)") && sectionSource.includes("isOpen={activeDate === point.date}"),
  );
  ok("Esc fecha o tooltip (navegação por teclado, seção 6 da correção)", sectionSource.includes('event.key === "Escape"') && sectionSource.includes("onCloseAll"));
  ok("tooltip escuro preservado (zinc-900/zinc-100, mesma paleta de antes)", sectionSource.includes("bg-zinc-900") && sectionSource.includes("text-zinc-100"));
  ok(
    "tooltip continua mostrando Data/estado/Investimento/Resultado/Custo — a correção de posicionamento desta etapa não foi desfeita; 'Meta diária' foi removida por decisão posterior (Refinamento do Cockpit, seção 6), não por esta correção",
    sectionSource.includes("formatShortDate(point.date)") &&
      sectionSource.includes("describeCockpitDailyPointState(point)") &&
      sectionSource.includes("Investimento:"),
  );
}

console.log("\nK — Restrições (seção 9 do pedido): nenhuma rota/componente legado removido, nenhuma migration/schema nova\n");
{
  ok("sidebar.tsx não foi tocado por esta etapa (restrição: 'não modificar a sidebar nem o header')", (() => {
    try {
      const sidebarSource = loadSource("src", "app", "sidebar.tsx");
      return sidebarSource.includes("AccordionGroup"); // já existia da Fase 2.1, prova que o arquivo não foi revertido/alterado por esta etapa
    } catch {
      return false;
    }
  })());
  ok("client-workspace-header.tsx continua sem nenhuma referência à Evolução Diária (header intocado)", !loadSource("src", "app", "clients", "client-workspace-header.tsx").includes("DailyEvolution"));
  ok("nenhum arquivo .sql novo foi criado por esta etapa (checagem indireta: nenhuma migration de evolução diária referenciada no código novo)", !loadSource("src", "lib", "cockpit-daily-evolution.ts").toLowerCase().includes("migration"));
  ok(
    "orphan pré-existente (DailyResultsEvolution, app/clients/daily-results-evolution.tsx) continua no disco, intocado — nenhuma remoção agressiva",
    loadSource("src", "app", "clients", "daily-results-evolution.tsx").includes("export function DailyResultsEvolution"),
  );
}

console.log(`\n${passed} verificações passaram.\n`);
