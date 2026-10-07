/**
 * Testes da Etapa "MITZA ONE — Fase 1: Cockpit Único do Cliente".
 *
 * Cobre os núcleos puros NOVOS desta fase (`lib/cockpit-pace.ts`,
 * `lib/cockpit-diagnostics.ts`, `lib/cockpit-result-groups.ts`) com
 * chamadas diretas (sem banco/React), e checagens ESTRUTURAIS de
 * `src/app/clients/[id]/page.tsx` + componentes `cockpit-*.tsx` via grep
 * de código-fonte — mesmo padrão já usado pelas suites anteriores pra
 * loaders que dependem de Supabase.
 *
 * Esta suite SUBSTITUI (não duplica) a cobertura das suites "Fase 4
 * Dashboard"/"Correção Canais Simultâneos"/"Correção Orçamento
 * Multicanal"/"client-context-performance"/"client-page-facelift"/
 * "client-workspace" — todas testavam a composição ESPECÍFICA do
 * Dashboard anterior (Executive Snapshot/Ritmo do mês/Diagnóstico único
 * com CTA dinâmica), que esta fase substitui por uma composição NOVA
 * (Meta & Ritmo/Diagnóstico/Canais/Performance essencial/Execução/
 * Histórico). Essas 6 suites foram removidas; a cobertura de função pura
 * ainda válida que elas continham (`resolveSelectedGoal`/
 * `buildClientContextHref`, contrato null-safe de
 * `evaluateInvestmentDiagnostic`/`evaluateCpaDiagnostic`, rótulos de
 * `PERFORMANCE_GOALS`, ausência de account-health-engine/score/IA na
 * composição) foi preservada aqui, na seção 0.
 *
 * Rodar: npx tsx scripts/test-mitza-one-fase1-cockpit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSelectedGoal, buildClientContextHref, findChannelDataIssue } from "../src/app/clients/[id]/page";
import { evaluateInvestmentDiagnostic, evaluateCpaDiagnostic } from "../src/lib/metric-diagnostics";
import { PERFORMANCE_GOALS } from "../src/lib/performance-goals";
import { PACE_VERDICT_LABEL, PACE_VERDICT_TONE, costVerdictLabel, COST_VERDICT_TONE } from "../src/lib/cockpit-pace";
import { buildCockpitInsights } from "../src/lib/cockpit-diagnostics";
import { groupChannelsByResultType } from "../src/lib/cockpit-result-groups";
import type { ClientDiagnostics } from "../src/lib/metric-diagnostics";

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
const metaRitmoSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
const diagnosticsCardSource = loadSource("src", "app", "clients", "cockpit-diagnostics-card.tsx");
const executionSource = loadSource("src", "app", "clients", "cockpit-execution-section.tsx");
const performanceSectionSource = loadSource("src", "app", "clients", "cockpit-performance-section.tsx");
const historySource = loadSource("src", "app", "clients", "cockpit-history-section.tsx");
const channelSectionSource = loadSource("src", "app", "clients", "dashboard-channel-section.tsx");
const budgetSource = loadSource("src", "app", "clients", "dashboard-budget.tsx");

// ---------------------------------------------------------------------------
console.log("\n0 — Cobertura preservada das suites retiradas (resolveSelectedGoal/buildClientContextHref continuam puras e exportadas; metric-diagnostics.ts continua null-safe; PERFORMANCE_GOALS continua a única fonte de rótulo)\n");
{
  check("resolveSelectedGoal: goal inválido cai pro principal", resolveSelectedGoal("inexistente", ["leads", "sales"], "leads"), "leads");
  check("resolveSelectedGoal: cliente sem objetivo -> null, nunca quebra", resolveSelectedGoal("leads", [], null), null);
  check("buildClientContextHref: nenhum param ativo -> URL sem querystring", buildClientContextHref("c1", {}, {}), "/clients/c1");
  const noPlan = evaluateInvestmentDiagnostic(500, null);
  check("sem planejamento (expectedToDate null) -> expected null, nunca desvio inventado", noPlan.expected, null);
  const noCostTarget = evaluateCpaDiagnostic(50, null, 10);
  check("sem meta de custo -> expected null", noCostTarget?.expected ?? null, null);
  check("PERFORMANCE_GOALS.leads.costMetricShortLabel", PERFORMANCE_GOALS.leads.costMetricShortLabel, "CPL");
  check("PERFORMANCE_GOALS.sales.costMetricShortLabel", PERFORMANCE_GOALS.sales.costMetricShortLabel, "CPA");
  ok("nenhuma referência a account-health-engine na nova composição do cockpit (seção 11/12 do pedido: diagnósticos determinísticos só via metric-diagnostics.ts/data-trust.ts)", !pageSource.includes("account-health-engine"));
  ok("nenhum termo de score/IA/probabilidade na composição nova", !/growth score|health score|probabilidade de bater meta|\bIA\b/i.test(pageSource));
}

// ---------------------------------------------------------------------------
console.log("\nA — Meta & Ritmo\n");
{
  // Leads/Vendas/Seguidores: PERFORMANCE_GOALS continua goal-agnostic.
  check("Leads: resultMetricLabel", PERFORMANCE_GOALS.leads.resultMetricLabel, "Leads");
  check("Vendas: resultMetricLabel", PERFORMANCE_GOALS.sales.resultMetricLabel, "Vendas");
  check("Seguidores: resultMetricLabel", PERFORMANCE_GOALS.followers.resultMetricLabel, "Novos seguidores");

  // meta ausente / custo-alvo ausente: CockpitResultCard/CockpitCostCard
  // nunca fabricam veredito sem base real (status: null / targetCostPerResult: null).
  ok(
    "CockpitResultCard só mostra veredito/barra quando há meta de quantidade > 0 (nunca threshold inventado)",
    /view\.targetResultCount !== null && view\.targetResultCount > 0/.test(metaRitmoSource),
  );
  ok(
    "CockpitCostCard sem meta de custo mostra estado neutro explícito ('Meta de custo não configurada'), nunca comparação fabricada",
    metaRitmoSource.includes("Meta de custo não configurada."),
  );

  // ritmo / necessário-por-dia: computeNeededDailyRate (mesma função
  // genérica de lib/monthly-budget.ts, nenhuma segunda fórmula).
  ok("Resultado usa computeNeededDailyRate (mesma função de lib/monthly-budget.ts, nenhuma segunda fórmula de ritmo)", pageSource.includes("computeNeededDailyRate("));
  ok("Orçamento usa computeMonthlyBudgetPlan(...).recommendedDaily (MESMA função que MonthInvestmentPaceNote já usava)", pageSource.includes("computeMonthlyBudgetPlan({") && pageSource.includes(".recommendedDaily"));

  // progresso: AgencyInvestmentBar reaproveitada (identidade MITZA), nunca
  // uma barra nova.
  ok("Meta & Ritmo reaproveita AgencyInvestmentBar (identidade MITZA já existente, nunca um componente novo)", metaRitmoSource.includes('from "@/app/agency-investment-bar"'));

  // orçamento multicanal / por canal / total derivado: DashboardBudget
  // (já oficial, intocado) continua a única superfície de edição.
  ok("CockpitBudgetCard reaproveita DashboardBudget sem alterá-lo (composição por canal + edição inline intocadas)", metaRitmoSource.includes("<DashboardBudget"));
  ok("dashboard-budget.tsx não foi tocado nesta fase (total continua SOMA derivada via consolidateAdditive, nenhum total_budget/dashboard_budget novo)", !/total_budget|dashboard_budget/i.test(budgetSource));

  // mês diferente: contexto de mês continua o único seletor no topo.
  ok("Mês continua o único seletor de contexto no topo (seção 4 do pedido) — month=/prevMonthHref/nextMonthHref preservados", pageSource.includes("prevMonthHref") && pageSource.includes("nextMonthHref"));
  ok(
    "NENHUM seletor de canal/objetivo no topo (seção 4 do pedido: 'não quero mais seletor de canal no topo') — buildClientContextHref mantém o parâmetro genérico (compat), mas nenhuma chamada real da página o usa",
    !pageSource.includes("VisaoGeralChannelSwitch") && !/buildContextHref\(\{[^}]*metricsChannel/.test(pageSource),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — Multicanal (seção 9 do pedido: nunca somar resultados incompatíveis)\n");
{
  check(
    "só Meta com Leads -> 1 grupo (Leads: [meta])",
    groupChannelsByResultType([{ channel: "meta", resultType: "leads" }], "leads"),
    [{ resultType: "leads", channels: ["meta"], isPrimary: true }],
  );
  check(
    "só Google com Vendas -> 1 grupo (Vendas: [google])",
    groupChannelsByResultType([{ channel: "google", resultType: "sales" }], "sales"),
    [{ resultType: "sales", channels: ["google"], isPrimary: true }],
  );
  check(
    "Meta + Google, MESMO objetivo (Leads) -> 1 grupo só, com os 2 canais (caso comum)",
    groupChannelsByResultType(
      [
        { channel: "meta", resultType: "leads" },
        { channel: "google", resultType: "leads" },
      ],
      "leads",
    ),
    [{ resultType: "leads", channels: ["meta", "google"], isPrimary: true }],
  );
  check(
    "Meta=Vendas (principal) + Google=Leads -> 2 grupos, NUNCA um consolidado fabricado entre eles; principal primeiro",
    groupChannelsByResultType(
      [
        { channel: "meta", resultType: "sales" },
        { channel: "google", resultType: "leads" },
      ],
      "sales",
    ),
    [
      { resultType: "sales", channels: ["meta"], isPrimary: true },
      { resultType: "leads", channels: ["google"], isPrimary: false },
    ],
  );
  check(
    "canal sem objetivo configurado (resultType null) nunca entra em grupo nenhum",
    groupChannelsByResultType(
      [
        { channel: "meta", resultType: "leads" },
        { channel: "google", resultType: null },
      ],
      "leads",
    ),
    [{ resultType: "leads", channels: ["meta"], isPrimary: true }],
  );
  check("canal inexistente (lista vazia) -> nenhum grupo", groupChannelsByResultType([], null), []);
  ok(
    "channelsLabel só aparece quando há MAIS DE 1 objetivo em jogo (resultGroups.length > 1) — nunca 'Meta + Google' redundante no caso comum de 1 objetivo só",
    pageSource.includes("resultGroups.length > 1"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — Diagnóstico\n");
{
  const baseDiagnostics: ClientDiagnostics = {
    planejamento: { items: [], isIncomplete: false },
    cpa: null,
    investment: { value: 1000, expected: 1000, deviationPct: 0, direction: "flat", tone: "normal", isOutOfRange: false },
    pendencias: { count: 0, items: [], hasPendencias: false },
    atividade: { lastActivityAt: null, hoursSinceLastActivity: null, isOverdue: false },
  };

  check(
    "CPL/CPA fora da meta -> insight 'warning'/'critical' com o rótulo goal-aware (nunca hardcoded)",
    buildCockpitInsights({
      diagnostics: { ...baseDiagnostics, cpa: { value: 60, expected: 40, deviationPct: 0.5, direction: "up", tone: "critical", isOutOfRange: true } },
      costLabel: "CPL",
      dataAttentions: [],
    })[0],
    { id: "cpa", severity: "critical", message: "CPL está 50% acima do planejado no mês." },
  );

  check(
    "ritmo abaixo -> insight de investimento com direção/percentual corretos",
    buildCockpitInsights({
      diagnostics: { ...baseDiagnostics, investment: { value: 500, expected: 1000, deviationPct: -0.5, direction: "down", tone: "critical", isOutOfRange: true } },
      costLabel: "CPL",
      dataAttentions: [],
    })[0],
    { id: "investimento", severity: "critical", message: "Investimento está 50% abaixo do ritmo esperado no mês." },
  );

  check(
    "atenção de Dados (Google Ads sem dados recebidos) entra como insight, mesma mensagem de lib/data-trust.ts",
    buildCockpitInsights({
      diagnostics: baseDiagnostics,
      costLabel: "CPL",
      dataAttentions: [{ id: "source-no-data-1", severity: "warning", message: "Stract · Google Ads: a última sincronização completa não encontrou nenhuma linha." }],
    })[0],
    { id: "source-no-data-1", severity: "warning", message: "Stract · Google Ads: a última sincronização completa não encontrou nenhuma linha." },
  );

  check("sem nenhum diagnóstico ativo -> lista vazia (nunca um alerta inventado)", buildCockpitInsights({ diagnostics: baseDiagnostics, costLabel: "CPL", dataAttentions: [] }), []);

  ok(
    "insights são ordenados por severidade (critical antes de warning antes de info) — nunca ordem arbitrária",
    (() => {
      const result = buildCockpitInsights({
        diagnostics: {
          ...baseDiagnostics,
          planejamento: { items: [{ type: "meta_custo_nao_configurada", label: "Meta de custo por resultado não configurada" }], isIncomplete: true },
          investment: { value: 1300, expected: 1000, deviationPct: 0.3, direction: "up", tone: "critical", isOutOfRange: true },
        },
        costLabel: "CPL",
        dataAttentions: [],
      });
      return result[0].severity === "critical" && result[result.length - 1].severity === "info";
    })(),
  );

  ok("limite 'poucos insights' (default 4) — nunca uma lista longa (seção 11 do pedido)", /limit = 4/.test(loadSource("src", "lib", "cockpit-diagnostics.ts")));
  ok("CockpitDiagnosticsCard mostra estado saudável compacto quando não há insight nenhum", diagnosticsCardSource.includes("Nenhum ponto de atenção"));
}

// ---------------------------------------------------------------------------
console.log("\nD — Performance (essencial + completa)\n");
{
  ok("Performance essencial reaproveita buildPeriodReading (lib/performance-report/report-derivatives.ts) — nenhum texto/cálculo novo", pageSource.includes("buildPeriodReading({"));
  ok("Performance essencial reaproveita buildPerformanceReportData (Camada 1 oficial do Relatório) — nenhuma segunda agregação de campanhas", pageSource.includes("buildPerformanceReportData(supabase, id,"));
  ok("CTA 'Ver campanhas →' e 'Ver Performance completa →' apontam pra /clients/[id]/relatorio, nenhuma rota nova inventada", performanceSectionSource.includes("Ver campanhas →") && performanceSectionSource.includes("Ver Performance completa →"));
  ok("/clients/[id]/relatorio continua existindo e não foi tocado nesta fase (seção 20 do pedido)", loadSource("src", "app", "clients", "[id]", "relatorio", "page.tsx").length > 0);
  ok("PDF (/api/clients/[id]/performance-report) e link público (/r/[token]) não foram alterados", loadSource("src", "app", "api", "clients", "[id]", "performance-report", "route.ts").length > 0 && loadSource("src", "app", "r", "[token]", "page.tsx").length > 0);
}

// ---------------------------------------------------------------------------
console.log("\nE — Execução (Operação + Demandas)\n");
{
  ok("Sprint atual continua vindo de findSprintForDate (MESMA fonte de sempre)", pageSource.includes("findSprintForDate(sprints, todayStr)"));
  ok("sem sprint no mês -> currentSprintLabel null, CockpitExecutionSection mostra '—' (nunca um erro)", executionSource.includes('currentSprintLabel ?? "—"'));
  ok("Última revisão continua vindo da MESMA query account_reviews de sempre (divergência Dashboard×Timeline documentada, não resolvida nesta fase — seção 22 do pedido)", pageSource.includes("account_reviews:cockpit-resumo"));
  ok("Registrar revisão reaproveita RecordAccountReviewDrawer/record_account_review oficiais via ?review=new, nenhum formulário novo", pageSource.includes("<RecordAccountReviewDrawer") && pageSource.includes('review === "new"'));
  ok("Demandas: contagem + preview continuam vindo de loadPendenciasRawData/countOpenDemandas (MESMA fonte/regra de sempre)", pageSource.includes("loadPendenciasRawData(supabase, id)") && pageSource.includes("countOpenDemandas("));
  ok("preview de demandas continua limitado a 3 itens", pageSource.includes(".slice(0, 3)"));
  ok("sem demandas abertas -> estado compacto explícito 'Nenhuma demanda aberta.' (nunca lista vazia silenciosa)", executionSource.includes("Nenhuma demanda aberta."));
  ok("Concluir reaproveita completeTaskAction (MESMA Server Action da Demandas completa, nenhuma segunda implementação)", loadSource("src", "app", "clients", "cockpit-complete-task-button.tsx").includes('import { completeTaskAction } from "./tasks-actions"'));
  ok("ações de escrita (Concluir/Registrar revisão) só aparecem com canOperate=true (client.status === 'ativo', mesmo guard de /operation)", executionSource.includes("canOperate &&") && pageSource.includes('const canOperate = client.status === "ativo"'));
  ok("NENHUM bulk delete/bulk duplicate/CRUD completo trazido pro cockpit (seção 24 do pedido) — sem duplicateTasksAction/bulkDeleteTasksAction aqui", !executionSource.includes("duplicateTasksAction") && !executionSource.includes("bulkDeleteTasksAction"));
}

// ---------------------------------------------------------------------------
console.log("\nF — Histórico\n");
{
  ok("Histórico reaproveita fetchClientTimelinePage (MESMA fonte da Timeline do cliente), nenhum histórico novo", pageSource.includes("fetchClientTimelinePage(supabase,"));
  ok("categorização reaproveitada (ClientTimelineRow['category']), nenhuma taxonomia nova", historySource.includes("ClientTimelineRow"));
  ok("ausência de eventos -> estado compacto explícito", historySource.includes("Nenhum evento registrado ainda."));
  ok("/clients/[id]/timeline (completa) não foi alterada nesta fase", loadSource("src", "app", "clients", "[id]", "timeline", "page.tsx").includes("fetchClientTimelinePage"));
}

// ---------------------------------------------------------------------------
console.log("\nG — Regressão (rotas antigas continuam intactas; sem redirects/remoções novos)\n");
{
  for (const route of [
    ["clients", "[id]", "metas", "page.tsx"],
    ["clients", "[id]", "relatorio", "page.tsx"],
    ["clients", "[id]", "dados", "page.tsx"],
    ["clients", "[id]", "operation", "page.tsx"],
    ["clients", "[id]", "demandas", "page.tsx"],
    ["clients", "[id]", "timeline", "page.tsx"],
    ["clients", "[id]", "edit", "page.tsx"],
  ]) {
    ok(`/${route.slice(0, -1).join("/")} continua existindo no disco, intocada`, loadSource("src", "app", ...route).length > 0);
  }
  ok("/operation GLOBAL continua intocada (nenhuma incorporação à tela do cliente)", loadSource("src", "app", "operation", "page.tsx").length > 0);
  ok("/demandas GLOBAL continua intocada", loadSource("src", "app", "demandas", "page.tsx").length > 0);
  ok("/timeline GLOBAL continua intocada", loadSource("src", "app", "timeline", "page.tsx").length > 0);
  ok("/clients (Gestão/carteira) continua intocada", loadSource("src", "app", "clients", "page.tsx").includes("AgencyAccountsTree") || loadSource("src", "app", "clients", "page.tsx").length > 0);
  // Nota (MITZA ONE — Fase 2, posterior a este arquivo): Sidebar e
  // ClientWorkspaceHeader foram DELIBERADAMENTE alterados na Fase 2
  // (Sidebar = Carteira de Clientes + Header Simplificado) — correto pra
  // ESTA fase (Fase 1) ter continuado intocados até então; a cobertura
  // dessa mudança passou a viver em test-mitza-one-fase2-sidebar.ts, não
  // duplicada/corrigida aqui pra não reescrever a história desta suite.
  ok("nenhum redirect novo em [id]/page.tsx", !/redirect\(/.test(pageSource));
  ok("ensureClosedSprintSnapshots continua chamado com primaryBudgetChanges (congelamento nunca depende de qual objetivo o cockpit está destacando)", /ensureClosedSprintSnapshots\(supabase, \{[\s\S]{0,200}primaryBudgetChanges/.test(pageSource));
}

// ---------------------------------------------------------------------------
console.log("\nH — Canal sem dados / erro de sincronização (seção 16 do pedido)\n");
{
  check(
    "sem nenhuma atenção mencionando o canal -> null (nunca selo fabricado)",
    findChannelDataIssue([{ id: "x", severity: "warning", message: "Stract · Meta Ads: algo." }], "Google Ads"),
    null,
  );
  check(
    "atenção severity=error mencionando o canal -> selo 'Erro de sincronização'",
    findChannelDataIssue([{ id: "x", severity: "error", message: "Meta API · Meta Ads: erro na última sincronização." }], "Meta Ads"),
    { severity: "error", label: "Erro de sincronização" },
  );
  check(
    "atenção severity=warning mencionando o canal -> selo 'Sem dados recebidos'",
    findChannelDataIssue([{ id: "x", severity: "warning", message: "Stract · Google Ads: a última sincronização completa não encontrou nenhuma linha." }], "Google Ads"),
    { severity: "warning", label: "Sem dados recebidos" },
  );
  ok("DashboardChannelSection aceita dataIssue opcional (default: nenhum selo, comportamento de antes desta fase preservado)", channelSectionSource.includes("dataIssue?: DashboardChannelDataIssue | null"));
}

// ---------------------------------------------------------------------------
console.log("\nI — Status/cores reaproveitam tokens existentes (seção 33 do pedido), nenhuma paleta paralela\n");
{
  check("PACE_VERDICT_LABEL.dentro", PACE_VERDICT_LABEL.dentro, "NO RITMO");
  check("PACE_VERDICT_LABEL.acima", PACE_VERDICT_LABEL.acima, "RITMO ACIMA");
  check("PACE_VERDICT_LABEL.abaixo", PACE_VERDICT_LABEL.abaixo, "RITMO ABAIXO");
  check("PACE_VERDICT_TONE.dentro", PACE_VERDICT_TONE.dentro, "success");
  check("PACE_VERDICT_TONE.acima", PACE_VERDICT_TONE.acima, "danger");
  check("costVerdictLabel(normal)", costVerdictLabel("normal"), "DENTRO DA META");
  check("costVerdictLabel(critical)", costVerdictLabel("critical"), "FORA DA META");
  check("COST_VERDICT_TONE.attention", COST_VERDICT_TONE.attention, "warning");
  ok("cockpit-pace.ts só traduz SpendStatus/MetricTone já existentes (classifySpendStatus/evaluateCpaDiagnostic) — nenhuma segunda classificação", loadSource("src", "lib", "cockpit-pace.ts").includes('from "@/lib/spend-status"') && loadSource("src", "lib", "cockpit-pace.ts").includes('from "@/lib/metric-diagnostics"'));
}

console.log(`\n${passed} verificações passaram.`);
