/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6A" —
 * `lib/achievement-insignia.ts` (camada pura: achievements -> Insignia[]).
 *
 * 100% testável sem Supabase (função pura sobre `AchievementRow[]` +
 * contagens vivas opcionais). Cobertura: consolidação (maior patamar
 * vence), estágio/total/próximo patamar, prestígio Marco/Destaque/Elite
 * (mapping explícito, nunca inferido), naturezas única/recorrente/
 * progressiva, seleção de destaques (1 por família, corte em 3, desempate
 * por data), seleção de próximos marcos (só famílias com atividade real),
 * progresso ao vivo só pros tipos permitidos, e exclusão total de
 * `person_tenure_milestone`.
 *
 * Rodar: npx tsx scripts/test-achievement-insignia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInsigniaCollection,
  selectFeaturedInsignias,
  selectUpcomingMilestones,
  type Insignia,
  type InsigniaLiveCounts,
} from "../src/lib/achievement-insignia";
import type { AchievementRow } from "../src/lib/achievements-data";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function achievement(type: string, occurredAt: string, family: string, target: number | null = null, overrides: Partial<AchievementRow> = {}): AchievementRow {
  return {
    id: `${type}:${occurredAt}`,
    occurredAt,
    detectedAt: occurredAt,
    scope: "person",
    family,
    severity: "milestone",
    type,
    clientId: null,
    clientName: null,
    clientPerformanceGoal: null,
    actorTeamMemberId: "gestor-1",
    actorTeamMemberName: "Gestor Um",
    level: "account",
    entityName: null,
    headline: `headline bruto de ${type}`,
    detail: "",
    metric: target === null ? null : { metric: "count", actual: target, unit: "count", target },
    source: null,
    ...overrides,
  };
}

const insigniaSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "achievement-insignia.ts"), "utf8"));

console.log("\n1 — Consolidação: o MAIOR milestone da família vence, nunca 3 insígnias pra 1/50/100\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 1),
    achievement("person_optimizations_milestone", "2026-05-01T12:00:00-03:00", "otimizacoes", 50),
    achievement("person_optimizations_milestone", "2026-09-01T12:00:00-03:00", "otimizacoes", 100),
  ];
  const insignias = buildInsigniaCollection(achievements);
  const optimizationInsignias = insignias.filter((i) => i.type === "person_optimizations_milestone");
  ok("só 1 insígnia de otimizações no resultado (nunca 3)", optimizationInsignias.length === 1);
  ok("o milestone mantido é 100 (o maior), nunca 1 ou 50", optimizationInsignias[0].milestone === 100);
}

console.log("\n2 — Estágio, total de estágios e próximo milestone corretos\n");
{
  const achievements = [achievement("person_optimizations_milestone", "2026-09-01T12:00:00-03:00", "otimizacoes", 100)];
  const [insignia] = buildInsigniaCollection(achievements);
  ok("escada de otimizações tem 5 patamares no total (1,50,100,250,500)", insignia.stage?.total === 5);
  ok("100 é o 3º patamar da escada -> estágio atual = 3", insignia.stage?.current === 3);
  ok("próximo patamar depois de 100 é 250", insignia.nextMilestone === 250);
  ok("milestone atual é exatamente 100 (nenhum recálculo)", insignia.milestone === 100);
}

console.log("\n3 — Último estágio da escada nunca tem próximo milestone\n");
{
  const achievements = [achievement("person_optimizations_milestone", "2026-09-01T12:00:00-03:00", "otimizacoes", 500)];
  const [insignia] = buildInsigniaCollection(achievements);
  ok("estágio 5 de 5 (o último)", insignia.stage?.current === 5 && insignia.stage?.total === 5);
  ok("nextMilestone é null no último estágio", insignia.nextMilestone === null);
}

console.log("\n4 — Classificação MARCO (patamares iniciais de famílias operacionais)\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 1),
    achievement("person_first_meeting_completed", "2026-01-01T12:00:00-03:00", "experiencia"),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("1 otimização registrada -> prestígio 'marco'", insignias.find((i) => i.type === "person_optimizations_milestone")?.prestige === "marco");
  ok("primeira reunião concluída -> prestígio 'marco' (fixo, onboarding)", insignias.find((i) => i.type === "person_first_meeting_completed")?.prestige === "marco");
}

console.log("\n5 — Classificação DESTAQUE\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 250),
    achievement("person_first_client_within_target", "2026-01-01T12:00:00-03:00", "performance"),
    achievement("person_consecutive_months_fully_within_target", "2026-01-01T12:00:00-03:00", "performance", 3),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("250 otimizações (penúltimo patamar) -> 'destaque'", insignias.find((i) => i.type === "person_optimizations_milestone")?.prestige === "destaque");
  ok("primeira conta dentro da meta -> 'destaque' (fixo)", insignias.find((i) => i.type === "person_first_client_within_target")?.prestige === "destaque");
  ok("3 meses de consistência (1º patamar da família) -> 'destaque', nunca 'marco'", insignias.find((i) => i.type === "person_consecutive_months_fully_within_target")?.prestige === "destaque");
}

console.log("\n6 — Classificação ELITE\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 500),
    achievement("person_consecutive_months_fully_within_target", "2026-01-01T12:00:00-03:00", "performance", 6),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("500 otimizações (último patamar da escada) -> 'elite'", insignias.find((i) => i.type === "person_optimizations_milestone")?.prestige === "elite");
  ok("6 meses de consistência (último patamar) -> 'elite'", insignias.find((i) => i.type === "person_consecutive_months_fully_within_target")?.prestige === "elite");
}

console.log("\n7 — Performance ÚNICA (person_first_client_within_target) nunca vira progressiva\n");
{
  const achievements = [achievement("person_first_client_within_target", "2026-03-01T12:00:00-03:00", "performance")];
  const [insignia] = buildInsigniaCollection(achievements);
  ok("nature é 'unique'", insignia.nature === "unique");
  ok("nunca tem estágio (não é uma escada)", insignia.stage === null);
  ok("nunca tem próximo milestone", insignia.nextMilestone === null);
  ok("nunca tem progresso", insignia.progress === null);
}

console.log("\n8 — Performance RECORRENTE (person_portfolio_fully_within_target): representa sempre a ocorrência MAIS RECENTE\n");
{
  const achievements = [
    achievement("person_portfolio_fully_within_target", "2026-04-01T12:00:00-03:00", "performance", 4, { id: "abril" }),
    achievement("person_portfolio_fully_within_target", "2026-06-01T12:00:00-03:00", "performance", 6, { id: "junho" }),
    achievement("person_portfolio_fully_within_target", "2026-05-01T12:00:00-03:00", "performance", 5, { id: "maio" }),
  ];
  const insignias = buildInsigniaCollection(achievements);
  const recurring = insignias.filter((i) => i.type === "person_portfolio_fully_within_target");
  ok("só 1 insígnia recorrente no resultado (nunca 3)", recurring.length === 1);
  ok("nature é 'recurring'", recurring[0].nature === "recurring");
  ok("é a ocorrência de junho (mais recente por data, nunca a de maior 'target')", recurring[0].achievement.id === "junho");
  ok("nunca tem estágio/próximo/progresso (não é uma escada)", recurring[0].stage === null && recurring[0].nextMilestone === null && recurring[0].progress === null);
}

console.log("\n9 — Consistência é progressiva de verdade (estágio/total/próximo corretos)\n");
{
  const achievements = [achievement("person_consecutive_months_fully_within_target", "2026-01-01T12:00:00-03:00", "performance", 3)];
  const [insignia] = buildInsigniaCollection(achievements);
  ok("nature é 'progressive'", insignia.nature === "progressive");
  ok("escada de consistência tem 2 patamares (3, 6)", insignia.stage?.total === 2);
  ok("3 meses é o 1º patamar", insignia.stage?.current === 1);
  ok("próximo patamar é 6", insignia.nextMilestone === 6);
}

console.log("\n10 — Destaques: no máximo 1 por família, mesmo com múltiplas insígnias na mesma família\n");
{
  const achievements = [
    achievement("person_first_client_within_target", "2026-01-01T12:00:00-03:00", "performance"),
    achievement("person_portfolio_fully_within_target", "2026-02-01T12:00:00-03:00", "performance", 2),
    achievement("person_consecutive_months_fully_within_target", "2026-03-01T12:00:00-03:00", "performance", 6),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("3 insígnias distintas, todas da família 'performance'", insignias.length === 3 && insignias.every((i) => i.family === "performance"));

  const featured = selectFeaturedInsignias(insignias);
  ok("destaques: só 1 sobrevive (nunca as 3 juntas)", featured.length === 1);
  ok("a que sobrevive é a de maior prestígio (elite: consistência 6 meses)", featured[0].type === "person_consecutive_months_fully_within_target");
}

console.log("\n11 — Destaques: no máximo 3, mesmo com mais famílias elegíveis\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 500),
    achievement("person_reports_milestone", "2026-02-01T12:00:00-03:00", "reports", 100),
    achievement("person_reviews_milestone", "2026-03-01T12:00:00-03:00", "revisoes", 500),
    achievement("person_clients_served_milestone", "2026-04-01T12:00:00-03:00", "clientes_atendidos", 50),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("4 famílias elegíveis nesta amostra", insignias.length === 4);

  const featured = selectFeaturedInsignias(insignias);
  ok("nunca mais que 3 destaques, mesmo com 4 famílias elite disponíveis", featured.length === 3);
}

console.log("\n12 — Destaques: desempate por conquista mais recente quando o prestígio empata\n");
{
  const achievements = [
    achievement("person_first_meeting_completed", "2026-01-01T12:00:00-03:00", "experiencia"),
    achievement("person_first_creative_delivery_completed", "2026-06-01T12:00:00-03:00", "experiencia"),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("2 insígnias, mesma família 'experiencia', mesmo prestígio ('marco')", insignias.length === 2 && insignias.every((i) => i.prestige === "marco"));

  const featured = selectFeaturedInsignias(insignias);
  ok("só 1 sobrevive (mesma família)", featured.length === 1);
  ok("a mais recente (entrega de criativo, junho) vence o empate de prestígio", featured[0].type === "person_first_creative_delivery_completed");
}

console.log("\n13 — Destaques: menos de 3 elegíveis nunca é preenchido artificialmente\n");
{
  const achievements = [achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 50)];
  const featured = selectFeaturedInsignias(buildInsigniaCollection(achievements));
  ok("só 1 elegível -> resultado tem exatamente 1, nunca preenchido até 3", featured.length === 1);

  const emptyFeatured = selectFeaturedInsignias([]);
  ok("nenhuma insígnia -> destaques vazio, nunca fabricado", emptyFeatured.length === 0);
}

console.log("\n14 — Progresso ao vivo: só disponível pros tipos permitidos, e só quando fornecido\n");
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 100),
    achievement("person_reports_milestone", "2026-01-01T12:00:00-03:00", "reports", 25),
    achievement("person_clients_served_milestone", "2026-01-01T12:00:00-03:00", "clientes_atendidos", 10),
    achievement("person_reviews_milestone", "2026-01-01T12:00:00-03:00", "revisoes", 100),
    achievement("person_consecutive_months_fully_within_target", "2026-01-01T12:00:00-03:00", "performance", 3),
  ];
  const liveCounts: InsigniaLiveCounts = {
    person_optimizations_milestone: 312,
    person_reports_milestone: 48,
    // clientes_atendidos e revisões: nenhuma contagem viva fornecida de propósito.
  };
  const insignias = buildInsigniaCollection(achievements, liveCounts);
  const byType = (type: string) => insignias.find((i) => i.type === type) as Insignia;

  ok("otimizações: progresso presente (312/250? não — 312/250 já passou; ainda assim reflete o dado fornecido)", byType("person_optimizations_milestone").progress?.current === 312);
  ok("otimizações: 'next' é o próximo patamar real (250)", byType("person_optimizations_milestone").progress?.next === 250);
  ok("reports: progresso presente (48/50)", byType("person_reports_milestone").progress?.current === 48 && byType("person_reports_milestone").progress?.next === 50);
  ok("clientes atendidos: SEM contagem viva fornecida -> progress null (nunca fabricado)", byType("person_clients_served_milestone").progress === null);
  ok("revisões: SEM contagem viva fornecida -> progress null", byType("person_reviews_milestone").progress === null);
  ok("consistência: NUNCA tem progresso, mesmo que uma contagem fosse fornecida por engano", byType("person_consecutive_months_fully_within_target").progress === null);
}

console.log("\n15 — Progresso ao vivo: trava mesmo se alguém tentar fornecer valor pra um tipo não permitido\n");
{
  const achievements = [achievement("person_consecutive_months_fully_within_target", "2026-01-01T12:00:00-03:00", "performance", 3)];
  // @ts-expect-error — propositalmente um campo fora do tipo InsigniaLiveCounts, simulando um chamador descuidado.
  const liveCounts: InsigniaLiveCounts = { person_consecutive_months_fully_within_target: 5 };
  const [insignia] = buildInsigniaCollection(achievements, liveCounts);
  ok("consistência nunca recebe progresso, mesmo com valor fornecido pra ela", insignia.progress === null);
}

console.log('\n16 — "Próximos marcos": só famílias com atividade real (pelo menos 1 patamar já cruzado), nunca uma família zerada\n');
{
  // Só otimizações tem atividade real (1 patamar cruzado); reports/clientes
  // atendidos nunca tiveram nenhum achievement -> nunca aparecem como
  // "próximo marco" (não existe Insignia pra eles, e a função não busca
  // fora da coleção).
  const achievements = [achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 1)];
  const insignias = buildInsigniaCollection(achievements);
  const upcoming = selectUpcomingMilestones(insignias);
  ok("só otimizações aparece (única família com atividade real)", upcoming.length === 1 && upcoming[0].type === "person_optimizations_milestone");
}

console.log('\n17 — "Próximos marcos": família já no último estágio nunca aparece (nada a progredir)\n');
{
  const achievements = [achievement("person_clients_served_milestone", "2026-01-01T12:00:00-03:00", "clientes_atendidos", 50)];
  const upcoming = selectUpcomingMilestones(buildInsigniaCollection(achievements));
  ok("último patamar já cruzado -> nunca vira 'próximo marco'", upcoming.length === 0);
}

console.log('\n18 — "Próximos marcos": famílias com progresso vivo vêm primeiro, ordenadas pelo menor "quanto falta"\n');
{
  const achievements = [
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", "otimizacoes", 100),
    achievement("person_reports_milestone", "2026-01-01T12:00:00-03:00", "reports", 25),
    achievement("person_clients_served_milestone", "2026-01-01T12:00:00-03:00", "clientes_atendidos", 10),
  ];
  const liveCounts: InsigniaLiveCounts = {
    person_optimizations_milestone: 240, // faltam 10 pra 250
    person_reports_milestone: 26, // faltam 24 pra 50
    // clientes atendidos: sem progresso vivo -> vai pro fim da lista
  };
  const upcoming = selectUpcomingMilestones(buildInsigniaCollection(achievements, liveCounts), 3);
  ok("3 próximos marcos (dentro do teto)", upcoming.length === 3);
  ok("otimizações (faltam 10) vem antes de reports (faltam 24)", upcoming[0].type === "person_optimizations_milestone");
  ok("clientes atendidos (sem progresso vivo) vai por último", upcoming[2].type === "person_clients_served_milestone");
}

console.log('\n19 — person_tenure_milestone NUNCA aparece: nem na coleção, nem em destaques, nem em próximos marcos\n');
{
  const achievements = [
    achievement("person_tenure_milestone", "2026-01-01T12:00:00-03:00", "tempo_de_casa", 12),
    achievement("person_optimizations_milestone", "2026-02-01T12:00:00-03:00", "otimizacoes", 50),
  ];
  const insignias = buildInsigniaCollection(achievements);
  ok("coleção nunca inclui person_tenure_milestone", !insignias.some((i) => i.type === "person_tenure_milestone"));
  ok("coleção inclui normalmente o outro tipo (otimizações)", insignias.some((i) => i.type === "person_optimizations_milestone"));

  const featured = selectFeaturedInsignias(insignias);
  ok("destaques nunca incluem tempo de casa", !featured.some((i) => i.type === "person_tenure_milestone"));

  const upcoming = selectUpcomingMilestones(insignias);
  ok("próximos marcos nunca incluem tempo de casa", !upcoming.some((i) => i.type === "person_tenure_milestone"));
}

console.log("\n20 — Lista vazia de achievements -> tudo vazio, nunca um estado fabricado\n");
{
  ok("coleção vazia", buildInsigniaCollection([]).length === 0);
  ok("destaques vazios", selectFeaturedInsignias([]).length === 0);
  ok("próximos marcos vazios", selectUpcomingMilestones([]).length === 0);
}

console.log("\n21 — Nenhuma pontuação/score em lugar nenhum do módulo (checagem estrutural)\n");
{
  ok("nenhuma palavra de score/pontuação/XP/ranking/nível no código vivo", !/\bscore\b|pontua[çc][ãa]o|\bXP\b|\branking\b|\bn[íi]vel\b/i.test(insigniaSource));
  ok("prestígio é um union type de string ('marco'|'destaque'|'elite'), nunca um number", /export type InsigniaPrestige = "marco" \| "destaque" \| "elite";/.test(insigniaSource));
  ok("nenhum campo numérico chamado 'peso'/'pontos'/'valor' no tipo Insignia", !/\bpeso\b|\bpontos\b/i.test(insigniaSource));
}

console.log("\n22 — Reuso estrutural: nenhum array de threshold duplicado, sempre importado de achievement-thresholds.ts\n");
{
  ok("importa os arrays canônicos de achievement-thresholds.ts", /from "@\/lib\/achievement-thresholds"/.test(insigniaSource));
  ok("nunca redeclara os números 1, 50, 100, 250, 500 como um array solto novo (só reverte o array importado)", !/\[\s*1\s*,\s*50\s*,\s*100\s*,\s*250\s*,\s*500\s*\]/.test(insigniaSource));
  ok("reaproveita selectPersonBadges (Fase 4) pros tipos escalonáveis, nunca reimplementa a redução", /selectPersonBadges\(achievements\)/.test(insigniaSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
