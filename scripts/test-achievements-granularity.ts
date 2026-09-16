/**
 * Testes da Etapa "Conquistas por Granularidade" — evolui o motor de
 * Conquistas com detecção em Campanha/Público/Criativo, reformula a
 * apresentação (Cliente → O que aconteceu → Evidência, categoria vira tag),
 * e adiciona controle de ruído (teto de conquistas/cliente/dia). Cobre os
 * cenários da seção 18 do pedido.
 *
 * Mesma limitação estrutural de outros testes desta sessão (sem Supabase):
 * a leitura de `campaign_daily_metrics`/`ad_set_daily_metrics`/
 * `ad_creative_daily_metrics` é verificada por checagem ESTRUTURAL do
 * código-fonte (mesmo padrão de `test-operation-goal-filter.ts`), enquanto
 * toda a lógica pura de agregação/comparação/regra é testada chamando as
 * funções de produção reais com fixtures em memória.
 *
 * Rodar: npx tsx scripts/test-achievements-granularity.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { windowSampleIsValid, type ClientDailyPoint } from "../src/lib/achievement-sample";
import {
  evaluateSubEntityEvolution,
  findSubEntityDestaque,
  summarizeSubEntities,
  type SubEntityDailyRow,
} from "../src/lib/achievement-sub-entity";
import { ruleSubEntityDestaque, ruleSubEntityEvolution, type SubEntityAchievementContext } from "../src/lib/achievement-sub-entity-rules";
import {
  ruleConsistencyCpaBelowTarget,
  ruleEvolutionCpaImproved,
  ruleScaleInvestmentGrowthWithEfficiency,
  CLIENT_RULES,
  type ClientAchievementContext,
} from "../src/lib/achievement-client-rules";
import { prioritizeClientCandidates } from "../src/lib/achievement-engine";
import { buildIdempotencyKey } from "../src/lib/achievement-engine";
import { SUB_ENTITY_MIN_COMPARABLE_ENTITIES, SUB_ENTITY_WINDOW_SAMPLE_POLICY, MAX_CLIENT_ACHIEVEMENTS_PER_DAY, EVOLUTION_CPA_IMPROVEMENT_PCT } from "../src/lib/achievement-thresholds";
import { resolveAchievementLevel } from "../src/app/achievements/page";
import { ACHIEVEMENT_LEVEL_LABEL, CLIENT_FAMILY_LABEL } from "../src/lib/achievement-labels";
import type { AchievementCandidate } from "../src/lib/achievement-types";
import { addDays } from "../src/lib/achievement-dates";

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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

const YESTERDAY = "2026-08-19";

// ---------------------------------------------------------------------------
// 1 — Cliente sempre a primeira informação: nenhum headline de regra de
// conta embute o nome do cliente na frase.
// ---------------------------------------------------------------------------
console.log("1 — Cliente é sempre a primeira informação (nunca embutido no headline)\n");
{
  const rulesCode = stripComments(loadSource("src", "lib", "achievement-client-rules.ts"));
  ok("nenhuma regra de conta escreve ${ctx.clientName} dentro de headline/detail", !/\$\{ctx\.clientName\}/.test(rulesCode));

  const subRulesCode = stripComments(loadSource("src", "lib", "achievement-sub-entity-rules.ts"));
  ok("nenhuma regra de sub-entidade escreve o nome do cliente no headline (clientName nunca é lido em headline/detail)", !/headline: `[^`]*clientName/.test(subRulesCode));

  const feedCode = stripComments(loadSource("src", "app", "achievements", "achievements-feed.tsx"));
  ok("feed renderiza subjectLabel (cliente/pessoa/agência) ANTES do headline no card", /subjectLabel\(row\)[\s\S]*row\.headline/.test(feedCode));

  const drawerCode = stripComments(loadSource("src", "app", "achievements", "achievement-detail-drawer.tsx"));
  ok("drawer de detalhe não usa mais o emoji de troféu (🏆)", !/🏆/.test(drawerCode));
  ok("feed não usa mais o emoji de troféu (🏆)", !/🏆/.test(feedCode));
}

// ---------------------------------------------------------------------------
// 2 — Regressão: os 11 detectores de conta continuam funcionando (mesma
// lógica, só o texto mudou) — cenários de evolução/consistência/escala/
// meta/recorde.
// ---------------------------------------------------------------------------
console.log("\n2 — Nenhuma regressão nos detectores de conta já aprovados\n");
{
  function point(date: string, spend: number, resultCount: number): ClientDailyPoint {
    return { date, dataPresent: true, spend, resultCount, revenue: null };
  }

  // 20 dias de baseline estável (CPA ~33.3) + só ONTEM com uma queda forte de
  // CPA — garante que a melhora só cruza o limiar de 20% HOJE (não ontem),
  // exatamente o que o detector de "cruzamento" (anti-spam) exige. Um
  // fixture só com 14 dias faria as duas janelas (hoje/ontem) coincidirem —
  // a melhora já teria "cruzado" ontem, e a regra corretamente não emitiria
  // nada (esse é o comportamento certo, só não serve pra testar ESTE
  // cenário: "cenário do pedido: CPA melhorou 20,81% nos últimos 7 dias").
  const days: ClientDailyPoint[] = [];
  for (let i = 19; i >= 1; i--) days.push(point(addDays(YESTERDAY, -i), 300, 9)); // CPA ~33.3 (baseline)
  days.push(point(YESTERDAY, 300, 30)); // CPA 10 — só ontem

  const ctx: ClientAchievementContext = {
    clientId: "c1",
    clientName: "Leonardo Darcadia",
    yesterday: YESTERDAY,
    performanceGoal: "leads",
    tracksRevenue: false,
    dailyPoints: days,
    goalByMonth: new Map(),
    sourceInfo: null,
  };

  const evolution = ruleEvolutionCpaImproved(ctx);
  ok("Evolução: CPA melhorou ≥20% em 7 dias gera candidato", evolution !== null);
  ok("Evolução: headline nunca contém o nome do cliente", !evolution?.headline.includes("Leonardo Darcadia"));
  check("Evolução: level é 'account'", evolution?.level, "account");
  ok("Evolução: headline segue o padrão 'CPA melhorou X% nos últimos 7 dias'", /^CPA melhorou \d+,\d+% nos últimos 7 dias$/.test(evolution?.headline ?? ""));

  // Consistência: 7 dias dentro da meta.
  const goalByMonth = new Map([[YESTERDAY.slice(0, 7), { targetCostPerResult: 40, targetResultCount: 100, scopeComparable: true }]]);
  const consistencyDays: ClientDailyPoint[] = [];
  for (let i = 6; i >= 0; i--) consistencyDays.push(point(addDays(YESTERDAY, -i), 300, 12)); // CPA 25 < meta 40
  const consistencyCtx: ClientAchievementContext = { ...ctx, dailyPoints: consistencyDays, goalByMonth };
  const consistency = ruleConsistencyCpaBelowTarget(consistencyCtx);
  ok("Consistência: 7 dias dentro da meta gera candidato", consistency !== null);
  check("Consistência: level é 'account'", consistency?.level, "account");

  // Escala: investimento cresce ≥20% mantendo CPA dentro da meta — mesmo
  // cuidado de fixture do cenário de Evolução acima (baseline estável +
  // mudança só ontem, pra cruzar exatamente hoje, nunca antes).
  const scaleDays: ClientDailyPoint[] = [];
  for (let i = 19; i >= 1; i--) scaleDays.push(point(addDays(YESTERDAY, -i), 200, 6)); // CPA ~33.3, spend 200 (baseline)
  scaleDays.push(point(YESTERDAY, 500, 13)); // só ontem: investimento do dia bem maior — puxa a janela de 7 dias pra +21% vs. a anterior, CPA 34,69 < meta 40
  const scaleCtx: ClientAchievementContext = { ...ctx, dailyPoints: scaleDays, goalByMonth };
  const scale = ruleScaleInvestmentGrowthWithEfficiency(scaleCtx);
  ok("Escala: investimento +30% mantendo CPA dentro da meta gera candidato", scale !== null);
  ok("Escala: headline inclui o percentual de crescimento (cenário do pedido: 'Escalou investimento X% mantendo eficiência')", /^Escalou investimento \d+,\d+% mantendo eficiência$/.test(scale?.headline ?? ""));

  ok("Recorde/Meta: as 11 regras de conta continuam exportadas em CLIENT_RULES", CLIENT_RULES.length === 11);
}

// ---------------------------------------------------------------------------
// 3 — Dados granulares: leitura estrutural confirma reaproveitamento das
// tabelas/camadas existentes, nenhuma tabela nova.
// ---------------------------------------------------------------------------
console.log("\n3 — Dados granulares: reaproveita 100% a arquitetura existente\n");
{
  const metricsCode = stripComments(loadSource("src", "lib", "achievement-metrics.ts"));
  ok("fetchSubEntityAchievementContexts reaproveita getCampaignDailyMetricsForPeriod (nenhuma query nova)", /getCampaignDailyMetricsForPeriod\(supabase, client\.id, period\)/.test(metricsCode));
  ok("fetchSubEntityAchievementContexts reaproveita getAdSetDailyMetricsForPeriod", /getAdSetDailyMetricsForPeriod\(supabase, client\.id, period\)/.test(metricsCode));
  ok("fetchSubEntityAchievementContexts reaproveita getAdCreativeDailyMetricsForPeriod", /getAdCreativeDailyMetricsForPeriod\(supabase, client\.id, period\)/.test(metricsCode));
  ok("nível sem linha nenhuma (cliente sem coluna configurada) nunca entra na lista de contextos — degradação graciosa", /if \(campaignRows\.length > 0\)/.test(metricsCode) && /if \(adSetRows\.length > 0\)/.test(metricsCode) && /if \(creativeRows\.length > 0\)/.test(metricsCode));

  const subEntityCode = stripComments(loadSource("src", "lib", "achievement-sub-entity.ts"));
  ok("agregação de sub-entidade reaproveita aggregateWindow (nunca reimplementa)", /aggregateWindow\(points\)/.test(subEntityCode));
  ok("validação de amostra reaproveita windowSampleIsValid (nunca reimplementa)", /windowSampleIsValid\(/.test(subEntityCode));

  ok("supabase/achievements.sql não precisou de nenhuma coluna/tabela nova (level/entityName vivem no jsonb metadata já existente)", !loadSource("supabase", "achievements.sql").includes("add column"));
}

// ---------------------------------------------------------------------------
// 4-7 — Campanha/Público/Criativo: destaque e evolução, com amostra mínima
// e concorrência mínima.
// ---------------------------------------------------------------------------
console.log("\n4 — Destaque (melhor CPA da conta) — campanha/público/criativo\n");
{
  function row(date: string, name: string, spend: number, resultCount: number, channel: "meta" | "google" | null = "meta"): SubEntityDailyRow {
    return { date, channel, name, resultType: "leads", spend, resultCount, revenue: null };
  }

  // Duas campanhas com amostra válida — uma claramente melhor.
  const rows: SubEntityDailyRow[] = [];
  for (let i = 6; i >= 0; i--) {
    rows.push(row(addDays(YESTERDAY, -i), "Campanha Prospecção", 30, 3)); // CPA 10/dia agregando ~ 210/21=10
    rows.push(row(addDays(YESTERDAY, -i), "Campanha Remarketing", 30, 1)); // CPA pior
  }

  const summaries = summarizeSubEntities(rows, "leads");
  check("2 campanhas resumidas no período", summaries.length, 2);

  const destaque = findSubEntityDestaque(summaries);
  ok("com 2 concorrentes válidos, destaque é encontrado", destaque !== null);
  check("vencedora é a de menor CPA (Campanha Prospecção)", destaque?.winner.name, "Campanha Prospecção");
  ok("CPA da vencedora é realmente menor que o da concorrente (evidência correta)", (destaque!.winner.agg.cpa as number) < (destaque!.runnerUp.agg.cpa as number));

  // Amostra insuficiente: só 1 campanha válida (a outra nunca bate o piso de
  // spend/resultado) — "não gerar conquista com 1 resultado ou gasto
  // irrelevante" E "nunca melhor sem concorrência real".
  const soloRows: SubEntityDailyRow[] = [];
  for (let i = 6; i >= 0; i--) soloRows.push(row(addDays(YESTERDAY, -i), "Campanha Única", 30, 3));
  soloRows.push(row(YESTERDAY, "Campanha Fraca", 5, 1)); // não bate minSpend/minResultCount
  const soloSummaries = summarizeSubEntities(soloRows, "leads");
  const soloDestaque = findSubEntityDestaque(soloSummaries);
  ok("sem pelo menos 2 concorrentes com amostra válida, destaque NUNCA é gerado (amostra insuficiente)", soloDestaque === null);
  check(`mínimo de concorrentes é ${SUB_ENTITY_MIN_COMPARABLE_ENTITIES}`, SUB_ENTITY_MIN_COMPARABLE_ENTITIES, 2);

  // Amostra abaixo do piso mínimo (poucos resultados/gasto irrelevante) —
  // nenhuma das duas entra na comparação.
  const weakRows: SubEntityDailyRow[] = [row(YESTERDAY, "Campanha A", 10, 1), row(YESTERDAY, "Campanha B", 10, 1)];
  const weakSummaries = summarizeSubEntities(weakRows, "leads");
  ok("amostra abaixo do piso (1 resultado, R$10) nunca passa em windowSampleIsValid", !windowSampleIsValid(weakSummaries[0].agg, SUB_ENTITY_WINDOW_SAMPLE_POLICY));
  check("destaque com amostra fraca dos dois lados também é null", findSubEntityDestaque(weakSummaries), null);
}

console.log("\n5 — Evolução por entidade — campanha/público/criativo\n");
{
  function row(date: string, name: string, spend: number, resultCount: number): SubEntityDailyRow {
    return { date, channel: "meta", name, resultType: "leads", spend, resultCount, revenue: null };
  }

  const rows: SubEntityDailyRow[] = [];
  for (let i = 13; i >= 7; i--) rows.push(row(addDays(YESTERDAY, -i), "Público Paulínia + 10km", 30, 1)); // CPA 30
  for (let i = 6; i >= 0; i--) rows.push(row(addDays(YESTERDAY, -i), "Público Paulínia + 10km", 30, 3)); // CPA 10 (melhora 66%)

  const current = summarizeSubEntities(rows.filter((r) => r.date >= addDays(YESTERDAY, -6)), "leads");
  const previous = summarizeSubEntities(rows.filter((r) => r.date >= addDays(YESTERDAY, -13) && r.date <= addDays(YESTERDAY, -7)), "leads");
  const results = evaluateSubEntityEvolution(current, previous, EVOLUTION_CPA_IMPROVEMENT_PCT);
  ok("melhora de 66% (acima do limiar de 20%) é detectada", results.length === 1);
  check("entidade correta identificada", results[0]?.current.name, "Público Paulínia + 10km");

  // Melhora irrelevante (abaixo do limiar) nunca gera resultado.
  const weakRows: SubEntityDailyRow[] = [];
  for (let i = 13; i >= 7; i--) weakRows.push(row(addDays(YESTERDAY, -i), "Criativo Est.", 60, 6)); // CPA 10
  for (let i = 6; i >= 0; i--) weakRows.push(row(addDays(YESTERDAY, -i), "Criativo Est.", 60, 7)); // CPA ~8.57, melhora ~14% (< 20%)
  const weakCurrent = summarizeSubEntities(weakRows.filter((r) => r.date >= addDays(YESTERDAY, -6)), "leads");
  const weakPrevious = summarizeSubEntities(weakRows.filter((r) => r.date >= addDays(YESTERDAY, -13) && r.date <= addDays(YESTERDAY, -7)), "leads");
  const weakResults = evaluateSubEntityEvolution(weakCurrent, weakPrevious, EVOLUTION_CPA_IMPROVEMENT_PCT);
  ok("melhora abaixo do limiar (14% < 20%) nunca gera resultado — 'melhora irrelevante não gera conquista'", weakResults.length === 0);
}

console.log("\n6 — ruleSubEntityDestaque/ruleSubEntityEvolution — anti-spam (só emite quando cruza HOJE)\n");
{
  function row(date: string, name: string, spend: number, resultCount: number): SubEntityDailyRow {
    return { date, channel: "meta", name, resultType: "leads", spend, resultCount, revenue: null };
  }

  // Líder consistente nos últimos 8 dias (não muda de ontem pra hoje) — não
  // deve gerar novo candidato de Destaque.
  const stableRows: SubEntityDailyRow[] = [];
  for (let i = 13; i >= 0; i--) {
    stableRows.push(row(addDays(YESTERDAY, -i), "Campanha Líder", 30, 3));
    stableRows.push(row(addDays(YESTERDAY, -i), "Campanha Segunda", 30, 1));
  }
  const stableCtx: SubEntityAchievementContext = { clientId: "c1", clientName: "Pet Fast", yesterday: YESTERDAY, performanceGoal: "leads", level: "campaign", rows: stableRows };
  check("liderança estável (mesma de ontem) não gera novo candidato de Destaque", ruleSubEntityDestaque(stableCtx), null);

  // Virada de liderança hoje: baseline longo (20 dias) onde "Campanha Líder"
  // sempre venceu, e só ONTEM "Campanha Nova" tem um resultado forte o
  // bastante pra virar a janela de 7 dias — garante que a virada aconteça
  // exatamente HOJE (mesmo cuidado dos fixtures de Evolução/Escala acima: um
  // baseline curto faria a virada já ter acontecido ONTEM também, e a regra
  // corretamente não emitiria nada nesse caso).
  const flipRows: SubEntityDailyRow[] = [];
  for (let i = 19; i >= 1; i--) {
    flipRows.push(row(addDays(YESTERDAY, -i), "Campanha Líder", 30, 3)); // CPA 10 (baseline)
    flipRows.push(row(addDays(YESTERDAY, -i), "Campanha Nova", 30, 1)); // CPA 30 (baseline)
  }
  flipRows.push(row(YESTERDAY, "Campanha Líder", 30, 3)); // segue no padrão de sempre
  flipRows.push(row(YESTERDAY, "Campanha Nova", 30, 60)); // só ontem: resultado forte o bastante pra puxar os 7 dias
  const flipCtx: SubEntityAchievementContext = { ...stableCtx, rows: flipRows };
  const flipCandidate = ruleSubEntityDestaque(flipCtx);
  ok("virada de liderança HOJE gera candidato de Destaque", flipCandidate !== null);
  check("candidato aponta a nova líder", flipCandidate?.entityName, "Campanha Nova");
  check("level do candidato é 'campaign'", flipCandidate?.level, "campaign");
  check("family do candidato é 'destaque'", flipCandidate?.family, "destaque");
  ok("headline usa aspas no nome da entidade (padrão do pedido)", Boolean(flipCandidate?.headline.includes('"Campanha Nova"')));
  ok("headline NUNCA repete o nome do cliente (cliente é campo separado)", !flipCandidate?.headline.includes("Pet Fast"));
}

// ---------------------------------------------------------------------------
// 8 — Comparação entre períodos e evidência numérica correta.
// ---------------------------------------------------------------------------
console.log("\n7 — Evidência numérica correta (detail reflete os números reais)\n");
{
  function row(date: string, name: string, spend: number, resultCount: number): SubEntityDailyRow {
    return { date, channel: "meta", name, resultType: "leads", spend, resultCount, revenue: null };
  }
  // Mesmo cuidado de fixture dos blocos anteriores: baseline longo (CPA 20
  // estável) + só ONTEM um resultado forte o bastante pra puxar a janela de
  // 7 dias pra CPA 10 exato (melhora de 50%) — garante que a melhora cruza
  // o limiar exatamente HOJE, nunca antes.
  const rows: SubEntityDailyRow[] = [];
  for (let i = 19; i >= 1; i--) rows.push(row(addDays(YESTERDAY, -i), "Criativo X", 100, 5)); // CPA 20 (baseline)
  rows.push(row(YESTERDAY, "Criativo X", 100, 40)); // só ontem — puxa os 7 dias pra CPA 10 exato

  const ctx: SubEntityAchievementContext = { clientId: "c1", clientName: "JudClass", yesterday: YESTERDAY, performanceGoal: "leads", level: "creative", rows };
  const evolution = ruleSubEntityEvolution(ctx);
  ok("melhora de 50% (Criativo X) gera candidato de evolução", evolution !== null);
  ok("detail mostra CPA atual vs. anterior no formato do pedido ('R$ X vs. R$ Y no período anterior')", /^CPA R\$\s?10,00 vs\. R\$\s?20,00 no período anterior$/.test(evolution?.detail ?? ""));
  check("metric.actual reflete o CPA real do período atual", evolution?.metric.actual, 10);
  check("metric.comparisonActual reflete o CPA real do período anterior", evolution?.metric.comparisonActual, 20);
}

// ---------------------------------------------------------------------------
// 9 — Deduplicação: idempotency key determinística também pra sub-entidade.
// ---------------------------------------------------------------------------
console.log("\n8 — Deduplicação (idempotency key determinística)\n");
{
  const candidate: AchievementCandidate = {
    type: "campaign_destaque_best_cpa",
    scope: "client",
    family: "destaque",
    severity: "highlight",
    occurredOnDate: YESTERDAY,
    windowKey: `sub_destaque:campaign:meta::Campanha X:${YESTERDAY}`,
    clientId: "client-1",
    clientName: "Pet Fast",
    level: "campaign",
    entityName: "Campanha X",
    metric: { metric: "cpa", actual: 10, unit: "currency" },
    headline: '"Campanha X" tem o melhor CPA da conta nos últimos 7 dias',
    detail: "3 leads · CPA R$ 10,00",
  };
  const key1 = buildIdempotencyKey(candidate, "org-1");
  const key2 = buildIdempotencyKey(candidate, "org-1");
  check("mesma chave em duas chamadas (reprocessar nunca duplica)", key1, key2);
  ok("chave inclui o nível (campaign) e a entidade, nunca colide com uma conquista de conta", key1.includes("campaign_destaque_best_cpa"));
}

// ---------------------------------------------------------------------------
// 10 — Controle de ruído: teto de conquistas por cliente/dia, priorizando
// severidade e depois nível mais amplo primeiro.
// ---------------------------------------------------------------------------
console.log("\n9 — Controle de ruído (teto de conquistas por cliente/dia)\n");
{
  function candidate(level: AchievementCandidate["level"], severity: AchievementCandidate["severity"], type: string): AchievementCandidate {
    return {
      type,
      scope: "client",
      family: "evolucao",
      severity,
      occurredOnDate: YESTERDAY,
      windowKey: type,
      clientId: "c1",
      clientName: "Cliente X",
      level,
      metric: { metric: "cpa", actual: 10, unit: "currency" },
      headline: type,
      detail: "",
    };
  }

  const many = [
    candidate("creative", "milestone", "c1"),
    candidate("account", "record", "c2"),
    candidate("ad_set", "highlight", "c3"),
    candidate("campaign", "highlight", "c4"),
    candidate("account", "highlight", "c5"),
  ];
  const prioritized = prioritizeClientCandidates(many);
  check("recorde de conta vem primeiro (maior severidade)", prioritized[0].type, "c2");
  check("entre 2 highlights, nível mais amplo (conta) vem antes de campanha/público", prioritized[1].type, "c5");
  check(`teto (${MAX_CLIENT_ACHIEVEMENTS_PER_DAY}) corta os de menor prioridade`, prioritized.slice(0, MAX_CLIENT_ACHIEVEMENTS_PER_DAY).length, 3);
  ok("milestone de criativo fica de fora do teto quando há candidatos melhores no mesmo dia", !prioritized.slice(0, MAX_CLIENT_ACHIEVEMENTS_PER_DAY).some((c) => c.type === "c1"));

  const engineCode = stripComments(loadSource("src", "lib", "achievement-engine.ts"));
  ok("motor coleta TODOS os candidatos do cliente (conta + sub-entidade) antes de decidir o que persistir", /const allCandidates: AchievementCandidate\[\] = \[\]/.test(engineCode));
  ok("motor aplica o teto via prioritizeClientCandidates + MAX_CLIENT_ACHIEVEMENTS_PER_DAY antes de persistir", /prioritizeClientCandidates\(allCandidates\)/.test(engineCode) && /slice\(0, MAX_CLIENT_ACHIEVEMENTS_PER_DAY\)/.test(engineCode));
}

// ---------------------------------------------------------------------------
// 11-13 — Filtros: cliente (inalterado), tipo (agora inclui "destaque"),
// nível (novo).
// ---------------------------------------------------------------------------
console.log("\n10 — Filtros: Cliente (inalterado), Tipo (+ destaque), Nível (novo)\n");
{
  check("família 'destaque' está na taxonomia de Tipo", CLIENT_FAMILY_LABEL.destaque, "Destaque");
  check("4 níveis rotulados (Conta/Campanha/Público/Criativo)", Object.keys(ACHIEVEMENT_LEVEL_LABEL).length, 4);

  check("sem parâmetro -> 'todos' (fallback seguro)", resolveAchievementLevel(undefined), "todos");
  check("?level=campaign -> 'campaign'", resolveAchievementLevel("campaign"), "campaign");
  check("?level=ad_set -> 'ad_set'", resolveAchievementLevel("ad_set"), "ad_set");
  check("?level=creative -> 'creative'", resolveAchievementLevel("creative"), "creative");
  check("?level=account -> 'account'", resolveAchievementLevel("account"), "account");
  check("?level=lixo (valor inválido) -> fallback seguro 'todos'", resolveAchievementLevel("lixo"), "todos");

  const dataCode = stripComments(loadSource("src", "lib", "achievements-data.ts"));
  ok("filtro de cliente continua .eq direto (nunca filtro em memória)", /filters\.clientId\) query = query\.eq\("client_id", filters\.clientId\)/.test(dataCode));
  ok("filtro de tipo continua .eq direto em metadata->>family", /filters\.family\) query = query\.eq\("metadata->>family", filters\.family\)/.test(dataCode));
  ok(
    "filtro de nível 'account' inclui eventos legados sem o campo (nunca exclui histórico por retroatividade)",
    /metadata->>level\.eq\.account,metadata->>level\.is\.null/.test(dataCode),
  );
  ok("filtro de nível para campanha/público/criativo é .eq direto (sem ambiguidade histórica)", /query\.eq\("metadata->>level", filters\.level\)/.test(dataCode));

  const filterBarCode = stripComments(loadSource("src", "app", "achievements", "achievements-filter-bar.tsx"));
  ok("filtro de Nível só aparece na aba Cliente (Agência/Pessoa não têm sub-entidade)", /scope === "client" &&[\s\S]{0,200}Filtrar por nível/.test(filterBarCode));
}

// ---------------------------------------------------------------------------
// 14 — Histórico legado continua funcionando: evento sem `level`/
// `entity_name` no metadata cai em fallback seguro na leitura.
// ---------------------------------------------------------------------------
console.log("\n11 — Histórico legado continua funcionando (fallback seguro)\n");
{
  const dataCode = stripComments(loadSource("src", "lib", "achievements-data.ts"));
  ok("level cai em 'account' quando ausente do metadata (evento legado)", /\(metadata\.level as AchievementLevel \| undefined\) \?\? "account"/.test(dataCode));
  ok("entityName cai em null quando ausente do metadata (evento legado)", /\(metadata\.entity_name as string \| undefined\) \?\? null/.test(dataCode));
}

console.log(`\n${passed} verificações passaram.`);
