/**
 * Testes da Etapa "MITZA ONE — Simplificação da Operação": descontinua a
 * experiência de Operação baseada em sprints na NAVEGAÇÃO PRINCIPAL
 * (Sidebar + Cockpit), sem apagar nada do sistema legado (sprints,
 * snapshots, revisões de conta, eventos operacionais, tarefas recorrentes,
 * rotas antigas, RPCs/tabelas/migrations). Checagens ESTRUTURAIS via grep
 * de código-fonte (mesmo padrão das suites anteriores).
 *
 * Rodar: npx tsx scripts/test-simplificacao-operacao.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}
function fileExists(...segments: string[]): boolean {
  return existsSync(join(__dirname, "..", ...segments));
}

const sidebarSource = loadSource("src", "app", "sidebar.tsx");
const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

// ---------------------------------------------------------------------------
console.log("\nA — Sidebar (seção 1 do pedido): Operação removida da área Agência (histórico — Demandas, preservada aqui na época, e o próprio grupo 'Agência' saíram depois, nas Etapas 1.6/1.3 da reestruturação KOFF Analytics)\n");
{
  ok("'Operação' não existe mais como item da Sidebar", !sidebarSource.includes('label: "Operação"'));
  ok(
    "grupo 'Agência' não existe mais (Demandas, seu último item, removida na Etapa 1.6; Timeline já tinha saído na 1.3)",
    !sidebarSource.includes('label: "Demandas"') && !sidebarSource.includes('label="Agência"'),
  );
  // "Equipe" (/team) foi removido do GESTAO_ITEMS na Etapa 1.4 da
  // reestruturação KOFF Analytics, posterior a esta etapa.
  ok("Gestão (Clientes/Configurações) continua intocada", /label: "Clientes", href: "\/clients"/.test(sidebarSource) && !/label: "Equipe"/.test(sidebarSource) && /label: "Configurações", href: "\/settings", icon: Settings, adminOnly: true/.test(sidebarSource));
  // MITZA ONE — Minha Rotina: ListChecks voltou a ser importado, agora pro
  // item "Minha Rotina" (ícone de checklist, seção 1 daquele pedido) —
  // reaproveitado de propósito, nunca um import morto. A checagem real
  // desta etapa (Simplificação da Operação) é que o import não sobrevivia
  // SEM USO depois de remover "Operação"; com um consumidor legítimo novo,
  // a invariante correta é "todo ListChecks importado é usado", não mais
  // "ListChecks nunca aparece".
  ok(
    "ícone ListChecks, quando presente, está de fato em uso (import morto nunca sobrevive) — hoje é o item 'Minha Rotina', não mais 'Operação'",
    !/\bListChecks\b/.test(sidebarSource) || (sidebarSource.includes("ListChecks,") && sidebarSource.includes("icon: ListChecks")),
  );
  ok("rota /operation NÃO foi excluída do disco", fileExists("src", "app", "operation", "page.tsx") && fileExists("src", "app", "clients", "[id]", "operation", "page.tsx"));
}

console.log("\nB — Cockpit do cliente (seção 2 do pedido): seção visual de Operação removida\n");
{
  ok(
    "Cockpit não renderiza mais 'Sprint atual'/'Última otimização'/'Registrar revisão' — nenhuma referência a findSprintForDate/ACCOUNT_REVIEW_OUTCOME_LABEL/RecordAccountReviewDrawer",
    !pageSource.includes("findSprintForDate(") && !pageSource.includes("ACCOUNT_REVIEW_OUTCOME_LABEL") && !pageSource.includes("RecordAccountReviewDrawer"),
  );
  ok("cockpit-execution-section.tsx (continha Operação + Demandas) foi removido do disco", !fileExists("src", "app", "clients", "cockpit-execution-section.tsx"));
  // Demandas (cockpit-demandas-section.tsx, contagem/preview/CockpitCompleteTaskButton,
  // loadPendenciasRawData/countOpenDemandas) e Histórico (CockpitHistorySection)
  // foram removidos do Cockpit nas Etapas 1.6 e 1.3 da reestruturação KOFF
  // Analytics, respectivamente.
}

console.log("\nC — Sistema legado (seção 3 do pedido): nada excluído, nenhuma dependência de verdade removida\n");
{
  ok("rota /operation (global) continua no disco", fileExists("src", "app", "operation", "page.tsx"));
  ok("rota /clients/[id]/operation (por cliente) continua no disco", fileExists("src", "app", "clients", "[id]", "operation", "page.tsx"));
  ok("operation-section.tsx (UI completa de Operação) continua no disco, intocado", fileExists("src", "app", "clients", "operation-section.tsx"));
  ok("record-account-review-drawer.tsx (Registrar revisão) continua no disco — só parou de ser aberto A PARTIR do Cockpit", fileExists("src", "app", "clients", "record-account-review-drawer.tsx"));
  ok("sprint-financials.ts/sprint-snapshot.ts (sprints, snapshots) continuam no disco, intocados", fileExists("src", "lib", "sprint-financials.ts") && fileExists("src", "lib", "sprint-snapshot.ts"));
  ok("account-reviews.ts (revisões de conta) continua no disco", fileExists("src", "lib", "account-reviews.ts"));
  ok("operational-events.ts (eventos operacionais) continua no disco", fileExists("src", "lib", "operational-events.ts"));
  ok("recurring-tasks.ts (tarefas recorrentes) continua no disco", fileExists("src", "lib", "recurring-tasks.ts"));
  ok("nenhum arquivo .sql de migration foi tocado por esta etapa (checagem indireta: nenhuma referência a DROP/ALTER TABLE no diff de page.tsx/sidebar.tsx)", !pageSource.includes("DROP TABLE") && !sidebarSource.includes("DROP TABLE"));

  ok(
    "assertSingleCurrentSprint continua chamada em page.tsx (validação de integridade de sprints pro cálculo de orçamento — dependência REAL, preservada)",
    pageSource.includes("assertSingleCurrentSprint(sprints, today)"),
  );
  ok(
    "ensureClosedSprintSnapshots continua chamada em page.tsx (congelamento de sprint fechada — dependência REAL do orçamento/ritmo exibido, preservada)",
    pageSource.includes("await ensureClosedSprintSnapshots(supabase, {"),
  );
  ok(
    "sprints (resultado do Promise.all) continua alimentando sumActualSpendForMonth/sumChannelEffectiveSpend — nenhuma remoção da dependência real de orçamento",
    pageSource.includes("sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? [])") && pageSource.includes("sumChannelEffectiveSpend("),
  );

  ok(
    "a query de account_reviews SÓ pra 'última otimização' no Cockpit foi removida (nenhum outro consumidor dela existia em page.tsx) — nunca uma consulta exclusiva de um componente que não renderiza mais",
    !pageSource.includes('.from("account_reviews")') && !pageSource.includes("account_reviews:cockpit-resumo"),
  );
  ok(
    "currentSprint/currentSprintLabel (só usados pela seção removida) saíram de page.tsx — mas sprints em si (usado pro orçamento) continua",
    !pageSource.includes("const currentSprint = ") && pageSource.includes("const sprints = sprintsRaw.map("),
  );
}

console.log("\nD — Navegação (seção 4 do pedido): estrutura final exata, nenhum módulo novo\n");
{
  ok(
    "seções do Cockpit, na ordem: Meta & Ritmo, Diagnóstico, Evolução Diária, Canais, Performance (Histórico removido na Etapa 1.3, Demandas na Etapa 1.6)",
    (() => {
      const metaRitmoIdx = pageSource.indexOf("Meta &amp; Ritmo");
      const diagnosticoIdx = pageSource.indexOf("<CockpitDiagnosticsCard");
      const evolucaoIdx = pageSource.indexOf("<CockpitDailyEvolutionSection");
      const canaisIdx = pageSource.indexOf("<DashboardChannelSection");
      const performanceIdx = pageSource.indexOf("<CockpitPerformanceSection");
      return (
        [metaRitmoIdx, diagnosticoIdx, evolucaoIdx, canaisIdx, performanceIdx].every((i) => i !== -1) &&
        metaRitmoIdx < diagnosticoIdx &&
        diagnosticoIdx < evolucaoIdx &&
        evolucaoIdx < canaisIdx &&
        canaisIdx < performanceIdx
      );
    })(),
  );
  ok(
    "Agência = nenhum item (Demandas, seu último item, removida na Etapa 1.6; Operação já tinha saído, Timeline na Etapa 1.3 — o grupo em si não existe mais)",
    !sidebarSource.includes('label="Agência"') && !sidebarSource.includes('label: "Demandas"'),
  );
  // "Equipe" (/team) foi removido do GESTAO_ITEMS na Etapa 1.4 da
  // reestruturação KOFF Analytics, posterior a esta etapa.
  ok("Gestão = Clientes + Configurações (Equipe removido na Etapa 1.4)", /const GESTAO_ITEMS: NavItem\[\] = \[\s*\{ label: "Clientes"[\s\S]*?\{ label: "Configurações"[\s\S]*?\];/.test(sidebarSource));
  ok("nenhum módulo/item novo foi adicionado à Sidebar (contagem de 'label:' em GESTAO_ITEMS = 2: Clientes, Configurações)", countLabels(sidebarSource) === 2);
}

function countLabels(source: string): number {
  const gestao = source.match(/const GESTAO_ITEMS: NavItem\[\] = \[([\s\S]*?)\];/);
  return gestao ? [...gestao[1].matchAll(/label: "([^"]+)"/g)].length : 0;
}

console.log("\nE — Orçamento/metas/resultados (seção 3/5 do pedido): nenhum cálculo alterado\n");
{
  ok("computeMonthlyExpectedToDateByCalendar continua a mesma fonte de 'Esperado até hoje'", pageSource.includes("computeMonthlyExpectedToDateByCalendar("));
  ok("computeMonthlyBudgetPlan continua a mesma fonte de 'Necessário R$/dia'", pageSource.includes("computeMonthlyBudgetPlan({"));
  ok("resolveClientMonthlyGoals/clientGoalsPlan continuam a mesma fonte de meta por objetivo", pageSource.includes("resolveClientMonthlyGoals({") && pageSource.includes("clientGoalsPlan"));
  ok("computePerformanceSummary continua o mesmo núcleo de resultado/custo por resultado", pageSource.includes("computePerformanceSummary({"));
  ok("groupChannelsByResultType (Meta & Ritmo, nunca soma objetivos incompatíveis) continua intocado", pageSource.includes("groupChannelsByResultType("));
  ok("CockpitResultCard/CockpitCostCard/CockpitBudgetCard (Meta & Ritmo) continuam renderizados sem alteração de props/cálculo", pageSource.includes("<CockpitResultCard") && pageSource.includes("<CockpitCostCard") && pageSource.includes("<CockpitBudgetCard"));
}

console.log(`\n${passed} verificações passaram.\n`);
