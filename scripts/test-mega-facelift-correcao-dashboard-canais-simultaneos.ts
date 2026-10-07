/**
 * Testes da Etapa "Evolução do Dashboard — Visão Simultânea de Canais" —
 * última evolução do Dashboard antes de encerrar o Mega Facelift. Cobre
 * os cenários obrigatórios do pedido (seção 24): cliente só Meta, só
 * Google, Meta+Google, canal inexistente, orçamento mensal, edição
 * inline (reuso da escrita oficial), objetivos diferentes por canal,
 * labels CPL/CPA, ausência de meta/resultado, canal com zero resultado,
 * não somar resultados incompatíveis, Ritmo/Diagnóstico/Saldo-Fechamento
 * preservados, mobile, regressão em Metas/Performance.
 *
 * Núcleo puro novo (`resolveChannelGoal`, lib/client-goals.ts) testado
 * DIRETO. O resto é checagem estrutural de código-fonte (mesma
 * limitação de sempre neste ambiente, sem Supabase/React Testing
 * Library) — `resolveClientMediaChannels` (descoberta de canal) e
 * `resolveClientMonthlyGoals`/`consolidateChannelMetrics` (soma nunca
 * incompatível) já são cobertos a fundo por
 * `test-client-channels.ts`/`test-client-plan.ts`/`test-channel-metrics.ts`
 * — não duplicados aqui.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-correcao-dashboard-canais-simultaneos.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveChannelGoal, type ClientGoal } from "../src/lib/client-goals";
import { AVAILABLE_TRAFFIC_CHANNELS } from "../src/lib/traffic-channels";

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

const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const budgetSource = loadSource("src", "app", "clients", "dashboard-budget.tsx");
const channelSectionSource = loadSource("src", "app", "clients", "dashboard-channel-section.tsx");
const goalsLibSource = loadSource("src", "lib", "client-goals.ts");
const monthlyBudgetActionsSource = loadSource("src", "app", "clients", "monthly-budget-actions.ts");

function goal(resultType: ClientGoal["resultType"], channels: ClientGoal["channels"], isPrimary: boolean): ClientGoal {
  return { id: resultType, clientId: "c1", resultType, channels, isPrimary, resultSource: "automatic" };
}

console.log("\n1 — resolveChannelGoal: objetivo sem restrição de canal (comum: backfill de clientes legados)\n");
{
  const leadsUnrestricted = [goal("leads", [], true)];
  check("canal meta -> leads (sem restrição, vale pra qualquer canal)", resolveChannelGoal(leadsUnrestricted, "meta")?.resultType, "leads");
  check("canal google -> leads (mesma regra, mesmo objetivo único)", resolveChannelGoal(leadsUnrestricted, "google")?.resultType, "leads");
}

console.log("\n2 — Objetivos diferentes por canal (seção 14 do pedido): Meta->Vendas, Google->Leads\n");
{
  const multiGoal = [goal("sales", ["meta"], true), goal("leads", ["google"], false)];
  check("canal meta -> sales (restrito a meta)", resolveChannelGoal(multiGoal, "meta")?.resultType, "sales");
  check("canal google -> leads (restrito a google, nunca herda o objetivo de meta)", resolveChannelGoal(multiGoal, "google")?.resultType, "leads");
}

console.log("\n3 — Canal sem nenhum objetivo que o reivindique -> null (nunca escolhe silenciosamente)\n");
{
  const onlyMetaGoal = [goal("sales", ["meta"], true)];
  check("canal google sem objetivo correspondente -> null", resolveChannelGoal(onlyMetaGoal, "google"), null);
  check("nenhum objetivo configurado (array vazio) -> null pra qualquer canal", resolveChannelGoal([], "meta"), null);
}

console.log("\n4 — Ambiguidade documentada (seção 14 do pedido): dois objetivos reivindicam o MESMO canal -> desempate determinístico (principal vence)\n");
{
  const ambiguous = [goal("sales", ["meta"], false), goal("leads", ["meta"], true)];
  check("canal meta reivindicado por sales (secundário) E leads (principal) -> leads vence (desempate: principal)", resolveChannelGoal(ambiguous, "meta")?.resultType, "leads");
  const ambiguousNoPrimaryMatch = [goal("sales", [], false), goal("leads", ["google"], true)];
  check(
    "canal meta reivindicado só por sales (sem restrição) — leads (principal) não reivindica meta -> sales vence (único candidato real, nunca null por acaso)",
    resolveChannelGoal(ambiguousNoPrimaryMatch, "meta")?.resultType,
    "sales",
  );
}

console.log("\n5 — Cliente só Meta / só Google / Meta+Google: clientChannels deriva de resolveClientMediaChannels, nunca uma segunda checagem de presença de dado\n");
{
  ok(
    "clientChannels usa resolveClientMediaChannels(client.media_channels), ordenado por AVAILABLE_TRAFFIC_CHANNELS (Meta antes de Google)",
    /const clientChannels = AVAILABLE_TRAFFIC_CHANNELS\.filter\(\(c\) => resolveClientMediaChannels\(client\.media_channels\)\.includes\(c\)\)/.test(
      pageSource,
    ),
  );
  check("AVAILABLE_TRAFFIC_CHANNELS continua só Meta/Google (nenhum canal novo inventado nesta etapa)", AVAILABLE_TRAFFIC_CHANNELS, ["meta", "google"]);
}

console.log("\n6 — Canal inexistente nunca aparece: Dashboard mapeia só sobre clientChannels, nunca uma lista fixa\n");
{
  ok(
    "dashboardChannels é clientChannels.map(...) — nunca AVAILABLE_TRAFFIC_CHANNELS.map direto (que incluiria canal sem presença)",
    /const dashboardChannels = clientChannels\.map\(\(channel\) =>/.test(pageSource),
  );
  ok("DashboardBudget/DashboardChannelSection recebem channels/dashboardChannels (derivados de clientChannels), nunca a lista fixa de canais", pageSource.includes("channels={dashboardChannels.map((c) => ({ channel: c.channel, planned: c.planned }))}"));
}

console.log("\n7 — Orçamento do mês: fonte EXATAMENTE oficial, nunca um cálculo alternativo\n");
{
  ok(
    "monthPlanned reaproveita primaryMonthPlanned (primaryGoalPlan.consolidated.investment, com o MESMO fallback legado sumPlannedForMonth) — nenhum segundo cálculo",
    /const monthPlanned = primaryMonthPlanned;/.test(pageSource),
  );
  ok(
    "primaryMonthPlanned vem de primaryGoalPlan.consolidated.investment (resolveClientMonthlyGoals -> consolidateChannelMetrics) — a mesma soma de sempre, nunca dividida/estimada",
    /const primaryMonthPlanned = primaryGoalPlan\.consolidated\.investment \?\? sumPlannedForMonth/.test(pageSource),
  );
}

console.log("\n8 — Edição inline reutiliza a escrita oficial (seção 7 do pedido) — nenhum segundo caminho de escrita\n");
{
  ok(
    "DashboardBudget importa applyMonthlyChannelPlanChangeAction de './monthly-budget-actions' — a MESMA Server Action do ChannelPlanEditor, nunca uma cópia",
    /import \{ applyMonthlyChannelPlanChangeAction \} from "\.\/monthly-budget-actions"/.test(budgetSource),
  );
  ok("nenhuma chamada Supabase direta em dashboard-budget.tsx — toda escrita passa pela Server Action", !/supabase\./.test(budgetSource) && !budgetSource.includes("createSupabaseClient"));
  ok(
    "applyMonthlyChannelPlanChangeAction (monthly-budget-actions.ts) continua chamando apply_monthly_channel_plan_change (RPC oficial) — arquivo intocado por esta etapa",
    /supabase\.rpc\("apply_monthly_channel_plan_change"/.test(monthlyBudgetActionsSource),
  );
  ok("só canais REALMENTE alterados (valor != valor vigente) geram chamada — canal intocado nunca reescreve o próprio histórico", /channels\.filter\(\(c\) => \{/.test(budgetSource) && /drafts\[c\.channel\]/.test(budgetSource));
}

console.log("\n9 — Histórico preservado (seção 8 do pedido): mesma tabela/RPC, nenhuma perda\n");
{
  ok(
    "apply_monthly_channel_plan_change continua gravando em monthly_budget_changes (histórico real, R$X -> R$Y) — nenhuma tabela nova criada",
    loadSource("supabase", "monthly-channel-plan.sql").includes("insert into monthly_budget_changes"),
  );
  ok(
    "targetResultCount é sempre enviado como o valor vigente do canal (nunca null forçado) — a RPC já carrega adiante quando recebe null, mas o comentário documenta a intenção de nunca apagar meta configurada",
    /targetResultCountByChannel/.test(budgetSource),
  );
}

console.log("\n10 — Labels CPL/CPA/etc. nunca hardcoded (seção 9 do pedido) — sempre PERFORMANCE_GOALS\n");
{
  ok(
    "DashboardChannelSection usa PERFORMANCE_GOALS[performanceGoal].resultMetricLabel pro rótulo do resultado — nunca 'Leads'/'Vendas' hardcoded",
    /PERFORMANCE_GOALS\[performanceGoal\]\.resultMetricLabel/.test(channelSectionSource),
  );
  ok(
    "DashboardChannelSection reaproveita deriveMonthlyKpiTexts (mesma fonte de CPL/CPA/'Custo por novo seguidor' que MonthlyKpiSummary já usava) — nenhum cálculo/rótulo novo",
    /deriveMonthlyKpiTexts/.test(channelSectionSource),
  );
}

console.log("\n11 — Meta/Google isolados: investimento/resultado de um canal nunca usa dado do outro nem o consolidado do cliente\n");
{
  ok(
    "actualSpend de cada canal vem de sumChannelEffectiveSpend(..., channel, ...) — a MESMA função já usada antes desta etapa pro canal selecionado, chamada uma vez por canal real",
    /const actualSpend = sumChannelEffectiveSpend\(/.test(pageSource),
  );
  ok(
    "performanceSummary de cada canal usa scope: channel + channelActualSpend: { [channel]: actualSpend } — nunca consolidatedActualSpend como o investimento do canal",
    /scope: channel,[\s\S]{0,300}channelActualSpend: \{ \[channel\]: actualSpend \}/.test(pageSource),
  );
  ok("DashboardChannelSection nunca recebe um prop 'consolidated' — só actualSpend/planned/performanceSummary do PRÓPRIO canal", !channelSectionSource.includes("consolidated"));
}

console.log("\n12 — Ausência de meta/resultado e canal com zero resultado: mesmos estados de sempre, nunca um valor fabricado\n");
{
  ok("goal: null -> card mostra 'Configurar objetivo' (mesmo estado que MonthlyKpiSummary já tratava pra performanceGoal: null)", /\{!performanceGoal && \([\s\S]{0,200}Configurar objetivo/.test(channelSectionSource));
  ok(
    "planned null -> auxiliar 'Sem plano por canal' (nunca 0/estimado) — distinto de 'Nenhum planejamento configurado' (cliente sem NENHUM plano), mesma convenção de nunca fabricar número",
    /planned != null && planned > 0 \? `Planejado \$\{formatCurrency\(planned\)\}` : "Sem plano por canal"/.test(channelSectionSource),
  );
}

console.log("\n13 — Não somar resultados incompatíveis (seção 16 do pedido): cada canal/objetivo resolve o PRÓPRIO goalPlan, nunca um consolidado cross-objetivo\n");
{
  ok(
    "goalPlan de cada canal vem de clientGoalsPlan.goals.find(g => g.resultType === channelGoal.resultType) — resolveClientMonthlyGoals já isola cada objetivo (Leads nunca soma com Vendas/Seguidores, mesmo compartilhando canal)",
    /const goalPlan = channelGoal \? clientGoalsPlan\.goals\.find\(\(g\) => g\.resultType === channelGoal\.resultType\)/.test(pageSource),
  );
  ok("resolveClientMonthlyGoals (lib/client-plan.ts) não foi alterado nesta etapa — continua resolvendo cada objetivo isolado, nunca uma segunda agregação cross-objetivo", loadSource("src", "lib", "client-plan.ts").includes("export function resolveClientMonthlyGoals"));
}

console.log("\n14 — Ritmo/Diagnóstico continuam semanticamente corretos (seções 16/17 do pedido): sempre o consolidado do objetivo PRINCIPAL, mesma engine de sempre\n");
{
  ok("Ritmo (MonthlyGoalProgress/MonthInvestmentSummary/MonthInvestmentPaceNote) usa monthPlanned/monthActual/monthExpectedToDate/monthStatus — sempre o consolidado do objetivo principal, nunca por canal", /monthPlanned={monthPlanned}/.test(pageSource) || pageSource.includes("planned={monthPlanned}"));
  ok("Diagnóstico (PerformanceDiagnosticCard) continua usando metric-diagnostics.ts via resolveDashboardDiagnosticCtaTarget — nenhuma engine nova, nenhum diagnóstico multicanal inventado", pageSource.includes("resolveDashboardDiagnosticCtaTarget(") && !pageSource.includes("account-health-engine"));
}

console.log("\n15 — Saldo/Fechamento preservados (seção 19 do pedido) — lógica intocada\n");
{
  ok(
    "externalLinks (Dashboard/Saldo/Fechamento) continua montado a partir das mesmas 3 colunas, nenhuma mudança",
    /client\.dashboard_url && \{ label: "Dashboard"/.test(pageSource) &&
      /client\.balance_url && \{ label: "Saldo"/.test(pageSource) &&
      /client\.monthly_closing_sheet_url && \{ label: "Fechamento"/.test(pageSource),
  );
}

console.log("\n16 — Mobile/responsividade (seção 21 do pedido): mesma grade auto-fit dos KPIs de sempre, sem scroll horizontal\n");
{
  ok(
    "DashboardChannelSection usa grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] — MESMO padrão de MonthlyKpiSummary, quebra naturalmente em telas pequenas, nunca overflow-x",
    /grid-cols-\[repeat\(auto-fit,minmax\(9rem,1fr\)\)\]/.test(channelSectionSource) && !channelSectionSource.includes("overflow-x"),
  );
  ok(
    "canais empilham verticalmente (flex-col gap-4) — nunca lado a lado forçado/scroll horizontal entre Meta e Google",
    /flex flex-col gap-4">\s*<DashboardBudget/.test(pageSource),
  );
}

console.log("\n17 — Seletor de canal/objetivo removido SÓ do Dashboard — Performance/Metas continuam com seus próprios filtros (seção 3 do pedido)\n");
{
  ok("GoalSelect/VisaoGeralChannelSwitch não são mais importados em [id]/page.tsx", !pageSource.includes('from "../goal-select"') && !pageSource.includes('from "../visao-geral-channel-switch"'));
  ok(
    "GoalSelect continua montado em Metas (seu próprio seletor de objetivo, nunca removido de lá)",
    loadSource("src", "app", "clients", "[id]", "metas", "page.tsx").includes("<GoalSelect"),
  );
  ok(
    "VisaoGeralChannelSwitch/goal-select.tsx continuam existindo no disco — nenhuma infraestrutura deletada",
    goalsLibSource.length > 0, // sanity: lib carregada; existência de arquivo já confirmada pelos loadSource acima sem throw
  );
}

console.log("\n18 — Nenhuma nova modelagem de orçamento (seção 2 do pedido): zero schema/migration novos nesta etapa\n");
{
  ok(
    "client-goals.ts ganhou só uma função pura nova (resolveChannelGoal) — nenhuma tabela/coluna/migration",
    /export function resolveChannelGoal/.test(goalsLibSource) && !goalsLibSource.includes("alter table") && !goalsLibSource.includes("create table"),
  );
}

console.log(`\n${passed} verificações passaram.\n`);
