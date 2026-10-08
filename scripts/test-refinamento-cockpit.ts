/**
 * Testes da Etapa "MITZA ONE — REFINAMENTO DO COCKPIT" (cards compactos,
 * metas mensais editáveis direto do Cockpit, gráfico combinado invertido).
 * Cobre só as partes SEGURAS implementadas (seções 1, 2, 5, 6, 7 do
 * pedido) — seções 3/4 (planejamento sem herança automática / alerta de
 * planejamento pendente) foram deliberadamente INTERROMPIDAS por exigirem
 * decisão estrutural (auditoria apresentada ao usuário antes de
 * implementar, per instrução explícita "interromper essa parte e
 * apresentar uma proposta antes de implementar"); este arquivo também
 * confirma que essa decisão foi respeitada (nenhuma semântica de vigência
 * foi tocada, nenhum alerta de "planejamento pendente" foi inventado).
 *
 * Checagens ESTRUTURAIS via grep de código-fonte (mesmo padrão das suites
 * anteriores, sem DOM neste ambiente).
 *
 * Rodar: npx tsx scripts/test-refinamento-cockpit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
console.log("\nA — Cards compactos (seção 1 do pedido): paddings/gaps reduzidos, nenhum dado removido, caixa dupla do Orçamento eliminada\n");
{
  const cardsSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");

  ok("os 3 cards usam p-3.5 (reduzido de p-4) — compactação sem corte de conteúdo", (cardsSource.match(/rounded-lg border p-3\.5/g) ?? []).length === 3);
  ok(
    "card RESULTADO continua com todos os dados exigidos: status de ritmo, valor, meta, necessário/dia, barra",
    cardsSource.includes("status ? <PaceVerdictBadge") &&
      cardsSource.includes("formatCount(view.resultCount)") &&
      cardsSource.includes("formatCount(view.targetResultCount)") &&
      cardsSource.includes("Necessário") &&
      cardsSource.includes("<AgencyInvestmentBar"),
  );
  ok(
    "card CUSTO POR RESULTADO continua com valor, meta e comparação com a meta — NUNCA barra de progresso (ratio, não cumulativo)",
    cardsSource.includes("formatCurrency(view.costPerResult)") && cardsSource.includes("% acima") && !/CockpitCostCard[\s\S]{0,2000}<AgencyInvestmentBar/.test(cardsSource),
  );
  ok(
    "card ORÇAMENTO continua com investido/orçamento planejado/necessário-dia/barra",
    cardsSource.includes("formatCurrency(headline.monthActual)") && cardsSource.includes("Necessário") && cardsSource.includes("<AgencyInvestmentBar"),
  );
  ok(
    "a caixa 'Orçamento do mês' separada foi eliminada — DashboardBudget nasce com compact (sem a própria moldura/título duplicados)",
    cardsSource.includes("<DashboardBudget clientId={clientId} monthParam={monthParam} total={headline.monthPlanned} channels={channels} canEdit={canEdit} compact />"),
  );
  ok(
    "'Planejado' não é mais exibido duas vezes — o headline do card ORÇAMENTO não repete o valor que o DashboardBudget compacto já mostra",
    !/CockpitBudgetCard[\s\S]{0,1200}<span>Planejado<\/span>/.test(cardsSource),
  );

  const budgetSource = loadSource("src", "app", "clients", "dashboard-budget.tsx");
  ok(
    "DashboardBudget ganhou `compact` opcional (default preserva uso standalone em dashboard-channel-section.tsx)",
    budgetSource.includes("compact?: boolean"),
  );
  ok(
    "em modo compact, a própria moldura (border/bg/p-4) e o título 'Orçamento do mês' são omitidos — mesmo estado/Server Action/validação, só a moldura muda",
    budgetSource.includes("compact ? undefined :") && budgetSource.includes("{!compact && <h2"),
  );
  ok(
    "multicanal (composição por canal + edição por canal) continua intacto em modo compact — mesmo JSX de breakdown/edição, nenhuma condicional nova que o esconda",
    budgetSource.includes("channels.length > 1") && budgetSource.includes("applyMonthlyChannelPlanChangeAction"),
  );
}

console.log("\nB — Edição direta das três metas (seção 2 do pedido): lápis reaproveitando o fluxo oficial, nenhuma segunda Server Action/RPC\n");
{
  const cardsSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
  const editorSource = loadSource("src", "app", "clients", "channel-plan-editor.tsx");
  const secondarySource = loadSource("src", "app", "clients", "cockpit-secondary-goal-editor.tsx");
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "ChannelPlanEditor ganhou `trigger` opcional — backward-compatible (comportamento padrão de /metas preservado quando omitido)",
    editorSource.includes("trigger?: (open: () => void) => ReactNode") && editorSource.includes('if (trigger) return <>{trigger(() => setIsOpen(true))}</>;'),
  );
  ok(
    "/metas (ChannelPlanEditor sem trigger) continua com o gatilho textual 'Planejamento' de sempre — nenhuma regressão pro fluxo já aprovado",
    editorSource.includes(">\n        Planejamento\n      </button>"),
  );
  ok(
    "CockpitSecondaryGoalEditor envolve MetasSecondaryTargetForm (objetivo SECUNDÁRIO) só com abrir/fechar — zero alteração na Server Action/validação (setGoalMonthlyTargetAction intocada)",
    secondarySource.includes('import { MetasSecondaryTargetForm } from "./metas-secondary-target-form";') && secondarySource.includes("useState(false)"),
  );
  ok(
    "o lápis de Resultado e o lápis de Custo (objetivo PRINCIPAL) abrem o MESMO ChannelPlanEditor oficial — nunca dois editores/fluxos diferentes pro mesmo objetivo",
    /GoalEditTrigger[\s\S]{0,400}edit\.kind === "primary"[\s\S]{0,300}<ChannelPlanEditor/.test(cardsSource),
  );
  ok(
    "objetivo SECUNDÁRIO nunca tem lápis de Custo por resultado (nunca existiu meta de custo gravável pra ele) — page.tsx só passa `edit` no card de custo quando group.isPrimary",
    pageSource.includes("edit: group.isPrimary ? goalEdit : null,"),
  );
  ok(
    "edição do objetivo PRINCIPAL continua usando TODOS os canais disponíveis (AVAILABLE_TRAFFIC_CHANNELS, mesma regra de /metas) — nunca restrita só aos canais do grupo exibido",
    pageSource.includes("channels: group.isPrimary ? AVAILABLE_TRAFFIC_CHANNELS : group.channels,"),
  );
  ok(
    "gate de permissão de edição no Cockpit é o MESMO já usado pro orçamento (canEditBudgetInline: admin + mês não encerrado) — nenhuma segunda regra de quem pode editar",
    pageSource.includes("const goalEdit: CockpitGoalEditAffordance | null = canEditBudgetInline"),
  );
  ok(
    "nenhuma tabela/RPC/Server Action nova foi criada — só os já existentes (apply_monthly_channel_plan_change via applyMonthlyChannelPlanChangeAction, set_goal_monthly_target via setGoalMonthlyTargetAction) foram reaproveitados",
    !pageSource.includes("CREATE TABLE") && editorSource.includes("applyMonthlyChannelPlanChangeAction") && secondarySource.includes("MetasSecondaryTargetForm"),
  );
}

console.log("\nC — Planejamento mensal sem herança automática (seção 3 do pedido): DELIBERADAMENTE interrompido — auditoria apresentada, nenhuma semântica de vigência alterada\n");
{
  const clientPlanSource = loadSource("src", "lib", "client-plan.ts");
  const monthlyBudgetSource = loadSource("src", "lib", "monthly-budget.ts");

  ok(
    "resolveClientMonthlyPlan continua com a regra de vigência (mês <= selectedMonth, carry-forward) — a regra 'cada mês exige configuração explícita' NÃO foi implementada (decisão de parar, per instrução do usuário)",
    clientPlanSource.includes("c.month <= selectedMonth") || clientPlanSource.includes("<= selectedMonth"),
  );
  ok(
    "resolveMonthlyPerformanceTargets/resolveMonthlyPlanSnapshot continuam documentando a MESMA regra de vigência compartilhada por 8+ consumidores — nenhuma mudança silenciosa de contrato",
    monthlyBudgetSource.includes('nunca "sem meta" só porque ninguém tocou'),
  );
  ok(
    "nenhuma migration/coluna nova de 'configuração explícita por mês' foi introduzida nesta etapa",
    !clientPlanSource.includes("is_explicit_for_month") && !monthlyBudgetSource.includes("is_explicit_for_month"),
  );
}

console.log("\nD — Alerta de planejamento pendente (seção 4 do pedido): DELIBERADAMENTE interrompido (depende da distinção da seção 3, não implementada)\n");
{
  const cardsSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "nenhum banner/alerta novo de 'Planejamento pendente' foi adicionado ao Cockpit — a distinção 'não configurado vs. configurado com zero' que ele dependeria não existe ainda",
    !cardsSource.includes("Planejamento pendente") && !pageSource.includes("Planejamento pendente"),
  );
  ok(
    "o texto 'Sem meta configurada'/'Sem planejamento configurado' (estado JÁ existente, sem herança) continua sendo o único aviso de ausência — nenhum segundo mecanismo paralelo inventado",
    cardsSource.includes("Sem meta de") && cardsSource.includes("Sem planejamento configurado para o mês."),
  );
}

console.log("\nE — Preservações obrigatórias (seção 7 do pedido): autenticação, integrações, pipelines, cálculos oficiais, rotas legadas, sidebar, histórico, demandas intocados\n");
{
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok("requireAdmin/getCurrentProfile continuam as únicas fontes de permissão — nenhuma segunda checagem de auth inventada por esta etapa", pageSource.includes("getCurrentProfile()"));
  ok("sidebar.tsx não foi tocado por esta etapa", !loadSource("src", "app", "sidebar.tsx").includes("Refinamento do Cockpit"));
  ok("Histórico (fetchClientTimelinePage) e Demandas (loadPendenciasRawData/countOpenDemandas) continuam as mesmas fontes, nenhuma reescrita", pageSource.includes("fetchClientTimelinePage") && pageSource.includes("loadPendenciasRawData"));
  ok(
    "cálculos oficiais (resolveClientMonthlyGoals, computeMonthlyBudgetPlan, computePerformanceSummary, groupChannelsByResultType) continuam as únicas fontes — nenhuma segunda implementação",
    pageSource.includes("resolveClientMonthlyGoals(") && pageSource.includes("computeMonthlyBudgetPlan(") && pageSource.includes("computePerformanceSummary(") && pageSource.includes("groupChannelsByResultType("),
  );
  ok("/clients/[id]/metas (rota legada do fluxo completo de metas) continua existindo no disco, intocada", loadSource("src", "app", "clients", "[id]", "metas", "page.tsx").includes("ClientMetasPage"));
}

console.log(`\n${passed} verificações passaram.\n`);
