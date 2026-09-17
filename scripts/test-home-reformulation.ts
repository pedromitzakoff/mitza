/**
 * Etapa "Reformulação da Home — Visão Executiva" — `/` (`src/app/page.tsx`)
 * deixa de ser uma fotografia com Ritmo agregado + Pendências grandes e
 * passa a responder 3 perguntas em sequência: o que está acontecendo?
 * (Desempenho da agência) → o que merece atenção? (Atenção) → o que
 * aconteceu recentemente? (Aconteceu recentemente) — Pendências continua,
 * mas compacto.
 *
 * Este ambiente não tem Supabase real nem DOM/React renderizável — a
 * cobertura é estrutural (mesmo padrão de `test-client-page-facelift.ts`):
 * lê o código-fonte e verifica, via regex sobre o texto (sem comentários),
 * que:
 * 1. KPIs continuam corretos (mesmas fontes/cálculos, sem % vs período
 *    anterior, sem "de R$X planejados").
 * 2. Filtros/contexto (`AgencyFilters`, `buildUrl`) continuam preservados.
 * 3. "Atenção" usa a fonte/regra canônica da OPERAÇÃO (Etapa "Correção da
 *    Home — Atenção por canal", que substitui a versão anterior desta
 *    etapa): `loadOperationChannelStates` + `resolveOperationCpaPriorityGroup`/
 *    `describeOperationCpaReason` (CPA-only, por canal) — nunca mais o
 *    motor de saúde geral/consolidado (`resolveOperationPriorityGroup`),
 *    que podia classificar uma conta diferente da Operação. Testes
 *    dinâmicos (seção 3b) provam com fixtures reais do motor: uma conta
 *    saudável em CPA mas ruim em investimento/resultado/revisão NUNCA
 *    aparece; uma conta crítica em CPA aparece no canal correto.
 * 4. Nenhuma segunda health engine foi criada (nenhuma função
 *    `evaluate*Health` nova em `page.tsx`; a seleção de "atenção" é uma
 *    função pura extraída em `lib/operation-triage.ts`
 *    — `selectAccountsNeedingAttention` — reaproveitando os mesmos
 *    baldes/motivos, nunca uma regra própria do componente).
 * 5. Limite de itens em "Atenção" — por CANAL (3 cada), nunca a carteira
 *    inteira nem um total combinado Meta+Google (que contaria a mesma
 *    conta duas vezes).
 * 6. Ordenação: `selectAccountsNeedingAttention` só filtra + corta —
 *    nenhum `.sort()` novo — reaproveitando a ordem que
 *    `loadOperationChannelStates` já resolve (`sortClientOperationalStates`,
 *    dentro do loader).
 * 7. "Aconteceu recentemente" nunca cria um motor de eventos novo —
 *    reaproveita `fetchAchievements`/`fetchAgencyTimeline`, ambas leituras
 *    já existentes de `operational_events`.
 * 8. Limite de eventos (6), conquistas sempre antes dos eventos operacionais
 *    na composição (`recentActivityAchievementItems` antes de
 *    `recentActivityEventItems` no `[...]`).
 * 9. Pendências continua funcional (mesmas props/ações preservadas em
 *    `RemindersPanel`).
 * 10. Empty state de Pendências é compacto (uma linha, sem os filtros).
 * 11-14. Nenhuma regressão em Operação/Timeline/Conquistas/páginas de
 *    cliente — verificado por este script NÃO tocar em nenhum desses
 *    arquivos-fonte (`operation-triage.ts`, `agency-timeline.ts`,
 *    `achievements-data.ts`, `account-health-engine.ts`,
 *    `client-operational-state-data.ts` continuam com as mesmas
 *    assinaturas já cobertas pelas suites próprias dessas telas —
 *    `test-operation-*.ts`/`test-timeline-detail.ts`/`test-achievement-*.ts`/
 *    `test-account-health-engine.ts`/`test-client-page-facelift.ts`, rodadas
 *    separadamente na suíte completa).
 *
 * Rodar: npx tsx scripts/test-home-reformulation.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAccountHealth, type AccountHealthInput } from "../src/lib/account-health-engine";
import { selectAccountsNeedingAttention, resolveOperationCpaPriorityGroup } from "../src/lib/operation-triage";
import type { ClientOperationalState } from "../src/lib/client-operational-state";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

/** Mesmo fixture mínimo de `test-operation-priority-grouping.ts` — só o que
 * `selectAccountsNeedingAttention` de fato lê (`clientId`/`clientName`/
 * `evaluation`); os demais campos existem só pra satisfazer o tipo. */
function fixtureState(clientId: string, evaluation: ReturnType<typeof evaluateAccountHealth>): ClientOperationalState {
  return {
    clientId,
    clientName: clientId,
    managerId: null,
    managerName: null,
    avatarUrl: null,
    performanceGoal: "sales",
    evaluation,
    overdueTasksCount: 0,
    openTasksCount: 0,
    lastDataSyncAt: null,
    performanceLatestSource: null,
    performanceLastUpdatedAt: null,
    diagnostics: {
      planejamento: { items: [], isIncomplete: false },
      cpa: null,
      investment: { value: 0, expected: null, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false },
      pendencias: { count: 0, items: [], hasPendencias: false },
      atividade: { lastActivityAt: null, hoursSinceLastActivity: null, isOverdue: false },
    },
  };
}

function baseHealthInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    investmentActual: 500,
    investmentPlanned: 1000,
    investmentHasSyncedData: true,
    resultActual: 10,
    resultPlanned: 10,
    hasPerformanceData: true,
    performanceGoalConfigured: true,
    costActual: 50,
    costPlanned: 50,
    monthExpectedPct: 50,
    reviewBusinessDaysAgo: 5,
    reviewMaxBusinessDays: 10,
    ...overrides,
  };
}

const homePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8"));
const remindersPanelSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "reminders-panel.tsx"), "utf8"));
const spendStatusLibSource = readFileSync(join(__dirname, "..", "src", "lib", "spend-status.ts"), "utf8");

console.log("\n1 — KPIs continuam corretos: mesmas fontes/cálculos, sem comparação percentual/textos removidos anteriormente\n");
{
  ok("Investimento vem de financial.actual/channelActualTotal (mesma fonte de sempre)", /financial\.actual : \(channelActualTotal \?\? 0\)/.test(homePageSource));
  ok("Leads/Vendas vêm de agencyResults (computeHealthResultsSummary/computeAgencyResultsByChannel, sem recálculo)", /agencyResults\.leads\.count/.test(homePageSource) && /agencyResults\.sales\.count/.test(homePageSource));
  ok("Contas ativas vem de operationIndicators.activeClientsCount (fonte central, sem recálculo)", /operationIndicators\.activeClientsCount/.test(homePageSource));
  ok("nenhum 'comparison'/% vs período anterior foi reintroduzido no OperationMetric dos KPIs", !/comparison=/.test(homePageSource));
  ok("Contas ativas não repete mais o link de atenção embutido (evita duplicar a seção Atenção)", !/label="Contas ativas"[\s\S]{0,120}linkHref/.test(homePageSource));
}

console.log("\n2 — Filtros/contexto continuam preservados (AgencyFilters, buildUrl, seletor de canal)\n");
{
  ok("AgencyFilters continua recebendo manager/clients/diagnostico/resultType/ritmo/platform (nenhuma prop removida)", /manager=\{managerFilter\}[\s\S]*clients=\{clientOptions\}[\s\S]*diagnostico=\{diagnosticFilter\}[\s\S]*resultType=\{resultTypeFilter\}[\s\S]*ritmo=\{ritmoFilter/.test(homePageSource));
  ok("platform continua sendo prop de AgencyFilters (seletor de canal intocado)", /platform=\{platformFilter\}/.test(homePageSource));
  ok("buildUrl continua preservando manager/client/diagnostico/resultType/ritmo/platform", /next\.set\("manager", managerFilter\)/.test(homePageSource) && /if \(platformFilter !== "consolidado"\) next\.set\("platform", platformFilter\)/.test(homePageSource));
  ok("monthNav (navegação de mês) continua sendo passado pra AgencyFilters", /monthNav=\{monthNav\}/.test(homePageSource));
}

console.log('\n3 — "Atenção" usa a fonte/regra canônica da OPERAÇÃO: CPA-only, por canal — nunca o motor de saúde geral/consolidado\n');
{
  ok(
    "page.tsx importa loadOperationChannelStates (MESMA pipeline de /operation) — nenhum wrapper/query própria",
    /import \{ loadOperationChannelStates \} from "@\/lib\/operation-channel-state-data"/.test(homePageSource),
  );
  ok(
    "chama loadOperationChannelStates uma vez por canal (meta/google), goal 'todos' — mesma população default da Operação",
    /loadOperationChannelStates\(supabase, monthRange\.firstDay, "meta", "todos"\)/.test(homePageSource) &&
      /loadOperationChannelStates\(supabase, monthRange\.firstDay, "google", "todos"\)/.test(homePageSource),
  );
  ok(
    "usa selectAccountsNeedingAttention (lib/operation-triage.ts) — a mesma seleção CPA-only da Operação, nunca reescrita aqui",
    /import \{ selectAccountsNeedingAttention, type AttentionSummaryClient \} from "@\/lib\/operation-triage"/.test(homePageSource) &&
      /selectAccountsNeedingAttention\(scopeOperationStatesToHomeFilters\(states\), ATTENTION_LIST_LIMIT_PER_CHANNEL\)/.test(homePageSource),
  );
  ok(
    "page.tsx NUNCA importa/usa resolveOperationPriorityGroup (motor geral/consolidado) pra esta seção",
    !/resolveOperationPriorityGroup/.test(homePageSource),
  );
  ok("nenhum total combinado Meta+Google — cada canal tem seu próprio count/lista, nunca somados", !/metaAttentionSummary\.count \+ google/.test(homePageSource) && !/needsAttentionCount/.test(homePageSource));
  ok(
    'CTA "Ver Operação" de cada canal abre a Operação já naquele canal (?channel=meta/?channel=google), nunca sem canal',
    /operationHref: `\/operation\?month=\$\{monthRange\.firstDay\}&channel=\$\{channel\}`/.test(homePageSource),
  );
}

console.log("\n3b — Dinâmico (fixtures reais do motor): CPA saudável mas ruim em investimento/resultado/revisão NUNCA aparece em Atenção\n");
{
  // Investimento MUITO acima do esperado (grave) + resultado MUITO abaixo
  // (grave) + revisão nunca feita (grave) — só o CUSTO está saudável
  // (actual === planned, desvio 0). Se `selectAccountsNeedingAttention`
  // olhasse pra qualquer dimensão fora de custo/qualidade de dado, esta
  // conta apareceria — ela NUNCA deve, porque a Operação (CPA-only) também
  // nunca a mostraria.
  const evaluation = evaluateAccountHealth(
    baseHealthInput({
      investmentActual: 5000,
      investmentPlanned: 1000,
      // resultActual >= MIN_RELIABLE_RESULT_COUNT (3) — amostra confiável
      // pro CUSTO (que usa o mesmo `resultActual` como tamanho de amostra),
      // mas ainda MUITO abaixo do esperado (10) pra ficar "grave" no eixo
      // Resultado — os dois fatos precisam coexistir pra provar que só o
      // custo decide "Atenção" mesmo com resultado também grave.
      resultActual: 4,
      resultPlanned: 20,
      costActual: 50,
      costPlanned: 50,
      reviewBusinessDaysAgo: null,
    }),
  );
  ok("pré-condição do fixture: investimento/resultado/revisão realmente graves", evaluation.dimensions.investment.status === "grave" && evaluation.dimensions.results.status === "grave" && evaluation.dimensions.review.status === "grave");
  ok("pré-condição do fixture: custo (CPA) permanece saudável", evaluation.dimensions.cost.status === "nenhum");
  ok(
    'a Operação (resolveOperationCpaPriorityGroup) classifica esta conta como "saudavel", nunca crítica/atenção',
    resolveOperationCpaPriorityGroup(evaluation) === "saudavel",
  );

  const summary = selectAccountsNeedingAttention([fixtureState("cliente-cpa-saudavel", evaluation)], 5);
  ok('"Atenção" da Home NUNCA lista esta conta (count === 0)', summary.count === 0);
  ok('"Atenção" da Home NUNCA lista esta conta (clients === [])', summary.clients.length === 0);
}

console.log('\n3c — Dinâmico: conta com CPA crítico aparece em "Atenção", com o motivo correto — nunca investimento/resultado/revisão\n');
{
  // Único problema real: custo 80% acima da meta (grave), com amostra
  // confiável (>= MIN_RELIABLE_RESULT_COUNT) e investimento/resultado/
  // revisão saudáveis — prova que o motivo mostrado é sempre sobre CUSTO,
  // nunca as outras dimensões, mesmo quando elas TAMBÉM existem no
  // `evaluation` completo (o motor sempre as calcula).
  const evaluation = evaluateAccountHealth(
    baseHealthInput({
      // monthExpectedPct é 50 (padrão de baseHealthInput) — investimento/
      // resultado no valor exatamente ESPERADO até hoje (desvio 0), pra
      // garantir que as duas dimensões fiquem genuinamente saudáveis, não
      // só "dentro da margem por acaso".
      investmentActual: 250,
      investmentPlanned: 500,
      resultActual: 5,
      resultPlanned: 10,
      costActual: 90,
      costPlanned: 50,
      reviewBusinessDaysAgo: 2,
    }),
  );
  ok("pré-condição do fixture: investimento/resultado/revisão saudáveis", evaluation.dimensions.investment.status === "nenhum" && evaluation.dimensions.results.status === "nenhum" && evaluation.dimensions.review.status === "nenhum");
  ok('a Operação classifica esta conta como "critico" (só o custo decide)', resolveOperationCpaPriorityGroup(evaluation) === "critico");

  const metaStates = [fixtureState("cliente-cpa-critico", evaluation)];
  const googleStates: ClientOperationalState[] = [];
  const metaSummary = selectAccountsNeedingAttention(metaStates, 3);
  const googleSummary = selectAccountsNeedingAttention(googleStates, 3);

  ok("aparece no canal Meta (canal de onde veio o estado)", metaSummary.count === 1 && metaSummary.clients[0]?.clientId === "cliente-cpa-critico");
  ok("NÃO aparece no canal Google (população/estado são independentes por canal)", googleSummary.count === 0);
  ok(
    "o motivo é sempre sobre custo/qualidade de dado — nunca menciona investimento/resultado/revisão",
    /custo/i.test(metaSummary.clients[0]?.reason ?? "") &&
      !/investimento|resultado (abaixo|acima)|revisão/i.test(metaSummary.clients[0]?.reason ?? ""),
  );
}

console.log("\n4 — Nenhuma segunda health engine foi criada\n");
{
  ok("page.tsx não define nenhuma função evaluate*Health/evaluateAccountHealth própria", !/function evaluate\w*[Hh]ealth/.test(homePageSource));
  ok("page.tsx não define nenhum resolve*PriorityGroup/selectAccountsNeedingAttention próprio (só importa os existentes)", !/function resolve\w*PriorityGroup/.test(homePageSource) && !/function selectAccountsNeedingAttention/.test(homePageSource));
  ok("evaluateAccountHealth só é importado indiretamente (isReviewOverdue), nunca redefinido em page.tsx", /import \{ isReviewOverdue \} from "@\/lib\/account-health-engine"/.test(homePageSource) && !/function evaluateAccountHealth/.test(homePageSource));
}

console.log('\n5 — Limite de itens em "Atenção" — por canal (3 cada), nunca a carteira inteira\n');
{
  ok("ATTENTION_LIST_LIMIT_PER_CHANNEL = 3", /const ATTENTION_LIST_LIMIT_PER_CHANNEL = 3/.test(homePageSource));
  ok("o limite é repassado a selectAccountsNeedingAttention (mesmo corte da função canônica, nunca um .slice próprio em page.tsx)", /selectAccountsNeedingAttention\([\s\S]{0,80}ATTENTION_LIST_LIMIT_PER_CHANNEL\)/.test(homePageSource));
}

console.log("\n6 — Ordenação: selectAccountsNeedingAttention só filtra + corta, nenhum sort novo (verificado na própria lib)\n");
{
  const operationTriageSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "operation-triage.ts"), "utf8"));
  const selectFnMatch = /export function selectAccountsNeedingAttention\([\s\S]*?\n\}/.exec(operationTriageSource);
  ok("função selectAccountsNeedingAttention encontrada em operation-triage.ts", selectFnMatch !== null);
  const selectFnBody = selectFnMatch?.[0] ?? "";
  ok("...usa .filter (mesmo balde de sempre)", /\.filter\(/.test(selectFnBody));
  ok("...usa .slice (corte de exibição)", /\.slice\(/.test(selectFnBody));
  ok("...NUNCA usa .sort() — reaproveita a ordem que o loader já resolveu", !/\.sort\(/.test(selectFnBody));
}

console.log('\n7 — "Aconteceu recentemente" nunca cria um motor de eventos novo\n');
{
  ok("importa fetchAchievements da camada de leitura já existente de Conquistas", /import \{ fetchAchievements \} from "@\/lib\/achievements-data"/.test(homePageSource));
  ok("importa fetchAgencyTimeline da Timeline Geral já existente (curada)", /import \{ fetchAgencyTimeline \} from "@\/lib\/agency-timeline"/.test(homePageSource));
  ok("nenhuma nova constante de OperationalEventType/tabela é definida em page.tsx", !/OperationalEventType\.\w+\s*=/.test(homePageSource) && !/from\("operational_events"\)/.test(homePageSource));
  ok('scope "client" reaproveitado (nenhum novo scope inventado)', /fetchAchievements\(supabase, profile\.organizationId, \{ scope: "client" \}/.test(homePageSource));
}

console.log('\n8 — Limite de eventos (6) e conquistas sempre antes dos eventos operacionais na composição\n');
{
  ok("RECENT_ACTIVITY_LIMIT = 6", /const RECENT_ACTIVITY_LIMIT = 6/.test(homePageSource));
  ok(
    "recentActivity concatena conquistas ANTES dos eventos operacionais (nunca o inverso, nunca um sort por peso/score)",
    /const recentActivity = \[\.\.\.recentActivityAchievementItems, \.\.\.recentActivityEventItems\]\.slice\(0, RECENT_ACTIVITY_LIMIT\)/.test(
      homePageSource,
    ),
  );
  ok("achievements buscados com pageSize 3, eventos com pageSize 6 (nenhuma query pesada)", /\{ scope: "client" \}, 0, 3\)/.test(homePageSource) && /"todos" \}, 0, 6\)/.test(homePageSource));
}

console.log("\n9 — Pendências continua funcional: mesmas ações/props preservadas em RemindersPanel\n");
{
  ok("addHref (+ Adicionar pendência) preservado", /addHref=\{addReminderHref\}/.test(homePageSource) && /addHref,/.test(remindersPanelSource));
  ok("completedHref (Ver concluídas) preservado", /completedHref=\{openCompletedRemindersHref\}/.test(homePageSource) && /completedHref,/.test(remindersPanelSource));
  ok("buildFilterHref (chips Todas/Agência/Clientes/Minhas) preservado", /buildFilterHref=\{buildReminderFilterHref\}/.test(homePageSource) && /FILTERS\.map/.test(remindersPanelSource));
  ok("buildEditHref (editar pendência por linha) preservado", /buildEditHref=\{buildReminderEditHref\}/.test(homePageSource) && /buildEditHref\(reminder\.id\)/.test(remindersPanelSource));
  ok("novo controle de expandir/recolher (Ver todas) chega via props explícitas, nunca client-state efêmero perdido no reload", /expanded=\{pendenciaExpandirFilter\}/.test(homePageSource) && /expandHref,\s*\n\s*collapseHref,/.test(remindersPanelSource));
}

console.log("\n10 — Empty state de Pendências é compacto (uma linha, sem filtros/chips quando não há nenhuma pendência)\n");
{
  ok(
    'counts.openCount === 0 renderiza só "Nenhuma pendência em aberto." — sem os chips de filtro nesse ramo',
    /counts\.openCount === 0 \? \(\s*<p[^>]*>Nenhuma pendência em aberto\.<\/p>/.test(remindersPanelSource),
  );
  ok("painel deixou de ser um card com borda própria (rounded-lg/border/bg-overview-surface removidos)", !/rounded-lg border border-overview-border bg-overview-surface/.test(remindersPanelSource));
  ok("lista de pendências (quando existe) continua capada (REMINDERS_HOME_VISIBLE_LIMIT) com 'Ver todas' explícito", /const REMINDERS_HOME_VISIBLE_LIMIT = 5/.test(remindersPanelSource) && /Ver todas as \{reminders\.length\} pendências/.test(remindersPanelSource));
}

console.log('\n11 — "Ritmo de investimento" (agregado da agência) foi removido da Home, sem quebrar consumidores compartilhados\n');
{
  ok("bloco 'Ritmo de investimento' não existe mais em page.tsx", !/Ritmo de investimento/.test(homePageSource));
  ok("ProgressBar (componente compartilhado) não é mais importado/usado aqui", !/ProgressBar/.test(homePageSource));
  ok("getMonthTemporalStatus não é mais importado/usado aqui", !/getMonthTemporalStatus/.test(homePageSource));
  ok("classifySpendStatus (função) não é mais importado aqui — só o tipo SpendStatus continua (ainda usado por RitmoFilter/monthStatus)", /import type \{ SpendStatus \} from "@\/lib\/spend-status"/.test(homePageSource) && !/classifySpendStatus\(/.test(homePageSource));
  ok("PrimaryInvestmentMetric não é mais importado aqui", !/PrimaryInvestmentMetric/.test(homePageSource));
  ok(
    "classifySpendStatus/SPEND_STATUS_MARGIN continuam intocados em spend-status.ts (função compartilhada preservada, só parou de ser consumida aqui)",
    /export function classifySpendStatus/.test(spendStatusLibSource) && /export const SPEND_STATUS_MARGIN = 0\.2/.test(spendStatusLibSource),
  );
}

console.log("\n12 — filtro de Ritmo (popover de Filtros, recorte de clientes) continua intacto — distinto da seção removida\n");
{
  ok("RitmoFilter/ritmoFilter continuam existindo e filtrando filteredBase (recorte de clientes pros KPIs)", /type RitmoFilter = "todos" \| SpendStatus \| "fora_do_ritmo"/.test(homePageSource) && /card\.monthStatus === ritmoFilter/.test(homePageSource));
  ok("AgencyFilters continua recebendo o prop ritmo (popover de Filtros inalterado)", /ritmo=\{ritmoFilter === "fora_do_ritmo" \? "todos" : ritmoFilter\}/.test(homePageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
