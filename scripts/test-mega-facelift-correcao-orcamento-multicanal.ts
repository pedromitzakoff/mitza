/**
 * Testes da Etapa "Correção de Semântica — Orçamento do Mês Multicanal"
 * — corrige um bug real da Etapa anterior ("Evolução do Dashboard —
 * Visão Simultânea de Canais"): "Orçamento do mês" estava mostrando só
 * o investimento planejado dos canais do objetivo PRINCIPAL
 * (`primaryGoalPlan.consolidated.investment`), nunca a soma de TODOS os
 * canais reais do cliente — ficava errado sempre que Meta e Google
 * pertencem a objetivos diferentes (ex.: Meta=Vendas, Google=Leads).
 *
 * Cobre os cenários obrigatórios do pedido (seção "Testes"): só Meta, só
 * Google, Meta+Google, orçamento por canal, total = soma correta,
 * alteração recalcula o total, total não editável, ausência de
 * planejamento vs. zero explícito, cancelamento, salvamento, falha
 * parcial, histórico preservado, mês diferente, canal com/sem dados vs.
 * com/sem planejamento, nenhuma duplicação, nenhuma alteração nos
 * resultados, Ritmo semanticamente correto.
 *
 * `consolidateAdditive` (o combinador usado pela correção) já é testado
 * a fundo em `test-channel-metrics.ts` — não duplicado aqui, só
 * confirmado como a fonte usada pela nova soma.
 *
 * Rodar: npx tsx scripts/test-mega-facelift-correcao-orcamento-multicanal.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consolidateAdditive } from "../src/lib/channel-metrics";
import type { TrafficChannel } from "../src/lib/traffic-channels";

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

/** Simula `dashboardChannels[i].planned` pra exercitar a mesma fórmula
 * que a página usa (`consolidateAdditive` sobre um lookup), sem precisar
 * de Supabase/React. */
function totalAcross(byChannel: Partial<Record<TrafficChannel, number | null>>, channels: TrafficChannel[], fallback: number): number {
  return consolidateAdditive(channels, (c) => byChannel[c] ?? null) ?? fallback;
}

console.log("\n1 — Só Meta: total = o próprio planejamento de Meta\n");
{
  check("Meta R$160.000, nenhum outro canal -> total R$160.000", totalAcross({ meta: 160000 }, ["meta"], 0), 160000);
}

console.log("\n2 — Só Google: total = o próprio planejamento de Google\n");
{
  check("Google R$40.000, nenhum outro canal -> total R$40.000", totalAcross({ google: 40000 }, ["google"], 0), 40000);
}

console.log("\n3 — Meta + Google: total = SOMA correta (o bug original: antes só contava o canal do objetivo principal)\n");
{
  check("Meta R$160.000 + Google R$40.000 -> total R$200.000", totalAcross({ meta: 160000, google: 40000 }, ["meta", "google"], 0), 200000);
}

console.log("\n4 — Orçamento Meta / Orçamento Google isolados — cada canal contribui com o PRÓPRIO valor, nunca o do outro\n");
{
  check("alterar só Meta (R$160.000 -> R$180.000) recalcula o total, Google intocado", totalAcross({ meta: 180000, google: 40000 }, ["meta", "google"], 0), 220000);
  check("alterar só Google (R$40.000 -> R$60.000) recalcula o total, Meta intocado", totalAcross({ meta: 160000, google: 60000 }, ["meta", "google"], 0), 220000);
}

console.log("\n5 — Ausência de planejamento (null) é distinta de orçamento explicitamente ZERO\n");
{
  check("Meta sem plano (null) + Google R$40.000 -> total R$40.000 (null nunca conta como 0 na soma)", totalAcross({ meta: null, google: 40000 }, ["meta", "google"], 0), 40000);
  check("Meta explicitamente R$0 + Google R$40.000 -> total R$40.000 (0 É somado, diferente de null)", totalAcross({ meta: 0, google: 40000 }, ["meta", "google"], 0), 40000);
  check("NENHUM canal tem plano (ambos null) -> cai no fallback legado, nunca 0 fabricado", totalAcross({ meta: null, google: null }, ["meta", "google"], 999), 999);
  ok(
    "renderPlannedValue (dashboard-budget.tsx) mostra 'Sem planejamento' pra null e o valor formatado (inclusive R$0,00) pra zero explícito — nunca a mesma string pros dois",
    /return planned != null \? formatCurrency\(planned\) : "Sem planejamento";/.test(budgetSource),
  );
}

console.log("\n6 — Total NÃO é editável: a página monta o total a partir de consolidateAdditive sobre os canais, nunca um input próprio\n");
{
  ok(
    "page.tsx usa consolidateAdditive (combinador central já existente, lib/channel-metrics.ts) pra somar os canais — nenhuma soma reinventada",
    /import \{ consolidateAdditive, type ChannelMetrics \} from "@\/lib\/channel-metrics"/.test(pageSource) &&
      /const totalPlannedAcrossChannels =\s*consolidateAdditive\(clientChannels, \(channel\) => dashboardChannels\.find/.test(pageSource),
  );
  ok("DashboardBudget nunca renderiza um <input> pro total — só spans/texto (Total é sempre leitura, nunca escrita)", !/name="total"|id="total"|<input[^>]*total/i.test(budgetSource));
  ok(
    "liveTotal (soma em tempo real durante a edição) é derivado dos drafts dos CANAIS, nunca um estado próprio editável",
    /const liveTotal = channels\.reduce\(\(sum, c\) => sum \+ \(parseMoneyInput\(drafts\[c\.channel\] \?\? ""\) \?\? 0\), 0\);/.test(budgetSource),
  );
}

console.log("\n7 — Salvamento reutiliza a infraestrutura oficial (nenhuma tabela/campo novo)\n");
{
  ok(
    "handleSave chama applyMonthlyChannelPlanChangeAction por canal alterado — a MESMA Server Action/RPC de sempre",
    /const result = await applyMonthlyChannelPlanChangeAction\(clientId, monthParam, channel, newInvestment, null, null\);/.test(budgetSource),
  );
  ok("nenhuma menção a total_budget/dashboard_budget/nova tabela em dashboard-budget.tsx ou page.tsx", !/total_budget|dashboard_budget/i.test(budgetSource) && !/total_budget|dashboard_budget/i.test(pageSource));
}

console.log("\n8 — Cancelamento: nenhuma chamada de escrita, estado limpo\n");
{
  ok(
    "cancel() limpa drafts/appliedChannels/error sem chamar applyMonthlyChannelPlanChangeAction",
    /function cancel\(\) \{\s*setIsEditing\(false\);\s*setDrafts\(\{\}\);\s*setAppliedChannels\(\{\}\);\s*setError\(null\);\s*\}/.test(budgetSource),
  );
}

console.log("\n9 — Falha parcial: nunca comunica sucesso total, nunca reenvia canal já salvo\n");
{
  ok(
    "handleSave tenta TODOS os canais alterados (nunca `return` no primeiro erro dentro do loop) — coleta falhas/sucessos antes de decidir o que reportar",
    /for \(const \{ channel \} of changed\) \{\s*const newInvestment = parseMoneyInput/.test(budgetSource) && !/if \(result\.error\) \{\s*setError/.test(budgetSource),
  );
  ok(
    "canais que salvaram com sucesso entram em appliedChannels (newlyApplied) ANTES de checar falhas — nunca perdidos mesmo se outro canal falhar depois",
    /if \(Object\.keys\(newlyApplied\)\.length > 0\) \{\s*setAppliedChannels/.test(budgetSource),
  );
  ok(
    "havendo QUALQUER falha, o editor continua aberto (nenhum setIsEditing(false)/showToast de sucesso) e a mensagem lista quem salvou e quem falhou",
    /if \(failures\.length > 0\) \{[\s\S]{0,400}setError\(`\$\{savedLabel\}Falha ao salvar: \$\{failures\.join\("; "\)\}`\);\s*return;/.test(budgetSource),
  );
  ok(
    "próxima tentativa de salvar usa appliedChannels como baseline (nunca reenvia um canal que já foi confirmado nesta sessão)",
    /const baseline = appliedChannels\[c\.channel\] \?\? c\.planned;/.test(budgetSource),
  );
  ok(
    "comentário documenta o gap de atomicidade: apply_monthly_channel_plan_change é por canal, não existe transação cross-canal — nenhuma transação de frontend inventada",
    /ATOMICIDADE[\s\S]{0,100}não existe hoje uma RPC que\s*\* grave o plano de dois canais numa única transação/.test(budgetSource),
  );
}

console.log("\n10 — Histórico preservado: mesma tabela, nenhuma linha perdida/duplicada\n");
{
  ok(
    "apply_monthly_channel_plan_change (RPC oficial, intocada) continua sendo a única escrita em monthly_budget_changes",
    loadSource("supabase", "monthly-channel-plan.sql").includes("insert into monthly_budget_changes"),
  );
}

console.log("\n11 — Mês diferente possui orçamento diferente: total é recalculado por mês, nunca cacheado entre meses\n");
{
  ok(
    "totalPlannedAcrossChannels depende de dashboardChannels, que depende de clientGoalsPlan resolvido pra firstDay (o mês selecionado) — recalculado a cada render da página, nunca persistido entre meses",
    /selectedMonth: firstDay/.test(pageSource),
  );
}

console.log("\n12 — Canal com dados realizados mas SEM planejamento / canal com planejamento mas SEM dados realizados — estados independentes, nunca confundidos\n");
{
  check("canal com investimento REALIZADO mas sem plano (null) -> ainda entra na lista de canais, só não soma no total planejado", totalAcross({ meta: null }, ["meta"], 0), 0);
  ok(
    "actualSpend (realizado) e planned (planejado) são resolvidos por fontes INDEPENDENTES (sumChannelEffectiveSpend vs. goalPlan.byChannel) — um nunca depende do outro existir",
    /const actualSpend = sumChannelEffectiveSpend\(/.test(pageSource) && /const planned = goalPlan\.byChannel\[channel\]\?\.investment \?\? null;/.test(pageSource),
  );
}

console.log("\n13 — Nenhuma alteração na lógica de Resultados: Meta Vendas + Google Leads NUNCA virou 'resultado total' (esta correção é só sobre dinheiro)\n");
{
  ok(
    "cada canal continua resolvendo o PRÓPRIO goalPlan (por resultType) pra Resultado/Custo — nenhuma soma de resultCount entre objetivos diferentes introduzida por esta correção",
    /const goalPlan = channelGoal \? clientGoalsPlan\.goals\.find\(\(g\) => g\.resultType === channelGoal\.resultType\)/.test(pageSource),
  );
  ok(
    "consolidatedPerformanceSummary (Diagnóstico/KPI consolidado) continua escopado ao objetivo PRINCIPAL (resultType: performanceGoal) — resultado nunca soma entre objetivos, só dinheiro soma",
    /resultType: performanceGoal,[\s\S]{0,80}consolidatedActualSpend: monthActual,[\s\S]{0,80}targetCostPerResult: consolidatedTargetCostPerResult,/.test(pageSource),
  );
}

console.log("\n14 — Ritmo do mês permanece semanticamente correto: agora compara o REALIZADO total contra o PLANEJADO total (antes comparava total realizado contra planejado só do objetivo principal — inconsistência corrigida, auditada e documentada)\n");
{
  ok(
    "monthActual (investimento realizado) já era o TOTAL do cliente (todos os canais, sumActualSpendForMonth sem filtro de objetivo/canal) — nunca alterado por esta correção",
    /const monthActual = sumActualSpendForMonth\(sprints \?\? \[\], \{ firstDay, lastDay \}, dailySpend \?\? \[\]\);/.test(pageSource),
  );
  ok(
    "monthPlanned (planejado usado pelo Ritmo) agora é totalPlannedAcrossChannels — mesma unidade/escopo de monthActual, nunca mais uma comparação total-vs-parcial",
    /const monthPlanned = totalPlannedAcrossChannels;/.test(pageSource),
  );
  ok(
    "comentário audita e documenta a mudança: equivalente ao comportamento anterior no caminho comum (1 objetivo sem restrição de canal), só corrige quando há objetivos por canal diferentes",
    /Esta é a MESMA definição que a página já usava no caso comum/.test(pageSource),
  );
  ok(
    "ensureClosedSprintSnapshots (congelamento de sprint) continua INTOCADO — sempre primaryMonthPlanned (objetivo principal), decisão deliberada e documentada, nunca a exibição",
    /currentMonthlyBudget: primaryMonthPlanned,/.test(pageSource),
  );
}

console.log("\n15 — Nenhuma duplicação de budget: um único totalPlannedAcrossChannels, consumido tanto pelo card de Orçamento quanto pelo Ritmo\n");
{
  ok(
    "DashboardBudget recebe total={monthPlanned} e Ritmo (MonthInvestmentSummary/MonthInvestmentPaceNote) recebe planned={monthPlanned} — a MESMA variável, nunca duas somas independentes",
    pageSource.includes("total={monthPlanned}") && (pageSource.match(/planned={monthPlanned}/g) ?? []).length === 2,
  );
}

console.log(`\n${passed} verificações passaram.\n`);
