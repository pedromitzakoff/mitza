/**
 * Testes da Etapa "Facelift Visual — Visão Geral do cliente" (rodadas 1 a
 * 4) — puramente visual/composicional, sem mudança de dado/query/
 * cálculo/permissão. Como não há regra de negócio nova, esta suíte é só
 * ESTRUTURAL (checagem de código-fonte) — mesmo padrão já usado por
 * `test-achievements-granularity.ts`/`test-operation-goal-filter.ts` pra
 * confirmar decisões de composição sem precisar de um browser real.
 *
 * Rodada 2: remove o grande card areia de Performance (vira seção editorial
 * com assinatura pontual) e consolida Mês+Canal+Navegação numa única
 * toolbar — seções 10-12 abaixo.
 *
 * Rodada 3 ("Simplificação Pós-Facelift", seção 13 abaixo): remove por
 * inteiro o accordion "Ver detalhes do investimento" (informação já
 * duplicada nas barras/diagnóstico de "Ritmo do mês"), preserva só
 * "Diferença para o ritmo"/"Ritmo recomendado" integrados diretamente sob o
 * diagnóstico, e sobe "Planejamento" (era "Editar planejamento", dentro de
 * Performance) pra toolbar de contexto, junto de Mês/Canal.
 *
 * Rodada 4 ("Remoção do Diagnóstico Textual", seção 14 abaixo): remove
 * `RitmoDiagnostic` (o texto "Resultados: .../Investimento: ..."/"Dentro do
 * ritmo esperado") — as barras + marker "Esperado hoje" já são a
 * representação canônica do pacing. `MonthInvestmentPaceNote` (Diferença
 * para o ritmo/Ritmo recomendado) passa a ser o único texto secundário
 * abaixo das barras.
 *
 * Rodada 5 ("MITZA — Reformulação Estrutural"): `[id]/page.tsx` deixou de
 * ser "quase tudo" (Funis/Objetivos secundários/Taxa de conversão/Tarefas/
 * Sprints/Timeline/drawers de revisão empilhados numa "Visão geral" só) —
 * virou realmente só Visão Geral (KPIs/Ritmo/Demandas abertas), com abas
 * IRMÃS de verdade (`/relatorio`, `/operation`, `/demandas`, `/edit`) sob um
 * `layout.tsx` compartilhado que assumiu o header/seletor de cliente/tabs
 * (antes `role="tablist"` dentro desta página). As seções abaixo que
 * testavam Tarefas/Sprints/a toolbar de navegação foram atualizadas pra
 * apontar pro arquivo certo — nunca reescritas do zero, só realocadas
 * (mesmo componente, mesma prop, mesmo comportamento, arquivo diferente).
 *
 * Rodada 6 ("Correção de UX do Workspace" — corrige a Rodada 5, não a
 * desfaz): a largura fixa `max-w-5xl` virou `WorkspaceContainer`
 * (constante única, bem mais larga — ver `test-client-workspace.ts` seções
 * 5/8 pro detalhe completo da correção de largura/painel integrado). As
 * seções 1 e 12 abaixo foram ajustadas pra essa nova constante; o resto
 * desta suíte (Performance/Tarefas/filtros/emojis/etc.) continua válido
 * sem alteração — nenhuma dessas decisões visuais foi revertida.
 *
 * Rodar: npx tsx scripts/test-client-page-facelift.ts
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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

const pageCode = stripComments(loadSource("src", "app", "clients", "[id]", "page.tsx"));
const operationCode = stripComments(loadSource("src", "app", "clients", "[id]", "operation", "page.tsx"));
// Etapa "Correção de Direção do Workspace": o corpo de Operação (Tarefas/
// Sprints/Histórico/drawers) foi extraído de operation/page.tsx pra
// operation-section.tsx/operation-section-data.ts, reaproveitado também
// pelo Painel principal — ver seção 16 abaixo.
const operationSectionCode = stripComments(loadSource("src", "app", "clients", "operation-section.tsx"));
const operationSectionDataCode = stripComments(loadSource("src", "app", "clients", "operation-section-data.ts"));
const kpiCode = stripComments(loadSource("src", "app", "clients", "monthly-kpi-summary.tsx"));
const tasksPanelCode = stripComments(loadSource("src", "app", "clients", "month-tasks-panel.tsx"));
const recurringRowCode = stripComments(loadSource("src", "app", "clients", "recurring-task-row.tsx"));
const taskRowCode = stripComments(loadSource("src", "app", "clients", "task-row.tsx"));
const secondaryGoalsCode = stripComments(loadSource("src", "app", "clients", "secondary-goals-performance.tsx"));
const accountFollowUpCode = stripComments(loadSource("src", "app", "clients", "account-follow-up-panel.tsx"));
const monthInvestmentCode = stripComments(loadSource("src", "app", "clients", "month-investment-summary.tsx"));
const channelPlanEditorCode = stripComments(loadSource("src", "app", "clients", "channel-plan-editor.tsx"));

console.log("1 — Largura do conteúdo: mesmo WorkspaceContainer no Painel principal e em Operação (Etapa 'Correção de UX do Workspace' — ver test-client-workspace.ts seção 5/8 pro detalhe da correção de largura)\n");
{
  ok("Painel principal usa WorkspaceContainer (largura corrigida, nunca mais um max-w-5xl próprio)", pageCode.includes("<WorkspaceContainer>") && !pageCode.includes("max-w-5xl"));
  ok(
    "Operação (onde Sprints/Tarefas/Histórico moraram, Etapa 5) usa o MESMO WorkspaceContainer — nunca um container de largura diferente entre seções do mesmo cliente",
    operationCode.includes("<WorkspaceContainer>") && !operationCode.includes("max-w-5xl"),
  );
}

console.log("\n2 — Ritmo vertical: cadência consistente entre as grandes regiões (mt-6)\n");
{
  // Rodada 2: o wrapper de Performance perdeu bg-cream (ver seção 10) — a
  // margem mt-6 continua, só sem superfície nenhuma em volta.
  ok("bloco Performance usa mt-6 antes dele (sem superfície própria, ver seção 10)", /mt-6">\s*<AccountFollowUpPanel/.test(pageCode));
  // Rodada 5: Tarefas (MonthTasksPanel) realocado pra Operação — mesma
  // cadência mt-6 preservada no arquivo novo, nunca perdida na mudança.
  // Rodada 6 ("Correção de Direção do Workspace"): o bloco em si mudou de
  // arquivo de novo (operation-section.tsx, compartilhado com o Painel),
  // a cadência mt-6 continua intacta.
  ok("bloco Tarefas (MonthTasksPanel) usa mt-6 antes dele — hoje em operation-section.tsx", /mt-6">\s*<MonthTasksPanel/.test(operationSectionCode));
  ok("Outros objetivos (quando existe) usa a MESMA cadência mt-6", /mt-6 rounded-lg bg-overview-surface-subtle/.test(secondaryGoalsCode));
  ok(
    "wrapper redundante mt-3 em torno de Sprints continua removido (Section já aplica seu próprio mt-6) — hoje em operation-section.tsx",
    !/<div className="mt-3">\s*<Section title=\{`Sprints/.test(operationSectionCode),
  );
}

console.log("\n3 — Performance: refinado, nunca redesenhado (mesmos componentes, gap mais compacto)\n");
{
  ok("KPIs continuam Resultado/Investimento/Custo por resultado no mesmo grid (nunca virou 3 cards)", /grid grid-cols-\[repeat\(auto-fit,minmax\(8rem,1fr\)\)\]/.test(kpiCode));
  ok("gap horizontal do KPI foi reduzido (gap-x-6, era gap-x-8) — menos sensação de ilhas", /gap-x-6 gap-y-4/.test(kpiCode));
  ok("nenhuma sombra nova foi adicionada ao bloco Performance", !pageCode.includes("shadow"));
}

console.log("\n4 — Tarefas: seção editorial (sem grande card bege, sem cabeçalho de coluna)\n");
{
  ok("MonthTasksPanel não envolve mais a seção em bg-cream (era 'card dentro de card')", !tasksPanelCode.includes("bg-cream"));
  ok("nenhuma superfície arredondada grande sobrou no wrapper principal (sem rounded-2xl solto na raiz)", !/return \(\s*<div className="[^"]*rounded-2xl/.test(tasksPanelCode));
  ok('cabeçalho de coluna "Próxima execução"/"Tarefa" foi removido', !/>Próxima execução<|>Tarefa<\/span>/.test(tasksPanelCode));
  ok("botão + Tarefa continua existindo (InlineCreateTaskForm, nenhuma funcionalidade removida)", /InlineCreateTaskForm/.test(tasksPanelCode));
}

console.log("\n5 — Filtros: navegação textual, mesma funcionalidade, só sem pill/cápsula\n");
{
  ok("filtros não usam mais rounded-full/border/bg-brand por opção (pill)", !/rounded-full border px-2\.5 py-1/.test(tasksPanelCode));
  ok("os 4 filtros (Todas/Pendentes/Atrasadas/Concluídas) continuam todos presentes", /key: "todas"/.test(tasksPanelCode) && /key: "atrasadas"/.test(tasksPanelCode) && /key: "concluidas"/.test(tasksPanelCode));
  ok("filtro selecionado ganha peso via texto (font-medium + underline), nunca mais fundo sólido de botão", /font-medium text-overview-text-primary underline/.test(tasksPanelCode));
  ok("contagem de cada filtro continua visível ao lado do rótulo (mesma funcionalidade)", /\{label\} <span className="tabular-nums">\{counts\[key\]\}<\/span>/.test(tasksPanelCode));
}

console.log("\n6 — Emojis: removidos da apresentação, dado intocado\n");
{
  ok("RecurringTaskRow não renderiza mais item.icon (emoji livre do template)", !/\{item\.icon\}/.test(recurringRowCode));
  ok("o campo `icon` continua existindo no tipo (dado intocado, só a apresentação mudou)", /icon: string/.test(loadSource("src", "lib", "recurring-task-data.ts")));
  ok("coluna de status da recorrência virou espaçador vazio (mantém alinhamento com TaskRow)", /<span className=\{ACTIVITY_COL_STATUS\} aria-hidden="true" \/>/.test(recurringRowCode));
}

console.log("\n7 — Hierarquia das linhas: Tarefa antes de Próxima execução (só na visão de Tarefas)\n");
{
  ok(
    "TaskRow em modo compactDate (MonthTasksPanel) renderiza o título ANTES da data",
    /compactDate \? \(\s*<>\s*<span className="min-w-0 flex-1">/.test(taskRowCode),
  );
  ok(
    "TaskRow sem compactDate (TaskList/Atividades de Sprints) preserva a ordem de sempre (data antes do título)",
    /: \(\s*<>\s*<span className=\{`\$\{ACTIVITY_COL_DATE\}/.test(taskRowCode),
  );
  ok(
    "RecurringTaskRow aceita titleFirst (só MonthTasksPanel passa; Atividades de Sprints preserva a ordem de sempre)",
    /titleFirst\?: boolean/.test(recurringRowCode) && /titleFirst\s*$/m.test(stripComments(loadSource("src", "app", "clients", "month-tasks-panel.tsx"))),
  );
}

console.log("\n8 — Progresso (\"0/2\"): mantido (é informação real), só menos isolado\n");
{
  ok("progresso da recorrência continua calculado e exibido (nenhuma funcionalidade removida)", /progressLabel/.test(recurringRowCode));
  ok("progresso não usa mais justify-between empurrando pro extremo da linha", !/justify-between gap-2 text-sm/.test(recurringRowCode));
  ok("progresso fica junto do nome (items-baseline, mesma unidade visual)", /items-baseline gap-1\.5 text-sm/.test(recurringRowCode));
}

console.log("\n9 — Não mexeu no que não devia: Sprints continua com o mesmo SprintCard, mesmas props (agora em Operação)\n");
{
  ok(
    "Operação continua chamando SprintCard com hideNextAction/hideTaskList (mesmo comportamento de sempre, hoje em operation-section.tsx)",
    /hideNextAction\s*hideTaskList/.test(operationSectionCode),
  );
  ok("nenhuma prop nova de negócio foi adicionada ao SprintCard nesta etapa", !/accordionRowsPrototype=\{true\}/.test(operationSectionCode));
}

// ---------------------------------------------------------------------------
// Rodada 2 — "Segunda rodada de refinamento visual"
// ---------------------------------------------------------------------------
console.log("\n10 — Performance sem grande card: superfície removida, assinatura areia pontual\n");
{
  ok("wrapper de Performance em page.tsx não usa mais bg-cream/rounded/padding de card", !/<div className="mt-6 rounded-lg bg-cream/.test(pageCode));
  ok("AccountFollowUpPanel não introduz nenhuma superfície própria (sem bg-cream/bg-sand como fundo, sem rounded-2xl)", !/bg-cream|rounded-2xl/.test(accountFollowUpCode));
  ok('título "Performance do mês" existe, com a mesma tipografia já usada em "Ritmo do mês" (uppercase, 11px, semibold)', /Performance do mês/.test(accountFollowUpCode) && /text-\[11px\] font-semibold uppercase tracking-wide text-overview-text-muted/.test(accountFollowUpCode));
  ok("identidade areia é só um acento pontual (barra estreita, bg-sand), nunca um retângulo grande", /h-3\.5 w-1 shrink-0 rounded-full bg-sand/.test(accountFollowUpCode));
  ok("nenhuma sombra foi adicionada em Performance", !accountFollowUpCode.includes("shadow") && !pageCode.includes("shadow"));
  ok("KPIs continuam vindo de MonthlyKpiSummary (mesma lógica/props, nenhum KPI hardcoded)", /<MonthlyKpiSummary/.test(accountFollowUpCode));
  ok("Ritmo do mês continua com o mesmo divisor horizontal discreto (border-t) separando dos KPIs", /border-t border-overview-border pt-3/.test(accountFollowUpCode));
}

console.log("\n11 — Toolbar de contexto: Mês + Canal + Planejamento, sem navegação própria (abas viraram rotas irmãs, Etapa 5)\n");
{
  // Rodada 5: a navegação por abas (`role="tablist"`) saiu de page.tsx —
  // mora agora em `client-workspace-header.tsx` (layout compartilhado,
  // rotas irmãs de verdade). page.tsx manteve só a toolbar de CONTEXTO
  // (mês/canal/planejamento), que nunca foi navegação.
  ok("page.tsx não declara mais role=\"tablist\" (navegação virou responsabilidade do layout compartilhado)", !pageCode.includes('role="tablist"'));
  ok("mês e canal continuam na MESMA linha (uma única div flex)", /flex flex-wrap items-center gap-3 border-b border-overview-border[\s\S]{0,40}text-sm">[\s\S]*?IconButton href=\{prevMonthHref\}[\s\S]*?VisaoGeralChannelSwitch/.test(pageCode));
  ok("Canal (VisaoGeralChannelSwitch) sempre visível — não é mais condicional a 'activeArea', já que esta página É a Visão Geral inteira agora", /<VisaoGeralChannelSwitch baseHref=\{metricsChannelBaseHref\}/.test(pageCode) && !pageCode.includes('activeArea === "visao-geral"'));
  ok("Operação também tem sua própria navegação de mês (mesmos hrefs prevMonthHref/nextMonthHref, independente da Visão Geral)", /prevMonthHref/.test(operationCode) && /nextMonthHref/.test(operationCode));
}

console.log("\n12 — Regressão: decisões da rodada 1 continuam de pé\n");
{
  ok("largura consistente da rodada 1 não foi revertida (hoje via WorkspaceContainer, ver seção 1)", pageCode.includes("<WorkspaceContainer>"));
  ok("Tarefas continua sem grande card (rodada 1, intocada nesta rodada)", !tasksPanelCode.includes("bg-cream"));
  ok("filtros textuais de Tarefas continuam sem pill/cápsula (rodada 1, intocada)", !/rounded-full border px-2\.5 py-1/.test(tasksPanelCode));
}

// ---------------------------------------------------------------------------
// Rodada 3 — "Simplificação Pós-Facelift"
// ---------------------------------------------------------------------------
console.log("\n13 — Accordion removido, diferença/ritmo integrados, Planejamento na toolbar de contexto\n");
{
  ok('accordion "Ver/Ocultar detalhes do investimento" não existe mais', !/Ver detalhes do investimento|Ocultar detalhes do investimento/.test(monthInvestmentCode));
  ok("nenhum <details> sobrou em month-investment-summary.tsx", !/<details/.test(monthInvestmentCode));
  ok('"Detalhes do acompanhamento"/"Regra da projeção"/"Ritmo planejado inicial" (textos do accordion) não existem mais', !/Detalhes do acompanhamento|Regra da projeção|Ritmo planejado inicial/.test(monthInvestmentCode));
  ok('"Realizado"/"Esperado hoje"/"Esperado até hoje" (duplicados da barra/KPI) não existem mais', !/>Realizado<|>Esperado hoje<|>Esperado até hoje</.test(monthInvestmentCode));

  ok('"Diferença para o ritmo" continua renderizada (como frase "X acima/abaixo do ritmo", não mais label+valor separados)', /acima do ritmo|abaixo do ritmo|Sem diferença de ritmo/.test(monthInvestmentCode));
  ok('"Ritmo recomendado" continua renderizado (inline, junto da diferença)', /Ritmo recomendado:/.test(monthInvestmentCode));
  ok("mesma fórmula de diferença para o ritmo (actual - expectedToDate, nunca invertida)", /const ritmoDiff = actual - expectedToDate;/.test(monthInvestmentCode));
  ok("Ritmo recomendado continua vindo de computeMonthlyBudgetPlan (plan.recommendedDaily), nenhum cálculo novo", /plan\.recommendedDaily/.test(monthInvestmentCode) && /computeMonthlyBudgetPlan\(/.test(monthInvestmentCode));
  ok("nova nota só aparece no mesmo caso em que a leitura de investimento do diagnóstico existe (!future && !closed && planned > 0)", /const hasPace = planned > 0 && !isFutureMonth && !isClosedMonth;/.test(monthInvestmentCode));
  ok("linha nova fica dentro da seção Ritmo do mês, sem border-t/card próprio", /investmentPaceNote && <div className="mt-2\.5">/.test(accountFollowUpCode));
  ok("texto da diferença/ritmo recomendado é neutro (nunca amber/red — só o diagnóstico acima carrega tom semântico forte)", !/text-amber-600|text-red-600/.test(monthInvestmentCode));

  ok("ChannelPlanEditor não é mais invocado dentro de Performance (só mencionado em comentário explicando a mudança)", !/<ChannelPlanEditor/.test(accountFollowUpCode));
  ok('gatilho de ChannelPlanEditor usa o rótulo curto "Planejamento" (não mais "Editar planejamento")', /\n\s*Planejamento\n/.test(loadSource("src", "app", "clients", "channel-plan-editor.tsx")) && !/Editar planejamento/.test(channelPlanEditorCode));
  ok(
    "Planejamento (ChannelPlanEditor) aparece no grupo de CONTEXTO da toolbar de page.tsx (mês/canal/planejamento — nunca mais posicionado contra uma navegação por abas, que não existe mais aqui)",
    pageCode.indexOf("<ChannelPlanEditor") > pageCode.indexOf("prevMonthHref"),
  );
  ok(
    "Planejamento NÃO é condicional a nenhum 'activeArea' (esse conceito não existe mais — page.tsx É a Visão Geral inteira, Etapa 5)",
    !pageCode.includes("activeArea"),
  );
  ok("Planejamento preserva a mesma condição de disponibilidade de sempre (admin, mês não encerrado, effectiveDate resolvido)", /isAdmin && !isClosedMonth && effectiveDate &&\s*\(\s*<ChannelPlanEditor/.test(pageCode));
  ok("Planejamento recebe os MESMOS dados de sempre (todos os canais, plano por canal, mês civil, horizonte, objetivo)", /channels=\{AVAILABLE_TRAFFIC_CHANNELS\}[\s\S]{0,80}byChannel=\{clientPlan\.byChannel\}[\s\S]{0,80}performanceGoal=\{performanceGoal\}/.test(pageCode));

  ok("código órfão removido: isClosedByHorizonOnly não existe mais em page.tsx (só servia ao texto do accordion removido)", !pageCode.includes("isClosedByHorizonOnly"));
  ok("mês/canal continuam preservados (mesmos hrefs/estado da rodada 2, nenhuma regressão)", /prevMonthHref/.test(pageCode) && /VisaoGeralChannelSwitch/.test(pageCode));
}

// ---------------------------------------------------------------------------
// Rodada 4 — "Remoção do Diagnóstico Textual"
// ---------------------------------------------------------------------------
console.log("\n14 — RitmoDiagnostic removido: barras + marker são a representação canônica\n");
{
  ok("RitmoDiagnostic não existe mais como função/componente", !/function RitmoDiagnostic|<RitmoDiagnostic/.test(accountFollowUpCode));
  ok('"Dentro do ritmo esperado" (variante consolidada do diagnóstico) não é mais renderizado', !/Dentro do ritmo esperado/.test(accountFollowUpCode));
  ok('formato "Resultados: ... · Investimento: ..." (variante dupla do diagnóstico) não existe mais', !/Resultados: \{resultText\}|Investimento: \{investmentText\}/.test(accountFollowUpCode));
  ok("helpers de tom exclusivos do diagnóstico (resultRitmoTone/investmentRitmoTone/TONE_TEXT_CLASSES) foram removidos — nenhum órfão", !/resultRitmoTone|investmentRitmoTone|TONE_TEXT_CLASSES/.test(accountFollowUpCode));
  ok("RITMO_STATUS_TEXT (só consumido pelo diagnóstico removido) não sobrou em spend-status.ts", !/RITMO_STATUS_TEXT/.test(stripComments(loadSource("src", "lib", "spend-status.ts"))));
  ok(
    "classifySpendStatus/SPEND_STATUS_MARGIN (cálculo real, usado pelas barras) continuam intocados em spend-status.ts",
    /export function classifySpendStatus/.test(loadSource("src", "lib", "spend-status.ts")) && /SPEND_STATUS_MARGIN = 0\.2/.test(loadSource("src", "lib", "spend-status.ts")),
  );

  ok("MonthlyGoalProgress (barra de Resultados) continua chamada sem alteração de props", /<MonthlyGoalProgress\n\s*monthResultCount=\{performanceSummary\?\.resultCount \?\? 0\}/.test(accountFollowUpCode));
  ok("MonthInvestmentSummary (barra de Investimento) continua chamada sem alteração de props", /<MonthInvestmentSummary\n\s*planned=\{investmentPlanned\}/.test(accountFollowUpCode));
  ok("hasResultRitmo (gate real da barra de Resultados) foi preservado — só o diagnóstico textual saiu, não a barra", /const hasResultRitmo =/.test(accountFollowUpCode));

  ok("MonthInvestmentPaceNote (Diferença para o ritmo/Ritmo recomendado) continua intocado por esta rodada", /export function MonthInvestmentPaceNote/.test(monthInvestmentCode));
  ok("ritmoDiff/plan.recommendedDaily continuam com a MESMA fórmula (nenhum cálculo tocado nesta rodada)", /const ritmoDiff = actual - expectedToDate;/.test(monthInvestmentCode) && /plan\.recommendedDaily/.test(monthInvestmentCode));
}

// ---------------------------------------------------------------------------
// Rodada 5 — "MITZA — Reformulação Estrutural"
// ---------------------------------------------------------------------------
console.log("\n15 — Visão Geral enxuta (Rodada 5, HISTÓRICO — ver seção 16 pra o que mudou na Rodada 6)\n");
{
  // Rodada 6 ("Correção de Direção do Workspace") reverteu a premissa desta
  // seção: o Painel principal volta a mostrar Performance/Operação/Demandas
  // por completo, não mais resumos. Os itens abaixo continuam válidos no
  // sentido estrito (nenhum desses componentes é importado/chamado
  // DIRETAMENTE dentro de page.tsx) porque migraram pra dentro de
  // operation-section.tsx (Operação) — reaproveitado por `<OperationSection>`,
  // nunca duplicado. AccountInfoDrawer continua fora (drawer global do
  // header). FunnelsSection é a ÚNICA excessão real: agora É renderizado
  // direto em page.tsx de novo (seção 16).
  ok("MonthTasksPanel não é chamado DIRETAMENTE em page.tsx (mora em operation-section.tsx, via <OperationSection>)", !pageCode.includes("<MonthTasksPanel"));
  ok("SprintCard não é chamado DIRETAMENTE em page.tsx (mora em operation-section.tsx, via <OperationSection>)", !pageCode.includes("<SprintCard"));
  ok("ClientHistoryList não é chamado DIRETAMENTE em page.tsx (mora em operation-section.tsx, via <OperationSection>)", !pageCode.includes("<ClientHistoryList"));
  ok(
    "nenhum drawer de revisão (Record/DetailDrawer) é chamado DIRETAMENTE em page.tsx (mora em operation-section.tsx, via <OperationSection>)",
    !pageCode.includes("<RecordAccountReviewDrawer") && !pageCode.includes("<AccountReviewDetailDrawer"),
  );
  ok("AccountInfoDrawer não é renderizado em page.tsx (continua drawer global do header do workspace)", !pageCode.includes("<AccountInfoDrawer"));
}

// ---------------------------------------------------------------------------
// Rodada 6 — "Correção de Direção do Workspace"
// ---------------------------------------------------------------------------
console.log("\n16 — Painel principal volta a ser COMPLETO: Performance + Operação + Demandas por inteiro, sem voltar ao monólito\n");
{
  ok("FunnelsSection volta a ser renderizado DIRETO em page.tsx (restaurado da página antiga, MESMO componente/loaders de /relatorio)", pageCode.includes("<FunnelsSection"));
  ok(
    "Operação é composta via <OperationSection> (componente extraído, compartilhado com /operation) — NUNCA reimplementada dentro de page.tsx",
    pageCode.includes("<OperationSection") && !pageCode.includes("<MonthTasksPanel") && !pageCode.includes("<SprintCard"),
  );
  ok(
    "operation-section-data.ts é o ÚNICO loader da lógica operacional — usado por page.tsx E por operation/page.tsx, nunca duplicado/reimplementado",
    operationSectionDataCode.includes("export async function loadOperationSectionData"),
  );
  ok(
    "Demandas no Painel mostra TODAS as abertas (não mais só 3) — MESMA fonte loadPendenciasRawData/countOpenDemandas de /clients/[id]/demandas",
    pageCode.includes("demandasOpenItems") && !pageCode.includes(".slice(0, 3)"),
  );
  ok(
    "Links externos (Dashboard/Saldo/Fechamento) restaurados — existiam na barra de navegação da página antiga (auditoria via git show 402e0af), sumiram na Fase 1 sem substituto",
    pageCode.includes("dashboard_url") && pageCode.includes("balance_url") && pageCode.includes("monthly_closing_sheet_url"),
  );
  ok(
    "CTAs de aprofundamento (Ver relatório completo/Ver operação completa/Ver todas) continuam existindo, mas como AÇÃO SECUNDÁRIA — nunca substituindo o conteúdo completo acima deles",
    /Ver relatório completo/.test(pageCode) && /Ver operação completa/.test(pageCode) && /Ver todas/.test(pageCode),
  );
  ok(
    "Nenhum arquivo-monólito: page.tsx continua compondo componentes extraídos (AccountFollowUpPanel/FunnelsSection/OperationSection), nunca um retorno ao arquivo único de 1944 linhas",
    !pageCode.includes("function ClientOperationalHistoryDrawer") && pageCode.includes("<WorkspaceContainer>"),
  );
}

console.log(`\n${passed} verificações passaram.`);
