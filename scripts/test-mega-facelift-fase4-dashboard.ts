/**
 * Testes da Etapa "MEGA FACELIFT — Fase 4: Dashboard" — cobre só o que esta
 * rodada de fato mudou: a recomposição visual de `/clients/[id]` num
 * cockpit executivo (Executive Snapshot com destaque pro Resultado, Ritmo
 * do mês + Diagnóstico único lado a lado, Resultados por canal, sínteses
 * de Operação/Demandas) e a remoção do que virou duplicado (Planejamento
 * inline, metas secundárias por extenso, histórico de orçamento). Nenhum
 * cálculo de investimento/performance muda nesta fase — os cenários desse
 * cálculo (múltiplos objetivos, canais, mês passado/atual/futuro, com/sem
 * receita) já são cobertos pelas suites existentes
 * (`test-client-plan*.ts`, `test-monthly-budget*.ts`,
 * `test-mega-facelift-fase2-metas.ts`) — não duplicados aqui.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase4-dashboard.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { resolveDashboardDiagnosticCtaTarget } from "../src/app/clients/[id]/page";

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

const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const kpiSource = loadSource("src", "app", "clients", "monthly-kpi-summary.tsx");
const metasPageSource = loadSource("src", "app", "clients", "[id]", "metas", "page.tsx");

console.log("\n1 — resolveDashboardDiagnosticCtaTarget: núcleo puro, mesmo motor/desempate de PerformanceDiagnosticCard, nunca causalidade inventada\n");
{
  check(
    "sem nenhuma base de comparação (sem planejamento, sem meta de custo) -> nenhuma CTA",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 0,
      expectedToDate: null,
      costPerResult: null,
      targetCostPerResult: null,
      resultCount: 0,
      hasPerformanceGoal: false,
    }),
    null,
  );
  check(
    "só Investimento com base, dentro do esperado (<=10%) -> nenhuma CTA (sem desvio, nada a apontar)",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1000,
      expectedToDate: 1000,
      costPerResult: null,
      targetCostPerResult: null,
      resultCount: 0,
      hasPerformanceGoal: false,
    }),
    null,
  );
  check(
    "Investimento 30% acima do esperado (crítico), sem meta de custo -> Ver Metas",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1300,
      expectedToDate: 1000,
      costPerResult: null,
      targetCostPerResult: null,
      resultCount: 0,
      hasPerformanceGoal: false,
    }),
    "metas",
  );
  check(
    "Custo por resultado 30% acima da meta (crítico), amostra suficiente, sem planejamento -> Ver Performance",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 0,
      expectedToDate: null,
      costPerResult: 130,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: true,
    }),
    "performance",
  );
  check(
    "Investimento crítico (30% acima) + Custo em atenção (15% acima) -> o mais severo vence: Ver Metas",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1300,
      expectedToDate: 1000,
      costPerResult: 115,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: true,
    }),
    "metas",
  );
  check(
    "Investimento em atenção (15%) + Custo crítico (30%) -> o mais severo vence: Ver Performance",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1150,
      expectedToDate: 1000,
      costPerResult: 130,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: true,
    }),
    "performance",
  );
  check(
    "empate de severidade (ambos críticos, 30% de desvio) -> desempate mesmo de PerformanceDiagnosticCard: Investimento vence (Ver Metas)",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1300,
      expectedToDate: 1000,
      costPerResult: 130,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: true,
    }),
    "metas",
  );
  check(
    "Custo por resultado ABAIXO da meta (sempre melhora, nunca aponta Performance) + Investimento dentro do esperado -> nenhuma CTA",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1000,
      expectedToDate: 1000,
      costPerResult: 70,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: true,
    }),
    null,
  );
  check(
    "amostra insuficiente de resultado (< MIN_RELIABLE_RESULT_COUNT) nunca classifica custo como desvio, mesmo 50% acima da meta",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1000,
      expectedToDate: 1000,
      costPerResult: 150,
      targetCostPerResult: 100,
      resultCount: 1,
      hasPerformanceGoal: true,
    }),
    null,
  );
  check(
    "hasPerformanceGoal false exclui o eixo de custo da lista de candidatos mesmo com valores informados",
    resolveDashboardDiagnosticCtaTarget({
      actualSpend: 1300,
      expectedToDate: 1000,
      costPerResult: 300,
      targetCostPerResult: 100,
      resultCount: 20,
      hasPerformanceGoal: false,
    }),
    "metas",
  );
}

console.log("\n2 — Planejamento detalhado saiu do Dashboard (seção 12 do pedido): ChannelPlanEditor não é mais renderizado aqui, só um CTA pra Metas\n");
{
  ok("ChannelPlanEditor não é mais importado em [id]/page.tsx", !pageSource.includes('import { ChannelPlanEditor }'));
  ok("ChannelPlanEditor não é mais renderizado em [id]/page.tsx", !/<ChannelPlanEditor/.test(pageSource));
  ok('"Editar planejamento →" aponta pra Metas (buildMetasHref), nunca abre inline', pageSource.includes("Editar planejamento →") && pageSource.includes("buildMetasHref"));
  ok(
    "mesmo gate de antes (admin, mês não fechado, objetivo PRINCIPAL) continua controlando o CTA",
    /isAdmin && !isClosedMonth && effectiveDate && performanceGoal === primaryResultType && \(\s*<Link href=\{metasHref\}/.test(pageSource),
  );
  ok("ChannelPlanEditor continua existindo e sendo renderizado de verdade em Metas (nunca deletado, só mudou de lugar)", /<ChannelPlanEditor/.test(metasPageSource));
}

console.log("\n3 — Análise profunda / metas secundárias por extenso saíram do Dashboard: AccountFollowUpPanel/SecondaryGoalsPerformance órfãos, não deletados\n");
{
  ok("AccountFollowUpPanel não é mais importado em [id]/page.tsx", !pageSource.includes('from "../account-follow-up-panel"'));
  ok("SecondaryGoalsPerformance não é mais importado em [id]/page.tsx", !pageSource.includes('from "../secondary-goals-performance"'));
  ok("fetchSecondaryGoalsPerformance/fetchGoalDisplaySummaries não são mais chamados aqui", !pageSource.includes("fetchSecondaryGoalsPerformance(") && !pageSource.includes("fetchGoalDisplaySummaries("));
  ok("account-follow-up-panel.tsx continua existindo no disco (não deletado nesta rodada)", loadSource("src", "app", "clients", "account-follow-up-panel.tsx").includes("export function AccountFollowUpPanel"));
  ok("secondary-goals-performance.tsx continua existindo no disco (não deletado nesta rodada)", existsSync(join(__dirname, "..", "src", "app", "clients", "secondary-goals-performance.tsx")));
}

console.log("\n4 — Histórico de orçamento saiu do Dashboard (seção 12/13 do pedido): MonthlyBudgetHistoryDrawer não é mais renderizado, `?historicoOrcamento=1` não é mais lido aqui\n");
{
  ok("MonthlyBudgetHistoryDrawer não é mais importado em [id]/page.tsx", !pageSource.includes('from "../monthly-budget-history-drawer"'));
  ok(
    "searchParams de [id]/page.tsx não lê mais historicoOrcamento (só sobrevive numa doc-comment explicando o que saiu)",
    !/historicoOrcamento\?: string|const \{[^}]*historicoOrcamento/.test(pageSource),
  );
  ok("monthly-budget-history-drawer.tsx continua existindo no disco (não deletado nesta rodada)", loadSource("src", "app", "clients", "monthly-budget-history-drawer.tsx").includes("export function MonthlyBudgetHistoryDrawer"));
}

console.log("\n5 — Topo do Dashboard não repete identidade do cliente (seção 3 do pedido): conteúdo começa simples, nome/status/avatar continuam só no Client Context global\n");
{
  ok('heading simples "Dashboard" presente', /<h1[^>]*>Dashboard<\/h1>/.test(pageSource));
  ok("ClientWorkspaceContext (global) continua sendo o único lugar que recebe o nome do cliente nesta página", pageSource.includes("<ClientWorkspaceContext name={client.name} />"));
}

console.log("\n6 — Executive Snapshot (seção 4 do pedido): MonthlyKpiSummary ganha destaque visual no Resultado, sem nenhum valor/cálculo novo\n");
{
  ok("Kpi aceita prop accent opcional", /accent\?: boolean/.test(kpiSource));
  ok("só o Kpi de Resultado recebe accent — Investimento/Custo por resultado/Faturamento/ROAS continuam no tratamento padrão", /<Kpi label=\{resultLabel\} value=\{resultValue\} auxiliary=\{resultAuxiliary\} accent \/>/.test(kpiSource));
  ok("accent muda só composição visual (superfície/tamanho), nunca lógica de valor — deriveMonthlyKpiTexts continua a única fonte dos textos", kpiSource.includes("deriveMonthlyKpiTexts"));
}

console.log("\n7 — Ritmo do mês + Diagnóstico (seções 5/6 do pedido): mesmos componentes/cálculos de sempre, agora em cards próprios lado a lado com CTA pros módulos certos\n");
{
  ok("MonthlyGoalProgress/MonthInvestmentSummary/MonthInvestmentPaceNote continuam reaproveitados sem reimplementação", pageSource.includes("<MonthlyGoalProgress") && pageSource.includes("<MonthInvestmentSummary") && pageSource.includes("<MonthInvestmentPaceNote"));
  ok("PerformanceDiagnosticCard continua o único motor de diagnóstico usado aqui (metric-diagnostics.ts, nunca account-health-engine.ts)", pageSource.includes("<PerformanceDiagnosticCard") && !pageSource.includes("account-health-engine"));
  ok(
    "MonthInvestmentPaceNote recebe lastChange={null} — nenhum link de histórico de orçamento sobrevive na nova composição (ver teste 4)",
    /lastChange=\{null\}/.test(pageSource),
  );
  ok("CTA do diagnóstico usa resolveDashboardDiagnosticCtaTarget, nunca um motor/score novo", pageSource.includes("resolveDashboardDiagnosticCtaTarget("));
  ok('"Ver Metas →" aparece no card de Ritmo', /Ritmo do mês<\/h2>\s*<Link href=\{metasHref\}[^>]*>\s*Ver Metas →/.test(pageSource));
}

console.log("\n8 — Resultados por canal (seção 7 do pedido): continua ResultsByChannel de sempre, sem virar análise profunda, com CTA pra Performance\n");
{
  ok("ResultsByChannel continua reaproveitado sem reimplementação", pageSource.includes("<ResultsByChannel goal={performanceGoal} channelBreakdown={monthPerformanceChannelBreakdown} />"));
  ok('"Ver Performance →" acompanha o bloco de canal', /Resultados por canal<\/h2>\s*<Link href=\{performanceHref\}[^>]*>\s*Ver Performance →/.test(pageSource));
  ok("link do Relatório não é mais um item solto da barra de contexto — virou CTA contextual (nenhum <Link> com texto 'Relatório' sozinho)", !/>\s*Relatório\s*<\/Link>/.test(pageSource));
}

console.log("\n9 — Operação/Demandas continuam só sínteses curtas com CTA (seções 9/10 do pedido) — mesma fonte/regra de sempre, nunca lista/sprint completos aqui\n");
{
  ok("Operação: sprint atual/última otimização/saúde continuam vindo dos mesmos dados (findSprintForDate/account_reviews/PRIORITY_GROUP_TONE)", pageSource.includes("findSprintForDate(sprints, todayStr)") && pageSource.includes("account_reviews"));
  ok('CTA "Ver Operação →" presente', pageSource.includes("Ver Operação →"));
  ok("Demandas: contagem + até 3 itens continua vindo de loadPendenciasRawData/countOpenDemandas, nunca uma terceira implementação", pageSource.includes("loadPendenciasRawData(supabase, id)") && pageSource.includes("countOpenDemandas("));
  ok("preview de demandas continua limitado a 3 itens (.slice(0, 3))", pageSource.includes(".slice(0, 3)"));
  ok('CTA "Ver Demandas →" presente', pageSource.includes("Ver Demandas →"));
}

console.log("\n10 — Nenhum motor/score novo (seção 17 do pedido): sem Growth Score, sem IA, sem account-health-engine.ts nesta página\n");
{
  ok("nenhuma referência a account-health-engine nesta página", !pageSource.includes("account-health-engine"));
  ok("nenhum termo de score/IA/probabilidade na composição nova", !/growth score|health score|probabilidade de bater meta/i.test(pageSource));
}

console.log("\n11 — Rota/contrato externo intactos: /clients/[id] continua a mesma rota, nenhum redirect novo, snapshot de sprint continua congelando com o orçamento do objetivo PRINCIPAL\n");
{
  ok("nenhum redirect novo nesta página", !/redirect\(/.test(pageSource));
  ok("ensureClosedSprintSnapshots continua chamado com primaryBudgetChanges (congelamento nunca depende do objetivo em exibição)", /ensureClosedSprintSnapshots\(supabase, \{[\s\S]{0,200}primaryBudgetChanges/.test(pageSource));
}

console.log("\n12 — campanha-card/orfandade documentada nesta rodada (não corrigida): CTAs apontam só pra módulos que já existem (Metas/Performance/Operação/Demandas), nenhum destino inventado\n");
{
  let grepOk = true;
  try {
    execSync(`grep -q "buildMetasHref" ${join(__dirname, "..", "src", "app", "clients", "[id]", "metas", "page.tsx")}`);
  } catch {
    grepOk = false;
  }
  ok("buildMetasHref é exportado por Metas e consumido por [id]/page.tsx (mesma função, nunca duplicada)", grepOk && pageSource.includes('import { buildMetasHref } from "./metas/page"'));
}

console.log(`\n${passed} verificações passaram.`);
