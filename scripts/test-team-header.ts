/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6C:
 * Cabeçalho do Perfil Profissional" — `app/team/[id]/page.tsx` (bloco de
 * identidade) + variante opt-in `palette="koff"` de `ClientAvatar`.
 *
 * `resolveProfileContextLine` é exportada e testada diretamente (função
 * pura, sem Supabase) — as 3 famílias de estado (sem cliente / sem conta
 * avaliável / caso geral) são testadas com precisão, não só por regex. O
 * resto (composição visual, reuso de `selectFeaturedInsignias`, ausência
 * de credencial duplicada, avatar KOFF isolado do padrão) é verificado
 * estruturalmente, mesmo padrão de `test-insignia-mark.ts`.
 *
 * Rodar: npx tsx scripts/test-team-header.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProfileContextLine } from "../src/app/team/[id]/page";
import type { TeamMemberPortfolioSummary } from "../src/lib/team-performance-data";
import type { PortfolioPerformanceSummary } from "../src/lib/team-portfolio-performance";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function fakePortfolio(clientCount: number): TeamMemberPortfolioSummary {
  return { clientCount, investmentActual: 0, clients: [], comparableCount: 0, withinOrAboveTargetCount: 0 };
}

function fakePerformance(evaluableCount: number, withinTargetCount: number): PortfolioPerformanceSummary {
  return { evaluableCount, withinTargetCount, outsideTargetCount: evaluableCount - withinTargetCount, unavailableCount: 0, clients: [] };
}

const pageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));
const avatarSource = stripComments(readFileSync(join(__dirname, "..", "src", "components", "workspace", "client-avatar.tsx"), "utf8"));

console.log("\n1 — resolveProfileContextLine: sem cliente algum -> frase própria, nunca tenta falar de performance\n");
{
  ok("0 clientes -> frase dedicada", resolveProfileContextLine(fakePortfolio(0), fakePerformance(0, 0)) === "Nenhum cliente sob responsabilidade no momento.");
}

console.log("\n2 — resolveProfileContextLine: cliente(s) mas nenhuma conta avaliável -> nunca '0 de 0 dentro da meta'\n");
{
  const line = resolveProfileContextLine(fakePortfolio(3), fakePerformance(0, 0));
  ok("nunca contém '0 de 0'", !line.includes("0 de 0"));
  ok('diz explicitamente "nenhuma conta avaliável"', line === "3 clientes sob responsabilidade · nenhuma conta avaliável no momento");
}

console.log("\n3 — resolveProfileContextLine: caso geral — X de Y contas avaliáveis dentro da meta (Y pode ser < carteira total)\n");
{
  const line = resolveProfileContextLine(fakePortfolio(6), fakePerformance(5, 4));
  ok('bate exatamente com o exemplo do pedido ("6 clientes... 4 de 5 contas avaliáveis dentro da meta")', line === "6 clientes sob responsabilidade · 4 de 5 contas avaliáveis dentro da meta");
}

console.log("\n4 — resolveProfileContextLine: carteira inteira avaliável (Y = total) também funciona com a mesma fórmula\n");
{
  const line = resolveProfileContextLine(fakePortfolio(5), fakePerformance(5, 5));
  ok("todas as 5 avaliáveis, todas dentro da meta", line === "5 clientes sob responsabilidade · 5 de 5 contas avaliáveis dentro da meta");
}

console.log("\n5 — resolveProfileContextLine: singular correto (1 cliente, 1 conta avaliável)\n");
{
  ok("1 cliente -> 'cliente' (singular), nunca 'clientes'", resolveProfileContextLine(fakePortfolio(1), fakePerformance(0, 0)).startsWith("1 cliente sob responsabilidade"));
  ok("1 conta avaliável -> 'conta avaliável' (singular), nunca 'contas avaliáveis'", resolveProfileContextLine(fakePortfolio(1), fakePerformance(1, 1)) === "1 cliente sob responsabilidade · 1 de 1 conta avaliável dentro da meta");
}

console.log("\n6 — resolveProfileContextLine: NUNCA menciona investimento (nunca mérito por volume administrado)\n");
{
  const anyLine = resolveProfileContextLine(fakePortfolio(6), fakePerformance(5, 4));
  ok("nenhuma das frases possíveis menciona 'investimento'/'R$'", !/investimento|R\$/i.test(anyLine));
  const contextFnSource = pageSource.match(/export function resolveProfileContextLine[\s\S]*?\n\}/)?.[0] ?? "";
  ok("a função nunca lê portfolio.investmentActual", !/investmentActual/.test(contextFnSource));
}

console.log("\n7 — Cabeçalho reaproveita selectFeaturedInsignias (Etapa 6A) — nenhuma seleção/prestígio reimplementado na página\n");
{
  ok("page.tsx importa selectFeaturedInsignias de lib/achievement-insignia", /import \{ buildInsigniaCollection, selectFeaturedInsignias, selectUpcomingMilestones/.test(pageSource));
  ok("featuredInsignias vem diretamente de selectFeaturedInsignias(insignias)", /const featuredInsignias = selectFeaturedInsignias\(insignias\);/.test(pageSource));
  ok("page.tsx nunca reimplementa comparação de prestígio (PRESTIGE_RANK/elite > destaque) fora da lib", !/PRESTIGE_RANK|"elite" > "destaque"/.test(pageSource));
}

console.log("\n8 — Destaques no cabeçalho: objeto visual puro, NUNCA a credencial completa (sem duplicar a seção Insígnias)\n");
{
  ok("bloco de destaques usa InsigniaMark", /featuredInsignias\.map[\s\S]*?InsigniaMark/.test(pageSource));
  ok('cabeçalho nunca renderiza "Estágio" como texto visível perto dos destaques (isso é só da credencial completa)', !/featuredInsignias[\s\S]{0,400}Estágio/.test(pageSource));
  ok('cabeçalho nunca renderiza "Conquistada em" (data completa) — isso é só da credencial completa', !/featuredInsignias[\s\S]{0,400}Conquistada em/.test(pageSource));
}

console.log("\n9 — Sem destaques (0 insígnias): nenhum placeholder, nenhum cadeado, nenhuma frase de cobrança\n");
{
  ok('condicional "featuredInsignias.length > 0 &&" — sem destaques, a linha inteira some, nunca um placeholder', /\{featuredInsignias\.length > 0 && \(/.test(pageSource));
  ok('nenhuma frase de cobrança tipo "você ainda não conquistou" em lugar nenhum do arquivo', !/ainda n[ãa]o conquistou|nenhuma insígnia ainda/i.test(pageSource));
}

console.log("\n10 — Nome é o elemento de maior hierarquia tipográfica do cabeçalho\n");
{
  ok('nome usa text-2xl/text-3xl (maior que o cargo/status e maior que o antigo text-xl)', /text-2xl font-semibold tracking-tight text-overview-text-primary sm:text-3xl/.test(pageSource));
  ok("seletor de mês foi rebaixado (texto pequeno, tom muted — nunca mais font-medium/text-primary como antes)", /text-\[13px\] text-overview-text-muted\">\{monthLabel\}/.test(pageSource));
}

console.log("\n11 — Avatar: variante KOFF usada SÓ no cabeçalho do perfil, nunca alterando o padrão do componente\n");
{
  ok('cabeçalho usa palette="koff" explicitamente (opt-in)', /<ClientAvatar name=\{member\.name\} imageUrl=\{member\.avatarUrl\} size="lg" palette="koff" \/>/.test(pageSource));
  ok('ClientAvatar mantém "auto" como valor padrão de `palette` (comportamento existente intocado sem a prop)', /palette = "auto"/.test(avatarSource));
  ok("a paleta arco-íris original (AVATAR_PALETTE) continua intocada no componente", /const AVATAR_PALETTE = \[/.test(avatarSource));

  const otherCallSites = [
    "src/app/team/page.tsx",
    "src/app/agency-accounts-tree-client.tsx",
    "src/app/operation/operation-client-card.tsx",
    "src/app/clients/client-identity-sticky.tsx",
    "src/app/clients/[id]/page.tsx",
    "src/app/clients/client-form.tsx",
  ];
  for (const file of otherCallSites) {
    const source = stripComments(readFileSync(join(__dirname, "..", file), "utf8"));
    ok(`${file}: nenhum uso de ClientAvatar passa palette= (comportamento padrão intocado)`, !/<ClientAvatar[^>]*palette=/.test(source));
  }
}

console.log("\n12 — Mobile: identidade empilha antes do seletor de mês, nunca o desktop simplesmente quebrando linha\n");
{
  ok(
    "container do cabeçalho é flex-col por padrão (mobile), só vira flex-row a partir de sm (identidade sempre antes do seletor de mês na ordem do DOM)",
    /className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"/.test(pageSource),
  );
  const identityBlockSource = pageSource.match(/IDENTIDADE[\s\S]*?Insígnias em destaque/)?.[0] ?? "";
  ok("nenhuma classe de overflow-x/scroll horizontal no bloco de identidade", !/overflow-x/.test(identityBlockSource));
}

console.log('\n13 — Seções da página continuam presentes (Etapa 6D, posterior a este arquivo, consolidou Carteira/Performance/Evolução/Histórico em "Carteira & Performance" — mudança intencional, ver relatório da Etapa 6D)\n');
{
  for (const title of ["Trajetória", "Carteira & Performance", "Experiência", "Insígnias", "Conquistas"]) {
    ok(`seção "${title}" continua presente`, pageSource.includes(`"${title}"`) || pageSource.includes(`title={\`${title}`));
  }
}

console.log("\n14 — Nenhuma regressão de escopo (score/ranking/XP/gamificação proibida) no cabeçalho\n");
{
  ok("nenhuma palavra de score/ranking/XP/nível/bônus no arquivo", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b|b[oô]nus/i.test(pageSource));
  ok("nenhuma palavra de medalha/troféu/escudo/neon", !/medalha|troféu|trofeu|escudo|neon/i.test(pageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
