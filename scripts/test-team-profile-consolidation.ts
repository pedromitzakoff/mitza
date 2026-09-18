/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6D:
 * Consolidação Visual" — `app/team/[id]/page.tsx`.
 *
 * Nenhum cálculo/fonte/regra nova nesta etapa — cobertura estrutural sobre
 * o código-fonte vivo (mesmo padrão de `test-insignia-mark.ts`/
 * `test-team-header.ts`), focada nas garantias que a consolidação precisa
 * preservar: nenhuma informação perdida na fusão das listas por cliente,
 * Evolução com estado vazio honesto, Histórico revelável sem dependência
 * nova, Experiência com as duas janelas (all-time/mês) nunca somadas, e
 * nenhuma outra área da plataforma tocada.
 *
 * Rodar: npx tsx scripts/test-team-profile-consolidation.ts
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

const pageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));

console.log('\n1 — "Carteira & Performance" existe como uma única seção consolidada (accent, mesma hierarquia de Trajetória)\n');
{
  ok('título "Carteira & Performance" com accent (mesmo peso visual de Trajetória)', /<SectionHeader title="Carteira & Performance" accent \/>/.test(pageSource));
  ok("as 4 antigas seções (títulos próprios) não existem mais isoladas", !/title="Carteira atual"|title="Performance da carteira atual"|title="Evolução"|title="Histórico de carteira"/.test(pageSource));
}

console.log("\n2 — Lista por cliente fundida: nenhum campo das duas antigas linhas foi perdido\n");
{
  ok("PortfolioClientRow existe só 1 vez (as duas antigas linhas viraram uma)", (pageSource.match(/function PortfolioClientRow/g) ?? []).length === 1);
  ok("PortfolioPerformanceRow (antiga linha separada) foi removida", !/function PortfolioPerformanceRow/.test(pageSource));
  // Campos da antiga PortfolioClientRow (carteira) — presentes em algum
  // lugar do arquivo, já que PortfolioPerformanceRow não existe mais (só
  // PortfolioClientRow pode ser a origem dessas referências).
  ok("preserva goalLabel/objetivo", /goalLabel/.test(pageSource));
  ok("preserva channelsLabel", /client\.channelsLabel/.test(pageSource));
  ok("preserva assignedWithinPeriodAt ('Assumiu esta conta em')", /assignedWithinPeriodAt/.test(pageSource) && /Assumiu esta conta em/.test(pageSource));
  // Campos da antiga PortfolioPerformanceRow (performance).
  ok("preserva evaluable/custo atual/meta", /evaluation\?\.evaluable/.test(pageSource) && /costActual/.test(pageSource) && /costTarget/.test(pageSource));
  ok("preserva relativeDeviation (desvio relativo à meta)", /relativeDeviation/.test(pageSource));
  ok("preserva withinTarget (tom verde/vermelho por cliente)", /withinTarget/.test(pageSource));
  ok("preserva unavailableReason/motivo de indisponibilidade", /unavailableReason/.test(pageSource));
  ok("uma única linha por cliente na seção consolidada (nunca duas listas do mesmo array de clientes)", (pageSource.match(/portfolio\.clients\.map/g) ?? []).length === 1);
}

console.log("\n3 — Merge é feito por clientId (Map), nunca por índice posicional frágil\n");
{
  ok("performanceByClientId é um Map chaveado por clientId", /const performanceByClientId = new Map\(portfolioPerformance\.clients\.map\(\(client\) => \[client\.clientId, client\]\)\);/.test(pageSource));
  ok("PortfolioClientRow recebe evaluation via performanceByClientId.get(client.clientId)", /evaluation=\{performanceByClientId\.get\(client\.clientId\)\}/.test(pageSource));
}

console.log("\n4 — Evolução: subleitura dentro de Carteira & Performance, com estado vazio honesto (nunca mais some inteira)\n");
{
  ok('rótulo "Evolução" presente como subleitura (não SectionHeader próprio)', /<p className="text-\[11px\][^"]*">Evolução<\/p>/.test(pageSource));
  ok(
    "estado vazio da Evolução é um texto discreto, nunca um '0/0' ou mês fabricado",
    /Ainda sem meses completos suficientes para mostrar evolução da carteira\./.test(pageSource),
  );
  ok("Evolução nunca mais é condicionada por portfolioEvolution.length > 0 pra existir a seção inteira (agora é sempre renderizada, com ou sem dado)", /portfolioEvolution\.length > 0 \? \(/.test(pageSource));
}

console.log("\n5 — Histórico de carteira: revelável via <details> nativo, sem dependência nova, conteúdo preservado\n");
{
  ok("usa <details>/<summary> nativos (zero dependência nova)", /<details className="mt-5 border-t border-overview-border pt-3">/.test(pageSource) && /<summary/.test(pageSource));
  ok('texto do <summary> é "Histórico de carteira" (preserva o rótulo original)', /Histórico de carteira\s*<\/summary>/.test(pageSource));
  ok("continua condicionado a assignmentHistory.length > 0 (some inteiro só quando não há NENHUM período)", /\{assignmentHistory\.length > 0 && \(\s*<details/.test(pageSource));
  ok("AssignmentHistoryRow continua sendo usado dentro do <details> (conteúdo preservado)", /<AssignmentHistoryRow key=/.test(pageSource));
}

console.log("\n6 — Investimento: contexto operacional discreto, NUNCA mais um OperationMetric de peso igual à performance\n");
{
  ok(
    'label "Investimento da carteira atual em" preservado (Fase 1, testado por test-team-performance-data.ts) mas fora de qualquer <OperationMetric>',
    /Investimento da carteira atual em \{monthLabel\.toLowerCase\(\)\}/.test(pageSource),
  );
  const investmentLineSource = pageSource.match(/<p className="mt-2 text-\[13px\] text-overview-text-muted">\s*Investimento da carteira atual[\s\S]*?<\/p>/)?.[0] ?? "";
  ok("a linha de investimento é um <p> discreto (mt-2 text-muted), nunca <OperationMetric>", investmentLineSource.length > 0 && !/OperationMetric/.test(investmentLineSource));
  ok('linha deixa explícito que não é leitura de performance/mérito ("contexto operacional")', /contexto operacional, não é/.test(pageSource));
}

console.log("\n7 — Experiência: all-time é o número principal, mês vira contexto do MESMO metric — nunca duas janelas somadas ou substituídas\n");
{
  const experienceSectionSource = pageSource.match(/<SectionHeader title="Experiência" accent \/>[\s\S]*?Nenhum valor de investimento[\s\S]*?<\/p>\s*<\/div>/)?.[0] ?? "";
  ok('seção "Experiência" existe uma única vez (antiga "Atuação em [mês]" não existe mais separada)', !/Atuação em \$\{monthLabel/.test(pageSource));
  ok("valor principal de Otimizações é o all-time (activityAllTime.optimizations), nunca activityInPeriod sozinho", /value=\{String\(activityAllTime\.optimizations\)\}/.test(experienceSectionSource));
  ok("contexto do mês usa activityInPeriod (dado DIFERENTE do all-time, nunca somado)", /activityInPeriod\.optimizations > 0 \? `\$\{activityInPeriod\.optimizations\} neste mês`/.test(experienceSectionSource));
  ok("nenhuma soma entre activityAllTime e activityInPeriod em lugar nenhum do arquivo (all-time + período)", !/activityAllTime\.\w+ \+ activityInPeriod|activityInPeriod\.\w+ \+ activityAllTime/.test(pageSource));
  ok("contexto do mês só aparece quando > 0 (nunca '0 neste mês' fabricado como informação)", /activityInPeriod\.reportsSent > 0 \? `\$\{activityInPeriod\.reportsSent\} neste mês` : undefined/.test(experienceSectionSource));
  ok('nenhum sinal "+" antes do número de contexto (semanticamente seria "a mais", mas o mês já está contido no all-time)', !/\+\$\{activityInPeriod/.test(experienceSectionSource));
}

console.log("\n8 — Clientes atendidos continua distinto de clientes sob responsabilidade (nenhuma confusão introduzida pela fusão)\n");
{
  ok("Experiência usa distinctClientsServed (atendidos), nunca portfolio.clientCount", /label="Clientes atendidos" value=\{String\(distinctClientsServed\)\}/.test(pageSource));
  ok('Carteira & Performance usa portfolio.clientCount pra "sob responsabilidade" — os dois nunca se misturam no mesmo número', /label="Clientes sob responsabilidade" value=\{String\(portfolio\.clientCount\)\}/.test(pageSource));
}

console.log("\n9 — Ordem provisória da página (6D): Trajetória -> Carteira & Performance -> Experiência -> Insígnias -> Conquistas\n");
{
  const order = ["Trajetória", "Carteira & Performance", "Experiência", "Insígnias", "Conquistas"];
  const positions = order.map((title) => pageSource.indexOf(`"${title}"`));
  ok("todas as 5 seções foram encontradas no arquivo", positions.every((p) => p !== -1));
  ok("a ordem no arquivo bate exatamente com a ordem pedida pra esta etapa", positions.every((p, i) => i === 0 || p > positions[i - 1]));
}

console.log("\n10 — Nenhuma alteração fora do escopo desta etapa (6A/6B/6C, achievement engine, detectors, client_manager_assignments)\n");
{
  ok("InsigniaMark continua sendo o único componente de insígnia usado (6B intocado)", /<InsigniaMark insignia=/.test(pageSource));
  ok("selectFeaturedInsignias continua a única seleção de destaques (6C intocado)", /const featuredInsignias = selectFeaturedInsignias\(insignias\);/.test(pageSource));
  ok("cabeçalho (6C) continua usando ClientAvatar palette=\"koff\"", /<ClientAvatar name=\{member\.name\} imageUrl=\{member\.avatarUrl\} size="lg" palette="koff" \/>/.test(pageSource));
  ok("nenhuma chamada a Supabase fora de createSupabaseClient/loadTeamMemberProfiles/loadManagerAssignmentHistory/loadManagerPortfolioEvolution (nenhuma query nova)", !/\.from\(/.test(pageSource));
}

console.log("\n11 — Nenhuma regressão de escopo (score/ranking/gamificação proibida) na consolidação\n");
{
  ok("nenhuma palavra de score/ranking/XP/nível/bônus", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|b[oô]nus/i.test(pageSource));
  ok("nenhuma palavra de medalha/troféu/escudo/neon", !/medalha|troféu|trofeu|escudo|neon/i.test(pageSource));
  ok('nenhuma frase que associe investimento a mérito ("mais investimento = melhor")', !/mais investimento.{0,20}melhor/i.test(pageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
