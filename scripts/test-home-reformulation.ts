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
 * 3. "Atenção" usa a fonte/regra canônica (`resolveOperationPriorityGroup`,
 *    o motor de saúde CONSOLIDADO de 5 dimensões) — nunca o balde
 *    CPA-por-canal da Operação (`resolveOperationCpaPriorityGroup`).
 * 4. Nenhuma segunda health engine foi criada (nenhuma função
 *    `evaluate*Health`/`resolveAttention*` nova em `page.tsx`).
 * 5. Limite de itens em "Atenção" (5).
 * 6. Ordenação: `attentionClients` deriva de `indicatorStates`
 *    (já ordenado por `sortClientOperationalStates` dentro do loader),
 *    nenhum `.sort()` novo é aplicado a ele.
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

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
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

console.log('\n3 — "Atenção" usa a fonte/regra canônica: motor de saúde CONSOLIDADO (5 dimensões), nunca o balde CPA-por-canal da Operação\n');
{
  ok(
    "attentionClients usa resolveOperationPriorityGroup (motor consolidado geral, mesmo já usado por needsAttentionCount)",
    /resolveOperationPriorityGroup\(state\.evaluation\)/.test(homePageSource),
  );
  ok(
    "attentionClients NUNCA usa resolveOperationCpaPriorityGroup (balde CPA-por-canal, exclusivo da Operação)",
    !/resolveOperationCpaPriorityGroup/.test(homePageSource),
  );
  ok("attentionClients deriva de indicatorStates (já filtrado por gestor/cliente, mesma fonte de needsAttentionCount)", /const attentionClients = indicatorStates/.test(homePageSource));
  ok("motivo exibido é evaluation.primaryReason (mesma frase da Operação/página do cliente, nunca um texto novo)", /\{state\.evaluation\.primaryReason\}/.test(homePageSource));
  ok(
    'aviso explícito quando o filtro de plataforma não é Consolidado (nunca finge filtrar "Atenção" por canal)',
    /platformFilter !== "consolidado"[\s\S]{0,200}Sempre considera a conta inteira/.test(homePageSource),
  );
  ok('link "Ver Operação" usa o mesmo operationHref de sempre (nenhuma segunda URL)', /href=\{operationHref\}[\s\S]{0,300}Ver Operação/.test(homePageSource));
}

console.log("\n4 — Nenhuma segunda health engine foi criada\n");
{
  ok("page.tsx não define nenhuma função evaluate*Health/evaluateAccountHealth própria", !/function evaluate\w*[Hh]ealth/.test(homePageSource));
  ok("page.tsx não define nenhum resolveAttention*/resolve*PriorityGroup próprio (só importa os existentes)", !/function resolve\w*(Attention|PriorityGroup)/.test(homePageSource));
  ok("evaluateAccountHealth só é importado (isReviewOverdue), nunca redefinido aqui", /import \{ isReviewOverdue \} from "@\/lib\/account-health-engine"/.test(homePageSource) && !/function evaluateAccountHealth/.test(homePageSource));
}

console.log('\n5 — Limite de itens em "Atenção" (5, "poucas contas, não a carteira inteira")\n');
{
  ok("ATTENTION_LIST_LIMIT = 5", /const ATTENTION_LIST_LIMIT = 5/.test(homePageSource));
  ok("attentionClients corta com .slice(0, ATTENTION_LIST_LIMIT)", /\.slice\(0, ATTENTION_LIST_LIMIT\)/.test(homePageSource));
}

console.log("\n6 — Ordenação: attentionClients reaproveita a ordem já resolvida pelo loader, nenhum sort novo\n");
{
  ok(
    "attentionClients só filtra (.filter) + corta (.slice) — nenhum .sort() aplicado sobre indicatorStates/attentionClients",
    /const attentionClients = indicatorStates\s*\n\s*\.filter\(/.test(homePageSource) && !/attentionClients[\s\S]{0,5}\.sort\(/.test(homePageSource),
  );
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
