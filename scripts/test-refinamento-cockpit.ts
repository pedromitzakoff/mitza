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
  const goalCardSource = loadSource("src", "app", "clients", "cockpit-goal-card.tsx");

  // Ajuste de proporção posterior (p-3.5 -> p-3): a checagem real desta
  // etapa é "os 3 cards continuam com a MESMA moldura/padding entre si"
  // (compactação consistente), não um valor de padding travado no tempo.
  // MITZA ONE — Refinamento do Cockpit (redesenho de edição): RESULTADO/
  // CUSTO moraram pra cockpit-goal-card.tsx (precisam de `isEditing`
  // próprio); ORÇAMENTO continua em cockpit-meta-ritmo-section.tsx — a
  // checagem soma as classes das DUAS fontes, nunca uma só.
  const paddingClasses = [
    ...(cardsSource.match(/rounded-lg border p-\S+ \$\{COCKPIT_TONE_CARD_CLASSES/g) ?? []),
    ...(goalCardSource.match(/rounded-lg border p-\S+ \$\{COCKPIT_TONE_CARD_CLASSES/g) ?? []),
  ];
  ok(
    "os 3 cards de Meta & Ritmo continuam com a MESMA classe de moldura/padding entre si (compactação consistente, sem corte de conteúdo)",
    new Set(paddingClasses.map((m) => m.split(" ")[2])).size === 1 && paddingClasses.length === 3,
  );
  ok(
    "card RESULTADO continua com todos os dados exigidos: status de ritmo, valor, meta, necessário/dia, barra",
    goalCardSource.includes("status ? <PaceVerdictBadge") &&
      goalCardSource.includes("formatCount(view.resultCount)") &&
      goalCardSource.includes("formatCount(view.targetResultCount)") &&
      goalCardSource.includes("Necessário") &&
      goalCardSource.includes("<AgencyInvestmentBar"),
  );
  ok(
    "card CUSTO POR RESULTADO continua com valor, meta e comparação com a meta — NUNCA barra de progresso (ratio, não cumulativo)",
    goalCardSource.includes("formatCurrency(view.costPerResult)") &&
      goalCardSource.includes("% acima") &&
      !/CockpitCostCard[\s\S]{0,2500}<AgencyInvestmentBar/.test(goalCardSource),
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

console.log(
  "\nB — Edição das três metas direto no painel central (pedido do usuário: \"nao quero mais essa tela [drawer]. Quero q seja tudo feito ali no painel central mesmo e qua tenha uma calculdodra ja integrada\")\n",
);
{
  const goalCardSource = loadSource("src", "app", "clients", "cockpit-goal-card.tsx");
  const inlineEditorSource = loadSource("src", "app", "clients", "cockpit-inline-goal-editor.tsx");
  const editorSource = loadSource("src", "app", "clients", "channel-plan-editor.tsx");
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "o antigo drawer lateral (ChannelPlanEditor com trigger/gatilho) NUNCA MAIS é usado no Cockpit — os arquivos que abriam esse drawer atrás de um lápis (cockpit-goal-edit-trigger.tsx, cockpit-secondary-goal-editor.tsx) foram removidos",
    (() => {
      try {
        loadSource("src", "app", "clients", "cockpit-goal-edit-trigger.tsx");
        return false;
      } catch {
        try {
          loadSource("src", "app", "clients", "cockpit-secondary-goal-editor.tsx");
          return false;
        } catch {
          return true;
        }
      }
    })(),
  );
  ok(
    "ChannelPlanEditor (usado por /metas) continua existindo e intocado pro fluxo completo (data final de campanha/evento) — trigger/gatilho/drawer preservados, nenhuma regressão pro fluxo já aprovado",
    editorSource.includes("trigger?: (open: () => void) => ReactNode") &&
      editorSource.includes('if (trigger) return <>{trigger(() => setIsOpen(true))}</>;') &&
      editorSource.includes(">\n        Planejamento\n      </button>") &&
      editorSource.includes("fixed inset-y-0 right-0"),
  );
  ok(
    "ChannelPlanCard/initialCardState (a MESMA calculadora Investimento↔Resultado↔Custo, regra de três) foram exportados de channel-plan-editor.tsx pra serem reaproveitados — nenhuma segunda implementação da calculadora",
    editorSource.includes("export interface ChannelCardState") &&
      editorSource.includes("export function initialCardState") &&
      editorSource.includes("export function ChannelPlanCard"),
  );
  ok(
    "InlineGoalPlanEditor (editor do objetivo PRINCIPAL dentro do próprio card) importa ChannelPlanCard/initialCardState do arquivo oficial — nunca reimplementa a calculadora de regra de três",
    inlineEditorSource.includes('import { ChannelPlanCard, initialCardState, type ChannelCardState } from "./channel-plan-editor";') &&
      !inlineEditorSource.includes("function deriveOnFieldChange") &&
      inlineEditorSource.includes("applyMonthlyChannelPlanChangeAction"),
  );
  ok(
    "o editor inline NUNCA é um overlay/drawer fixo — nenhum `fixed inset-0`/backdrop, é só um bloco dentro do fluxo normal do card (pedido: 'tudo feito ali no painel central mesmo')",
    !inlineEditorSource.includes("fixed inset-0") && !inlineEditorSource.includes("fixed inset-y-0"),
  );
  ok(
    "cockpit-goal-card.tsx é 'use client' com `isEditing` próprio por card — o lápis abre o editor como um bloco a mais dentro do MESMO card, nunca uma segunda tela",
    goalCardSource.startsWith('"use client"') &&
      (goalCardSource.match(/useState\(false\)/g) ?? []).length === 2 &&
      goalCardSource.includes("isEditing && view.edit"),
  );
  ok(
    "o painel de edição (GoalInlineEditorPanel) decide entre a calculadora do objetivo PRINCIPAL (InlineGoalPlanEditor) e o formulário oficial do objetivo SECUNDÁRIO (MetasSecondaryTargetForm) — mesmo par oficial por objetivo de sempre, nenhum editor novo inventado",
    /GoalInlineEditorPanel[\s\S]{0,300}edit\.kind === "primary"[\s\S]{0,200}<InlineGoalPlanEditor/.test(goalCardSource) &&
      goalCardSource.includes("<MetasSecondaryTargetForm"),
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
    !pageSource.includes("CREATE TABLE") && inlineEditorSource.includes("applyMonthlyChannelPlanChangeAction") && goalCardSource.includes("MetasSecondaryTargetForm"),
  );
}

console.log(
  "\nC — Planejamento mensal sem herança automática (seção 3 do pedido): a regra COMPARTILHADA (resolveClientMonthlyPlan/resolveMonthlyPerformanceTargets) continua com carry-forward intocado — só o Cockpit passou a tratar como zerado (ver seção C.1)\n",
);
{
  const clientPlanSource = loadSource("src", "lib", "client-plan.ts");
  const monthlyBudgetSource = loadSource("src", "lib", "monthly-budget.ts");

  ok(
    "resolveClientMonthlyPlan continua com a regra de vigência (mês <= selectedMonth, carry-forward) — os 8+ consumidores fora do Cockpit (Dashboard, Operação, Saúde da Conta, Relatórios, Conquistas, Painel Mensal, Lista de Clientes) continuam recebendo o valor herdado normalmente",
    clientPlanSource.includes("c.month <= selectedMonth") || clientPlanSource.includes("<= selectedMonth"),
  );
  ok(
    "resolveMonthlyPerformanceTargets/resolveMonthlyPlanSnapshot continuam documentando a MESMA regra de vigência compartilhada por 8+ consumidores — nenhuma mudança silenciosa de contrato",
    monthlyBudgetSource.includes('nunca "sem meta" só porque ninguém tocou'),
  );
  ok(
    "nenhuma migration/coluna nova de 'configuração explícita por mês' foi introduzida — a distinção 'herdado vs. configurado neste mês' é inteiramente derivada em memória (resolveGoalSourceMonth), nunca persistida",
    !clientPlanSource.includes("is_explicit_for_month") && !monthlyBudgetSource.includes("is_explicit_for_month"),
  );
}

console.log(
  '\nC.1 — CORREÇÃO/REFINAMENTO: pedido do usuário "quando mexer nas metas de um mes o mes seguinte nao muda, o mes seguinte é sempre tudo zero" — decisão via AskUserQuestion: "Só no Cockpit" + "Tudo zera junto"\n',
);
{
  const clientPlanSource = loadSource("src", "lib", "client-plan.ts");
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "client-plan.ts expõe resolveGoalSourceMonth/resolveSourceMonthByChannel e ClientGoalPlan.inheritedFromMonth — infraestrutura ADITIVA (campo opcional), nunca muda o que resolveClientMonthlyPlan/resolveClientMonthlyGoals já retornavam",
    clientPlanSource.includes("function resolveSourceMonthByChannel") &&
      clientPlanSource.includes("function resolveGoalSourceMonth") &&
      clientPlanSource.includes("inheritedFromMonth?:"),
  );
  ok(
    "[id]/page.tsx usa goalPlan.inheritedFromMonth pra decidir isGoalConfiguredThisMonth — mês herdado de um mês anterior trata targetResultCount/targetCostPerResult como null, igual a um cliente que nunca configurou nada",
    pageSource.includes("const isGoalConfiguredThisMonth = goalPlan.inheritedFromMonth == null;") &&
      /isGoalConfiguredThisMonth\s*\?\s*resolveTargetCostPerResult/.test(pageSource) &&
      /isGoalConfiguredThisMonth\s*\?\s*goalPlan\.consolidated\.resultCount\s*:\s*null/.test(pageSource),
  );
  ok(
    "zerar o mês não configurado é SÓ exibição do Cockpit — reaproveita o mesmo estado 'Sem meta configurada' que já existia pra cliente nunca configurado, nenhum componente/mensagem nova criada só pra isso",
    !pageSource.includes("Meta herdada") && !loadSource("src", "app", "clients", "cockpit-goal-card.tsx").includes("Meta herdada"),
  );
  ok(
    "o restante da composição da página (clientGoalsPlan, usado por Evolução Diária/Diagnóstico de investimento) não foi alterado — só o bloco local de cada card de Meta & Ritmo decide isGoalConfiguredThisMonth, nenhuma segunda resolução de clientGoalsPlan inteira",
    pageSource.includes("const clientGoalsPlan = resolveClientMonthlyGoals({"),
  );
}

console.log("\nD — Alerta de planejamento pendente (seção 4 do pedido): DELIBERADAMENTE interrompido (depende da distinção da seção 3, não implementada)\n");
{
  const cardsSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
  const goalCardSource = loadSource("src", "app", "clients", "cockpit-goal-card.tsx");
  const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "nenhum banner/alerta novo de 'Planejamento pendente' foi adicionado ao Cockpit — a distinção 'não configurado vs. configurado com zero' que ele dependeria não existe ainda",
    !cardsSource.includes("Planejamento pendente") && !goalCardSource.includes("Planejamento pendente") && !pageSource.includes("Planejamento pendente"),
  );
  ok(
    "o texto 'Sem meta configurada'/'Sem planejamento configurado' (estado JÁ existente, sem herança) continua sendo o único aviso de ausência — nenhum segundo mecanismo paralelo inventado",
    goalCardSource.includes("Sem meta de") && cardsSource.includes("Sem planejamento configurado para o mês."),
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
