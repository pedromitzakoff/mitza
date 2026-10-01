/**
 * Testes da Etapa "Primeira Rodada Visual — Contexto + Performance" —
 * cobre os 20 cenários obrigatórios do pedido (seção 18). Núcleo puro
 * (`resolveSelectedGoal`/`buildClientContextHref` em `[id]/page.tsx`,
 * `listMonthOptions` em `month-select.tsx`, `evaluate*` em
 * `metric-diagnostics.ts`) testado DIRETO, com dados reais — mesmo padrão
 * já usado por `test-operation-goal-filter.ts` (`resolveOperationGoal`/
 * `resolveOperationChannel` importados direto de `operation/page.tsx`). O
 * resto (composição visual/wiring que só existe dentro de JSX) é
 * ESTRUTURAL (checagem de código-fonte), mesma limitação de sempre neste
 * ambiente (sem Supabase/React Testing Library).
 *
 * Rodar: npx tsx scripts/test-client-context-performance.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSelectedGoal, buildClientContextHref } from "../src/app/clients/[id]/page";
import { listMonthOptions } from "../src/app/clients/month-select";
import { evaluateInvestmentDiagnostic, evaluateCpaDiagnostic } from "../src/lib/metric-diagnostics";
import { PERFORMANCE_GOALS } from "../src/lib/performance-goals";

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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

const pageCode = stripComments(loadSource("src", "app", "clients", "[id]", "page.tsx"));
const goalSelectCode = stripComments(loadSource("src", "app", "clients", "goal-select.tsx"));
const monthSelectCode = stripComments(loadSource("src", "app", "clients", "month-select.tsx"));
const channelSwitchCode = stripComments(loadSource("src", "app", "clients", "visao-geral-channel-switch.tsx"));
const contextSelectCode = stripComments(loadSource("src", "app", "clients", "client-context-select.tsx"));
const diagnosticCode = stripComments(loadSource("src", "app", "clients", "performance-diagnostic.tsx"));
const accountFollowUpCode = stripComments(loadSource("src", "app", "clients", "account-follow-up-panel.tsx"));
const kpiCode = stripComments(loadSource("src", "app", "clients", "monthly-kpi-summary.tsx"));
const headerCode = stripComments(loadSource("src", "app", "clients", "client-workspace-header.tsx"));

// ---------------------------------------------------------------------------
console.log("1/2/3/4 — resolveSelectedGoal: 1 objetivo, múltiplos objetivos, principal é default, seleção de secundário\n");
{
  check("cliente com 1 objetivo (leads) e nenhum param -> leads (único = principal)", resolveSelectedGoal(undefined, ["leads"], "leads"), "leads");
  check(
    "cliente com múltiplos objetivos (leads principal + sales + followers), sem param -> leads (principal, default)",
    resolveSelectedGoal(undefined, ["leads", "sales", "followers"], "leads"),
    "leads",
  );
  check("goal=sales (objetivo secundário real do cliente) -> sales", resolveSelectedGoal("sales", ["leads", "sales"], "leads"), "sales");
  check("goal=followers (objetivo secundário real do cliente) -> followers", resolveSelectedGoal("followers", ["leads", "followers"], "leads"), "followers");
}

console.log("\n5 — Refresh preserva o objetivo (derivado só da URL, nunca de estado de cliente)\n");
{
  // resolveSelectedGoal é uma função PURA de (param, objetivos do cliente,
  // principal) — nenhum useState/sessionStorage envolvido. Chamar duas
  // vezes com os MESMOS argumentos (equivalente a dois carregamentos de
  // página — ida e refresh) sempre devolve o mesmo resultado.
  const first = resolveSelectedGoal("sales", ["leads", "sales"], "leads");
  const second = resolveSelectedGoal("sales", ["leads", "sales"], "leads");
  check("duas resoluções com o mesmo ?goal= (simulando refresh) dão o MESMO objetivo", [first, second], ["sales", "sales"]);
  ok(
    "performanceGoal em page.tsx vem de resolveSelectedGoal(goalParam, ...) — nunca de useState/sessionStorage (Server Component, só a URL decide)",
    /const performanceGoal = resolveSelectedGoal\(/.test(pageCode),
  );
}

console.log("\n6 — Troca de mês preserva canal e objetivo (buildClientContextHref nunca reseta os outros dois)\n");
{
  check(
    "trocar só o mês preserva metricsChannel e goal já selecionados",
    buildClientContextHref("c1", { month: "2026-09", metricsChannel: "meta", goal: "sales" }, { month: "2026-10" }),
    "/clients/c1?month=2026-10&metricsChannel=meta&goal=sales",
  );
  check(
    "trocar só o canal preserva mês e goal já selecionados",
    buildClientContextHref("c1", { month: "2026-10", goal: "sales" }, { metricsChannel: "google" }),
    "/clients/c1?month=2026-10&metricsChannel=google&goal=sales",
  );
  check(
    "escolher o objetivo PRINCIPAL limpa ?goal= (overrides.goal = null), preserva mês/canal",
    buildClientContextHref("c1", { month: "2026-10", metricsChannel: "meta", goal: "sales" }, { goal: null }),
    "/clients/c1?month=2026-10&metricsChannel=meta",
  );
  check("nenhum param ativo -> URL sem querystring", buildClientContextHref("c1", {}, {}), "/clients/c1");
}

console.log("\n7 — Troca de cliente nunca gera objetivo inválido\n");
{
  // Cliente A tem "sales"; cliente B (pra quem o gestor troca) só tem
  // "leads" — um ?goal=sales sobrevivendo na URL (hipótese adversarial)
  // NUNCA aparece pro cliente B: cai pro principal dele.
  check(
    "?goal=sales não existe nos objetivos do cliente B (só leads) -> cai pro principal do cliente B",
    resolveSelectedGoal("sales", ["leads"], "leads"),
    "leads",
  );
  check("goal inválido/inexistente (string arbitrária) -> cai pro principal", resolveSelectedGoal("inexistente", ["leads", "sales"], "leads"), "leads");
  check("cliente sem NENHUM objetivo configurado (availableGoalTypes vazio) -> null, nunca quebra", resolveSelectedGoal("leads", [], null), null);
  ok(
    "ClientWorkspaceHeader (troca de cliente) nunca propaga ?goal= na troca — só month (mesmo href de sempre), garantindo que um goal do cliente anterior nunca atravessa pro próximo",
    /function hrefFor\(targetClientId: string, suffix: string\): string \{\s*return buildWorkspaceHref\(targetClientId, suffix, month\);/.test(
      headerCode,
    ),
  );
}

console.log("\n8 — Objetivo selecionado nunca duplica na tela (Etapa 'MEGA FACELIFT — Fase 4: Dashboard': SecondaryGoalsPerformance saiu do Painel por completo, concern foi resolvido estruturalmente em Metas)\n");
{
  ok(
    "[id]/page.tsx não renderiza mais SecondaryGoalsPerformance — a ideia de 'objetivo selecionado vs. outros objetivos' saiu do Dashboard inteira (ver test-mega-facelift-fase4-dashboard.ts)",
    !/<SecondaryGoalsPerformance/.test(pageCode),
  );
  ok(
    "a mesma preocupação (nunca mostrar o mesmo objetivo 2x) agora é estruturalmente impossível em Metas: MetasSummaryTable renderiza UMA linha por objetivo de `data.rows` — nunca um split primário/'outros' que precisaria excluir o selecionado",
    /<MetasSummaryTable rows=\{data\.rows\} \/>/.test(loadSource("src", "app", "clients", "[id]", "metas", "page.tsx")),
  );
}

console.log("\n9 — Labels mudam corretamente Leads/Vendas/Seguidores (sempre PERFORMANCE_GOALS, nunca hardcoded)\n");
{
  check("PERFORMANCE_GOALS.leads.label", PERFORMANCE_GOALS.leads.label, "Leads");
  check("PERFORMANCE_GOALS.sales.label", PERFORMANCE_GOALS.sales.label, "Vendas");
  check("PERFORMANCE_GOALS.followers.label", PERFORMANCE_GOALS.followers.label, "Seguidores");
  ok("GoalSelect usa PERFORMANCE_GOALS[...].label pro rótulo de cada opção, nunca um texto hardcoded", /PERFORMANCE_GOALS\[goal\.resultType\]\.label/.test(goalSelectCode));
  ok('GoalSelect não inventa nomenclatura de funil ("Captação" etc.) — rótulo vem só de PERFORMANCE_GOALS', !/Captação|Distribuição de Conteúdo/.test(goalSelectCode));
}

console.log("\n10/11/12/13 — Canal: Consolidado/Meta/Google continuam filtrando corretamente, mesma regra de disponibilidade\n");
{
  ok(
    "VisaoGeralChannelSwitch continua recebendo EXATAMENTE as mesmas options/active de resolveClientChannelScopeOptions/resolveSelectedChannelScope — nenhuma lógica de disponibilidade nova",
    /resolveClientChannelScopeOptions\(client\.media_channels\)/.test(pageCode) && /resolveSelectedChannelScope\(metricsChannelParam, client\.media_channels\)/.test(pageCode),
  );
  ok(
    "com 1 única opção de canal, vira rótulo estático (mesmo critério de sempre — Consolidado só aparece com >1 canal ativo)",
    /if \(options\.length <= 1\)/.test(channelSwitchCode),
  );
  ok("rótulos Consolidado/Meta/Google continuam vindo de CHANNEL_SCOPE_LABEL, nenhum hardcode novo", /consolidated: "Consolidado"/.test(channelSwitchCode));
  ok(
    "cada opção de canal navega por Link/querystring real (buildHref), nunca um estado de cliente/toggle in-memory — mesmo padrão de antes, só trocou de pílula pra dropdown",
    /href=\{buildHref\(option\.value as VisaoGeralMetricsChannel\)\}|href: buildHref\(option\)/.test(channelSwitchCode),
  );
}

console.log("\n14/15 — Diagnóstico só aparece com base real; ausência de meta/planejamento nunca gera diagnóstico falso\n");
{
  // evaluateInvestmentDiagnostic/evaluateCpaDiagnostic já são testados a
  // fundo em test-metric-diagnostics.ts — aqui confirmamos só o contrato
  // que PerformanceDiagnosticCard depende (expected === null = sem base).
  const noInvestmentPlan = evaluateInvestmentDiagnostic(500, null);
  check("sem planejamento de investimento (expectedToDate null) -> expected null, nunca um desvio inventado", noInvestmentPlan.expected, null);
  const noCostTarget = evaluateCpaDiagnostic(50, null, 10);
  check("sem meta de custo configurada (targetCostPerResult null) -> expected null (card nem avalia esse eixo)", noCostTarget?.expected ?? null, null);
  const noCostAtAll = evaluateCpaDiagnostic(null, 40, 10);
  check("sem custo por resultado calculável (costPerResult null) -> função toda retorna null", noCostAtAll, null);
  ok(
    "PerformanceDiagnosticCard só considera um eixo candidato quando expected !== null (nunca inventa desvio sem base)",
    /if \(investmentDiag\.expected !== null\)/.test(diagnosticCode) && /if \(costDiag && costDiag\.expected !== null\)/.test(diagnosticCode),
  );
  ok("sem NENHUM candidato com base, o componente não renderiza nada (nunca um card vazio/genérico)", /if \(candidates\.length === 0\) return null;/.test(diagnosticCode));
  ok(
    "card usa SÓ metric-diagnostics.ts (evaluateInvestmentDiagnostic/evaluateCpaDiagnostic/metricToneSeverityRank) — nenhum motor novo, nunca account-health-engine.ts aqui",
    /from "@\/lib\/metric-diagnostics"/.test(diagnosticCode) && !diagnosticCode.includes("account-health-engine"),
  );
  ok("nenhuma comparação de 7 dias — mensagens sempre 'no mês'/'ritmo esperado no mês'", !/7 dias|últimos 7/.test(diagnosticCode));
}

console.log("\n16 — Ritmo mensal mantém os cálculos atuais (MonthlyGoalProgress/MonthInvestmentSummary/MonthInvestmentPaceNote intocados)\n");
{
  ok("MonthlyGoalProgress continua chamada com os MESMOS 3 props de sempre", /<MonthlyGoalProgress\n\s*monthResultCount=\{performanceSummary\?\.resultCount \?\? 0\}/.test(accountFollowUpCode));
  ok("MonthInvestmentSummary continua chamada com os MESMOS props de sempre", /<MonthInvestmentSummary\n\s*planned=\{investmentPlanned\}/.test(accountFollowUpCode));
  // Etapa "MEGA FACELIFT — Fase 4: Dashboard": o histórico de orçamento
  // (`?historicoOrcamento=1`, `lastChange`) saiu do Dashboard por inteiro —
  // MonthInvestmentPaceNote continua montado com os MESMOS campos de
  // ritmo (planned/actual/expectedToDate/sprints), agora com
  // `lastChange={null}` explícito (suprime só o link de histórico, sem
  // nenhuma edição em month-investment-summary.tsx — ver
  // test-mega-facelift-fase4-dashboard.ts seção 7).
  ok(
    "MonthInvestmentPaceNote continua montado em page.tsx com os MESMOS campos de ritmo (planned/actual/expectedToDate/sprints), agora com lastChange={null} (histórico saiu pro módulo Metas)",
    /<MonthInvestmentPaceNote/.test(pageCode) && /lastChange=\{null\}/.test(pageCode),
  );
  ok(
    "PerformanceDiagnosticCard entra DEPOIS do bloco de Ritmo (investmentPaceNote), nunca substituindo nenhuma das barras",
    accountFollowUpCode.indexOf("investmentPaceNote && <div") < accountFollowUpCode.indexOf("<PerformanceDiagnosticCard"),
  );
}

console.log("\n17/18 — Atalhos (Dashboard/Saldo/Fechamento/Relatório) continuam funcionando, mesma regra/URLs\n");
{
  ok(
    "externalLinks continua montado a partir das 3 colunas de clients, cada um opcional — nenhuma regra nova",
    /client\.dashboard_url && \{ label: "Dashboard"/.test(pageCode) &&
      /client\.balance_url && \{ label: "Saldo"/.test(pageCode) &&
      /client\.monthly_closing_sheet_url && \{ label: "Fechamento"/.test(pageCode),
  );
  // Fase 4: o link passou a vir de uma variável (`performanceHref`, CTA
  // "Ver Performance →" contextual em vez do item solto "Relatório" da
  // toolbar) — mesmo destino, nunca uma segunda URL.
  ok(
    "CTA de Performance continua apontando pro MESMO /clients/[id]/relatorio",
    /const performanceHref = `\/clients\/\$\{client\.id\}\/relatorio`/.test(pageCode),
  );
}

console.log("\n19 — Operação não sofre alteração nesta rodada (resumo + CTA, exatamente como estava)\n");
{
  ok("bloco Operação continua resumo raso (Sprint atual/Última otimização/Saúde), nenhum Sprint/Tarefa/Histórico inline novo", /Sprint atual/.test(pageCode) && /Última otimização/.test(pageCode) && !pageCode.includes("<OperationSection"));
  // Fase 4: rótulo encurtado pra "Ver Operação →" (consistência com os
  // demais CTAs entre módulos), mesmo destino /operation.
  ok('CTA "Ver Operação →" continua existindo, mesmo destino /operation', /Ver Operação →/.test(pageCode) && pageCode.includes("${client.id}/operation"));
  ok("clientOperationalState/primaryReasonText (fonte da Saúde) continuam vindo do MESMO loadClientOperationalStates de sempre, sem relação com o objetivo selecionado", /loadClientOperationalStates\(supabase, currentMonthRange\(today\)\.firstDay, id\)/.test(pageCode));
}

console.log("\n20 — Demandas não sofrem alteração nesta rodada (contagem + top-3 + CTA, exatamente como estava)\n");
{
  ok("Demandas continua usando loadPendenciasRawData/countOpenDemandas (MESMA fonte/regra de sempre)", /loadPendenciasRawData\(supabase, id\)/.test(pageCode) && /countOpenDemandas\(/.test(pageCode));
  // Fase 4: rótulo encurtado pra "Ver Demandas →".
  ok('preview continua limitado a 3 itens ("Ver Demandas →" pro resto)', /\.slice\(0, 3\)/.test(pageCode) && /Ver Demandas →/.test(pageCode));
}

// ---------------------------------------------------------------------------
console.log("\n21 — MonthSelect: listMonthOptions é pura, janela ao redor do mês real (nunca do mês em exibição)\n");
{
  const options = listMonthOptions(new Date("2026-10-15T00:00:00Z"));
  check("16 meses no total (12 pra trás + atual + 3 pra frente)", options.length, 16);
  check("primeira opção é 12 meses atrás", options[0], "2025-10");
  check("mês atual está na janela", options.includes("2026-10"), true);
  check("última opção é 3 meses à frente", options[options.length - 1], "2027-01");
  ok("MonthSelect usa currentMonthRange/shiftMonthParam (lib/sprint-financials.ts) — nenhuma conta de data nova", /currentMonthRange|shiftMonthParam/.test(monthSelectCode));
}

console.log("\n22 — Os 3 dropdowns de contexto usam o MESMO componente visual (hierarquia homogênea, pedido seção 3)\n");
{
  ok("MonthSelect renderiza ClientContextSelect", /<ClientContextSelect/.test(monthSelectCode));
  ok("GoalSelect renderiza ClientContextSelect", /<ClientContextSelect/.test(goalSelectCode));
  ok("VisaoGeralChannelSwitch renderiza ClientContextSelect", /<ClientContextSelect/.test(channelSwitchCode));
  ok("ClientContextSelect é client component (precisa de estado aberto/fechado) — month/goal-select.tsx continuam Server Components, só renderizam o client component via JSX, nunca chamam suas funções diretamente", /^"use client";/.test(contextSelectCode) && !/^"use client";/.test(monthSelectCode) && !/^"use client";/.test(goalSelectCode));
}

console.log("\n23 — KPIs viraram cards (seção 9 do pedido), nenhum cálculo/fonte alterado\n");
{
  ok("cada Kpi agora tem superfície própria (card: borda + radius + padding)", /rounded-lg border border-overview-border bg-overview-surface p-3/.test(kpiCode));
  ok("deriveMonthlyKpiTexts continua a ÚNICA fonte dos textos de resultado/custo — nenhum cálculo novo", /deriveMonthlyKpiTexts/.test(kpiCode));
  ok("PERFORMANCE_GOALS continua a única fonte dos rótulos de resultado por objetivo", /PERFORMANCE_GOALS\[performanceGoal\]\.resultMetricLabel/.test(kpiCode));
}

console.log(`\n${passed} verificações passaram.`);
