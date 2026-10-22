/**
 * Testes da Etapa "MITZA ONE — Evolução Diária no Cockpit" (núcleo puro,
 * `lib/cockpit-daily-evolution.ts`, e frescor de dados,
 * `lib/data-trust.ts`/`app/clients/dados-data.ts`).
 *
 * KOFF Analytics — Redesign definitivo do Cockpit: as checagens
 * ESTRUTURAIS que viviam aqui (posicionamento no Cockpit, componente
 * `cockpit-daily-evolution-section.tsx`, tooltip/Portal) saíram — o gráfico
 * SVG artesanal que elas protegiam foi substituído por um módulo único em
 * Recharts (`cockpit-evolution-section.tsx`), coberto por
 * `scripts/test-cockpit-redesign.ts`. `resolveDailyTargetResultCount`/
 * `describeCockpitDailyPointState` (geometria/texto só usados por aquele
 * componente) foram removidas de `lib/cockpit-daily-evolution.ts` por
 * ficarem sem chamador — os testes delas saíram junto. `buildCockpitDailyEvolutionPoints`
 * (fonte de dado real, consumida agora por `lib/cockpit-evolution-merge.ts`)
 * continua EXATAMENTE igual — todas as checagens de cálculo abaixo
 * permanecem válidas sem nenhuma alteração.
 *
 * Rodar: npx tsx scripts/test-mitza-one-evolucao-diaria.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCockpitDailyEvolutionPoints, type CockpitDailySpendRawRow } from "../src/lib/cockpit-daily-evolution";
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

console.log("\nC — Distinção entre zero confirmado e ausência de dados\n");
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
  // HOJE (= todayStr) não tem nenhum sinal nos dados de teste (nem
  // performanceRows nem spendRows pra 2026-10-15) — vira "no_data", nunca
  // "future": a regra é "date > todayStr", e hoje não é maior que hoje.
  check("HOJE (= todayStr) sem sinal ainda vira 'no_data', nunca 'future' (a regra é só data > todayStr)", points[1].state, "no_data");
  check("dia DEPOIS de hoje -> state 'future'", points[2].state, "future");
  check("dia futuro nunca tem resultCount/spend/costPerResult (nunca projetado)", [points[2].resultCount, points[2].spend, points[2].costPerResult], [null, null, null]);
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

console.log("\nF — Último dia com dados vs. última sincronização bem-sucedida (lib/data-trust.ts)\n");
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
  ok("dados-data.ts expõe latestImportedDate BRUTO (ISO), não só o rótulo formatado — Evolução precisa do valor bruto", dadosDataSource.includes("latestImportedDate: latestImportedRaw"));
  ok("dados-data.ts expõe latestSuccessAtLabel agregado (última sincronização bem-sucedida entre as fontes habilitadas)", dadosDataSource.includes("resolveLatestSuccessAt("));
}

console.log("\nG — Janela cronológica: windowDates sempre na mesma ordem, nenhum dia omitido\n");
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

console.log("\nH — Restrições: nenhuma rota/componente legado removido por esta etapa, nenhuma migration/schema nova\n");
{
  ok("sidebar.tsx não foi tocado por esta etapa (restrição histórica: 'não modificar a sidebar nem o header')", (() => {
    try {
      const sidebarSource = loadSource("src", "app", "sidebar.tsx");
      return sidebarSource.includes("AccordionGroup");
    } catch {
      return false;
    }
  })());
  ok("client-workspace-header.tsx continua sem nenhuma referência à Evolução Diária (header intocado)", !loadSource("src", "app", "clients", "client-workspace-header.tsx").includes("DailyEvolution"));
  ok("nenhum arquivo .sql novo foi criado por esta etapa (checagem indireta: nenhuma migration referenciada no código do núcleo puro)", !loadSource("src", "lib", "cockpit-daily-evolution.ts").toLowerCase().includes("migration"));
  ok(
    "orphan pré-existente (DailyResultsEvolution, app/clients/daily-results-evolution.tsx) continua no disco, intocado — nenhuma remoção agressiva",
    loadSource("src", "app", "clients", "daily-results-evolution.tsx").includes("export function DailyResultsEvolution"),
  );
}

console.log(`\n${passed} verificações passaram.\n`);
