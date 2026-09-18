/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6E:
 * Acabamento final do perfil profissional" — `app/team/[id]/page.tsx`.
 *
 * Nenhum cálculo/fonte/regra nova nesta etapa — cobertura estrutural sobre
 * o código-fonte vivo (mesmo padrão de `test-team-profile-consolidation.ts`),
 * focada nas garantias que o acabamento final precisa preservar: os 3
 * grupos (Identidade / História profissional / Reconhecimento) só se
 * comunicam por ritmo/espaço/linha (nunca um container novo), a régua
 * visual de História profissional é consistente entre as 3 seções, e
 * Conquistas pesa deliberadamente menos que Insígnias — sem remover nenhum
 * dado, sem tocar 6A/6B/6C/6D.
 *
 * Rodar: npx tsx scripts/test-team-profile-polish.ts
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

console.log('\n1 — "História profissional" (Trajetória, Carteira & Performance, Experiência) tem a MESMA régua visual — todas com accent\n');
{
  ok('"Trajetória" tem accent', /<SectionHeader title="Trajetória" accent \/>/.test(pageSource));
  ok('"Carteira & Performance" tem accent', /<SectionHeader title="Carteira & Performance" accent \/>/.test(pageSource));
  ok('"Experiência" tem accent (6E — antes desalinhada das outras 2 seções do mesmo grupo)', /<SectionHeader title="Experiência" accent \/>/.test(pageSource));
}

console.log('\n2 — "Reconhecimento" (Insígnias, Conquistas) deliberadamente sem accent — grupo visualmente distinto, nunca um rail de texto\n');
{
  ok('"Insígnias" continua sem accent', /<SectionHeader title="Insígnias" \/>/.test(pageSource));
  ok('"Conquistas" continua sem accent', /<SectionHeader title="Conquistas" \/>/.test(pageSource));
}

console.log("\n3 — Entrada no grupo Reconhecimento é marcada por respiro maior (whitespace), nunca por um container novo\n");
{
  ok(
    "bloco de Insígnias abre com mt-14 (respiro maior que o ritmo mt-8 interno de um grupo) — mesma linha/borda de sempre, só o espaço muda",
    /<div className="mt-14 border-t border-overview-border pt-4">\s*<SectionHeader title="Insígnias" \/>/.test(pageSource),
  );
  ok(
    "quando não há Insígnias, Conquistas herda esse mesmo respiro maior de entrada do grupo (nunca fica com o ritmo interno mt-8 nesse caso)",
    /className=\{insignias\.length > 0 \? "mt-8 border-t border-overview-border pt-4" : "mt-14 border-t border-overview-border pt-4"\}/.test(pageSource),
  );
  ok("nenhum container/painel novo introduzido (sem novo div com bg-/rounded-.*p-\\d envolvendo um grupo inteiro)", !/rounded-\w+ (border )?bg-overview-surface[\s\S]{0,10}(Trajetória|Insígnias|Reconhecimento)/.test(pageSource));
}

console.log("\n4 — Conquistas pesa deliberadamente menos que Insígnias (tipografia/densidade, nunca um parágrafo explicando a diferença)\n");
{
  const conquistasBlock = pageSource.match(/<SectionHeader title="Conquistas" \/>[\s\S]*?\n {6}<\/div>\s*\)\s*\}/)?.[0] ?? pageSource;
  ok(
    "headline de Conquistas usa texto secundário discreto (text-overview-text-secondary), nunca font-medium/text-primary como um título",
    /text-\[13px\] text-overview-text-secondary">\{achievement\.headline\}/.test(pageSource),
  );
  ok("headline de Conquistas NUNCA usa a mesma classe de destaque da credencial de Insígnias (text-sm font-semibold text-overview-text-primary)", !/text-sm font-semibold text-overview-text-primary">\{achievement\.headline\}/.test(pageSource));
  ok("linhas de Conquistas são mais densas (py-2) que a credencial de Insígnias (p-3) — mesma distinção sem parágrafo explicativo", /key=\{achievement\.id\} className="py-2">/.test(pageSource));
  ok("nenhum parágrafo explica a diferença Insígnias/Conquistas (a distinção é só visual)", !/coleção[\s\S]{0,60}registro histórico|registro histórico[\s\S]{0,60}coleção/i.test(pageSource));
  void conquistasBlock;
}

console.log("\n5 — Sistema de micro-rótulos (uppercase, muted) unificado num único tamanho — nunca 10px e 11px coexistindo sem motivo\n");
{
  ok('rótulo "Evolução" em 11px', /text-\[11px\] font-medium uppercase tracking-wide text-overview-text-muted">Evolução<\/p>/.test(pageSource));
  ok('rótulo "Próximos marcos" em 11px (6E — antes 10px, único nesse tamanho)', /text-\[11px\] font-medium uppercase tracking-wide text-overview-text-muted">Próximos marcos<\/p>/.test(pageSource));
  ok("rótulo de família na credencial de Insígnias em 11px (6E — antes 10px)", /text-\[11px\] font-medium uppercase tracking-wide text-overview-text-muted">\{familyLabel\}<\/p>/.test(pageSource));
  ok("nenhum micro-rótulo uppercase/muted remanescente em 10px", !/text-\[10px\] font-medium uppercase tracking-wide text-overview-text-muted/.test(pageSource));
}

console.log("\n6 — Ordem final da página (6E, sem mudança em relação à 6D): Trajetória -> Carteira & Performance -> Experiência -> Insígnias -> Conquistas\n");
{
  const order = ["Trajetória", "Carteira & Performance", "Experiência", "Insígnias", "Conquistas"];
  const positions = order.map((title) => pageSource.indexOf(`"${title}"`));
  ok("todas as 5 seções foram encontradas no arquivo", positions.every((p) => p !== -1));
  ok("a ordem final bate exatamente com a ordem pedida", positions.every((p, i) => i === 0 || p > positions[i - 1]));
}

console.log("\n7 — Nenhuma alteração fora do escopo desta etapa (6A/6B/6C/6D, achievement engine, detectors, queries, client_manager_assignments)\n");
{
  ok("InsigniaMark continua sendo o único componente de insígnia usado (6B intocado)", /<InsigniaMark insignia=/.test(pageSource));
  ok("selectFeaturedInsignias/buildInsigniaCollection/selectUpcomingMilestones continuam a única lógica de insígnias (6A intocado)", /buildInsigniaCollection\(achievements,/.test(pageSource) && /selectFeaturedInsignias\(insignias\)/.test(pageSource) && /selectUpcomingMilestones\(insignias\)/.test(pageSource));
  ok("cabeçalho (6C) continua usando ClientAvatar palette=\"koff\" e resolveProfileContextLine", /<ClientAvatar name=\{member\.name\} imageUrl=\{member\.avatarUrl\} size="lg" palette="koff" \/>/.test(pageSource) && /resolveProfileContextLine\(portfolio, portfolioPerformance\)/.test(pageSource));
  ok("Carteira & Performance (6D) continua com o merge por Map(clientId) e o <details> de histórico intocados", /performanceByClientId = new Map\(portfolioPerformance\.clients\.map/.test(pageSource) && /<details className="mt-5 border-t border-overview-border pt-3">/.test(pageSource));
  ok("nenhuma chamada a Supabase fora dos 3 loaders já estabelecidos (nenhuma query nova)", !/\.from\(/.test(pageSource));
}

console.log("\n8 — Nenhuma regressão de escopo (score/ranking/XP/gamificação proibida) no acabamento final\n");
{
  ok("nenhuma palavra de score/ranking/XP/nível/bônus/leaderboard", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|b[oô]nus|leaderboard/i.test(pageSource));
  ok("nenhuma palavra de medalha/troféu/escudo/neon", !/medalha|troféu|trofeu|escudo|neon/i.test(pageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
