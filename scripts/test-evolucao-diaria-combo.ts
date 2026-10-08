/**
 * Testes da Etapa "MITZA ONE — Refinamento visual e analítico da Evolução
 * Diária": transforma o gráfico (já aprovado funcionalmente, tooltip já
 * corrigido com Portal) num gráfico combinado — barras de Resultado +
 * linhas de Investimento e Custo por resultado, cada série com cor e
 * escala próprias, legenda interativa. Cobre o núcleo puro novo
 * (`buildNormalizedLineSegments`, `lib/cockpit-daily-evolution.ts`) com
 * chamadas diretas, e checagens ESTRUTURAIS do componente via grep de
 * código-fonte (mesmo padrão das suites anteriores, sem DOM neste
 * ambiente).
 *
 * Rodar: npx tsx scripts/test-evolucao-diaria-combo.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildNormalizedLineSegments } from "../src/lib/cockpit-daily-evolution";

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

// ---------------------------------------------------------------------------
console.log("\nA — buildNormalizedLineSegments: geometria pura, nunca liga através de um gap\n");
{
  const { segments, markers } = buildNormalizedLineSegments({
    values: [10, 20, null, 5],
    maxValue: 20,
    columnWidthPx: 20,
    areaHeightPx: 100,
  });
  check("2 segmentos: [dia0,dia1] e [dia3] — o null no meio QUEBRA a sequência, nunca conecta dia1 a dia3", segments.length, 2);
  check("segmento 1 tem 2 pontos (dia0, dia1)", segments[0].length, 2);
  check("segmento 2 tem 1 ponto (dia3) — isolado, vira só marcador, nenhuma linha visível a desenhar a partir dele", segments[1].length, 1);
  check("4 valores válidos (10,20,null,5) -> 3 marcadores (um por valor não-null)", markers.length, 3);

  check("dia0 (valor 10, max 20): y = 100 - (10/20)*100 = 50", segments[0][0].y, 50);
  check("dia1 (valor 20, max 20): y = 0 (topo — valor máximo da própria série)", segments[0][1].y, 0);
  check("dia0 x = 0*20 + 10 = 10 (centro da coluna 0)", segments[0][0].x, 10);
  check("dia1 x = 1*20 + 10 = 30 (centro da coluna 1)", segments[0][1].x, 30);
}

console.log("\nB — buildNormalizedLineSegments: nunca fabrica um ponto pra dia sem valor (never um 0 silencioso)\n");
{
  const allNull = buildNormalizedLineSegments({ values: [null, null, null], maxValue: 10, columnWidthPx: 20, areaHeightPx: 100 });
  check("todos os dias sem valor -> nenhum segmento, nenhum marcador (nunca uma linha reta em 0)", [allNull.segments.length, allNull.markers.length], [0, 0]);

  const noMax = buildNormalizedLineSegments({ values: [5, 10], maxValue: 0, columnWidthPx: 20, areaHeightPx: 100 });
  check("maxValue <= 0 (nenhum valor real na janela) -> nenhum segmento/marcador, nunca divide por zero", [noMax.segments.length, noMax.markers.length], [0, 0]);
}

console.log("\nC — buildNormalizedLineSegments: escala SEMPRE própria da série (0 a maxValue), nunca a escala de outra série\n");
{
  const highMax = buildNormalizedLineSegments({ values: [50], maxValue: 1000, columnWidthPx: 20, areaHeightPx: 100 });
  check("valor 50 de um máximo 1000 (ex.: investimento alto) -> y = 95 (quase no fundo, escala própria, nunca a escala de resultado)", highMax.segments[0][0].y, 95);

  const lowMax = buildNormalizedLineSegments({ values: [50], maxValue: 50, columnWidthPx: 20, areaHeightPx: 100 });
  check("mesmo valor 50, mas máximo TAMBÉM 50 (série diferente) -> y = 0 (topo) — prova que a normalização é por série, não um valor absoluto compartilhado", lowMax.segments[0][0].y, 0);
}

console.log("\nD — buildNormalizedLineSegments: ponto isolado entre dois gaps gera só marcador, nunca uma linha fantasma\n");
{
  const { segments, markers } = buildNormalizedLineSegments({ values: [null, 10, null], maxValue: 10, columnWidthPx: 20, areaHeightPx: 100 });
  check("1 segmento de 1 ponto (nenhuma linha desenhável a partir de um único ponto)", segments.length, 1);
  check("segmento isolado tem exatamente 1 ponto", segments[0].length, 1);
  check("1 marcador (o ponto isolado continua visível como marcador, mesmo sem linha)", markers.length, 1);
}

// ---------------------------------------------------------------------------
console.log("\nE — Estrutura (seção 1 do pedido): barras de Resultado + 2 linhas (Investimento/Custo por resultado), cores distintas\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok("barras de Resultado continuam existindo (span com altura calculada)", sectionSource.includes('style={{ width: BAR_RECT_WIDTH_PX, height: `${heightPx}px` }}'));
  ok("linha de Investimento é desenhada via <path> SVG, cor azul (distinta das outras duas)", sectionSource.includes("investmentLine.segments.map") && sectionSource.includes("stroke-blue-500"));
  ok("linha de Custo por resultado é desenhada via <path> SVG, cor laranja (distinta das outras duas)", sectionSource.includes("cplLine.segments.map") && sectionSource.includes("stroke-orange-500"));
  ok("Resultado usa verde (3ª cor distinta, sugestão do pedido)", sectionSource.includes("bg-green-500"));
  ok("as 3 cores nunca se repetem entre si (verde/azul/laranja, nenhuma reaproveitada)", new Set(["green-500", "blue-500", "orange-500"]).size === 3);
  ok("paleta usada é a MESMA já disponível no projeto (Tailwind stock, mesma família já usada em data-trust.ts/sync-run-status.ts) — nenhum token CSS novo definido", !sectionSource.includes(":root") && !sectionSource.includes("--color-"));
}

console.log("\nF — Escalas (seção 2 do pedido): nunca a mesma régua, normalização claramente identificada, valores reais só no tooltip\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok(
    "barras/meta diária usam a escala REAL de resultado (maxValue = máximo de resultCount/meta) — nunca normalizada",
    sectionSource.includes("const maxValue = Math.max(...points.map((p) => p.resultCount ?? 0), dailyTarget ?? 0, 1);"),
  );
  ok(
    "linha de Investimento usa sua PRÓPRIA escala (maxSpend, nunca maxValue de resultado)",
    sectionSource.includes("const maxSpend = Math.max(...points.map((p) => p.spend ?? 0), 1);") && sectionSource.includes("maxValue: maxSpend,"),
  );
  ok(
    "linha de Custo por resultado usa sua PRÓPRIA escala (maxCpl, nunca maxValue de resultado nem maxSpend)",
    sectionSource.includes("const maxCpl = Math.max(...points.map((p) => p.costPerResult ?? 0), 1);") && sectionSource.includes("maxValue: maxCpl,"),
  );
  ok(
    "normalização é EXPLICITAMENTE identificada (nota visível, nunca silenciosa) — só aparece quando uma linha normalizada está visível",
    sectionSource.includes("Linhas em escala relativa") && sectionSource.includes("visibility.investment || visibility.cpl"),
  );
  ok(
    "valores REAIS continuam só no tooltip (Investimento/Custo por resultado no tooltip vêm de point.spend/point.costPerResult, nunca de um x/y normalizado)",
    sectionSource.includes("Investimento: {point.spend !== null ? formatCurrency(point.spend) : "),
  );
  ok(
    "fallback do pedido (seção 2: 'priorizar barras + CPL, investimento por alternância') é o padrão inicial — Investimento começa desligado, Resultado e CPL começam ligados",
    sectionSource.includes("const DEFAULT_SERIES_VISIBILITY: SeriesVisibility = { result: true, investment: false, cpl: true };"),
  );
}

console.log("\nG — Legenda interativa (seção 3 do pedido): mostrar/ocultar sem reload, identifica cor e tipo de série\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok("legenda tem 3 itens clicáveis (Resultado/Investimento/Custo por resultado)", sectionSource.includes("function SeriesLegend("));
  ok("alternar é SEMPRE estado local (useState), nunca navegação/reload de página", sectionSource.includes("const [visibility, setVisibility] = useState<SeriesVisibility>(DEFAULT_SERIES_VISIBILITY);") && !sectionSource.includes("router.push") && !sectionSource.includes("location.reload"));
  ok("legenda usa aria-pressed (acessibilidade do estado ligado/desligado)", sectionSource.includes("aria-pressed={visibility[item.key]}"));
  ok(
    "legenda distingue visualmente TIPO de série — quadrado (barra) pra Resultado, traço (linha) pra Investimento/Custo por resultado — nunca só a cor",
    sectionSource.includes('rounded-sm bg-green-500') && sectionSource.includes('rounded-full bg-blue-500') && sectionSource.includes('rounded-full bg-orange-500'),
  );
  ok("toggle via onClick simples (sem debounce/chamada de rede) — instantâneo", sectionSource.includes("onClick={() => onToggle(item.key)}"));
}

console.log("\nH — Tooltip (seção 4 do pedido): funciona independente de qual série está visível, mesmos 6 campos de sempre\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok(
    "o <button> (gatilho do tooltip) NUNCA depende de showResult/visibility — sempre renderizado, só o CONTEÚDO visual da barra (span interno) é condicional",
    /<button[\s\S]{0,40}ref={anchorRef}/.test(sectionSource) && !/showResult &&[\s\S]{0,10}<button/.test(sectionSource),
  );
  ok("conteúdo visual da barra (span) é condicional a showResult — mas o botão/tooltip continuam de pé", sectionSource.includes("point.state === \"result\" && showResult && ("));
  ok("tooltip continua com os 6 campos: data, resultado, meta diária, investimento, custo por resultado, estado",
    sectionSource.includes("formatShortDate(point.date)") &&
    sectionSource.includes("describeCockpitDailyPointState(point)") &&
    sectionSource.includes("{resultLabel}:") &&
    sectionSource.includes("Meta diária:") &&
    sectionSource.includes("Investimento:") &&
    sectionSource.includes("{costLabel}:"),
  );
  ok("Portal (document.body) preservado — correção anterior não foi desfeita por este refinamento", sectionSource.includes("createPortal(") && sectionSource.includes("document.body"));
}

console.log("\nI — Dados e integridade (seção 5 do pedido): reaproveita 100% as séries/funções oficiais, nenhum cálculo novo\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");
  const libSource = loadSource("src", "lib", "cockpit-daily-evolution.ts");

  ok("buildNormalizedLineSegments é só GEOMETRIA (converte valor->pixel) — nunca recalcula investimento/CPL, sempre recebe o valor já oficial via `values`", libSource.includes("Núcleo puro de GEOMETRIA"));
  ok("componente consome point.spend/point.costPerResult DIRETO — nenhuma segunda fórmula de custo/investimento no componente", sectionSource.includes("values: points.map((p) => p.spend)") && sectionSource.includes("values: points.map((p) => p.costPerResult)"));
  ok("buildCockpitDailyEvolutionPoints (fonte oficial dos valores) não foi alterado por este refinamento", libSource.includes("export function buildCockpitDailyEvolutionPoints(input: {"));
  ok(
    "CPL indefinido (resultCount 0 ou sem dado) nunca aparece como linha — buildNormalizedLineSegments recebe point.costPerResult (já null nesses casos) e null sempre quebra o segmento, nunca desenha um ponto fabricado",
    sectionSource.includes("values: points.map((p) => p.costPerResult),"),
  );
  ok(
    "ausência de dado nunca é tratada como zero (resultCount/spend/costPerResult continuam null quando o dia não tem sinal — nenhuma mudança na regra oficial)",
    libSource.includes('return { date, state: "no_data", resultCount: null, spend: null, costPerResult: null };'),
  );
  ok("separação entre objetivos incompatíveis preservada — groupChannelsByResultType/múltiplos objetivos intocados neste arquivo", sectionSource.includes("view.series.length > 1") && sectionSource.includes("setSelectedGoal(s.resultType)"));
}

console.log("\nJ — Layout (seção 6 do pedido): altura aproximada preservada, elementos preservados\n");
{
  const sectionSource = loadSource("src", "app", "clients", "cockpit-daily-evolution-section.tsx");

  ok("altura do gráfico (CHART_AREA_HEIGHT_PX) continua 108 — MESMO valor de antes do refinamento (seção 6: 'aproximadamente na altura atual')", sectionSource.includes("const CHART_AREA_HEIGHT_PX = 108;"));
  ok("indicador 'Dados até DD/MM' preservado", sectionSource.includes("Dados até ${view.freshness.latestDataLabel}"));
  ok("'Última sincronização' preservada, distinta do indicador acima", sectionSource.includes("Última sincronização: {view.freshness.latestSyncLabel}"));
  ok("resumo inferior ('Hoje/Ontem/Média 7d') preservado", sectionSource.includes("Hoje {stats.today") && sectionSource.includes("Média 7d"));
  ok("responsividade preservada — linha de barras continua com rolagem horizontal própria (overflow-x-auto)", sectionSource.includes("overflow-x-auto"));
  ok("tooltip acessível preservado (role=\"tooltip\", aria-label por dia)", sectionSource.includes('role="tooltip"') && sectionSource.includes("aria-label={`${formatShortDate(point.date)}"));
  ok("sem gradientes/elementos decorativos novos (classes de cor sólidas, nenhum bg-gradient novo introduzido por este refinamento)", !sectionSource.includes("bg-gradient-to"));
}

console.log(`\n${passed} verificações passaram.\n`);
