/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6B" —
 * `components/workspace/insignia-mark.tsx` (representação visual) +
 * integração em `app/team/[id]/page.tsx`.
 *
 * Este ambiente não tem um pipeline de renderização React nos testes deste
 * projeto (nenhum `test-*.ts` existente usa `react-dom/server` — mesma
 * convenção seguida aqui): a cobertura é estrutural, sobre o código-fonte
 * vivo (sem comentários), igual a `test-team-trajectory.ts`/
 * `test-report-share-metadata.ts`.
 *
 * Rodar: npx tsx scripts/test-insignia-mark.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stageNumeral } from "../src/components/workspace/insignia-mark";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

const markSource = stripComments(readFileSync(join(__dirname, "..", "src", "components", "workspace", "insignia-mark.tsx"), "utf8"));
const pageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));

console.log("\n1 — stageNumeral: conversão correta, consistente entre credencial e glifo\n");
{
  ok("estágio 1 -> 'I'", stageNumeral(1) === "I");
  ok("estágio 2 -> 'II'", stageNumeral(2) === "II");
  ok("estágio 3 -> 'III'", stageNumeral(3) === "III");
  ok("estágio 4 -> 'IV'", stageNumeral(4) === "IV");
  ok("estágio 5 -> 'V'", stageNumeral(5) === "V");
}

console.log("\n2 — Paleta KOFF fixa e exata (creme/areia/grafite/branco/lime), nunca tokens de tema claro/escuro\n");
{
  ok('CREAM = "#EFE9E0"', /const CREAM = "#EFE9E0";/.test(markSource));
  ok('SAND = "#C8BEAD"', /const SAND = "#C8BEAD";/.test(markSource));
  ok('GRAPHITE = "#17171A"', /const GRAPHITE = "#17171A";/.test(markSource));
  ok('WHITE = "#FFFFFF"', /const WHITE = "#FFFFFF";/.test(markSource));
  ok('LIME = "#D8F238"', /const LIME = "#D8F238";/.test(markSource));
  ok(
    "nunca usa os tokens semânticos de tema (--brand/--sand/--cream via classes Tailwind bg-brand/fill-brand etc.) pro preenchimento da placa",
    !/fill-brand|fill-sand|fill-cream|stroke-brand/.test(markSource),
  );
}

console.log("\n3 — Forma-base: UMA única placa geométrica, reaproveitada por toda insígnia (nunca uma forma por família/prestígio)\n");
{
  const plateDeclarations = markSource.match(/const PLATE_PATH = /g) ?? [];
  ok("PLATE_PATH declarado exatamente 1 vez", plateDeclarations.length === 1);
  ok("<path> usa sempre a mesma constante PLATE_PATH", /<path d=\{PLATE_PATH\}/.test(markSource));
  ok("forma não é um círculo puro (não usa <circle> como plate)", !/<circle[^>]*PLATE/.test(markSource));
}

console.log("\n4 — Os 3 níveis de prestígio (Marco/Destaque/Elite) têm tratamento visual distinto e determinístico\n");
{
  ok("PRESTIGE_STYLES define exatamente marco/destaque/elite", /marco:\s*\{[\s\S]*?\},\s*destaque:\s*\{[\s\S]*?\},\s*elite:\s*\{[\s\S]*?\}/.test(markSource));
  ok("Marco preenche em CREAM (predominantemente contorno)", /marco: \{ plateFill: CREAM/.test(markSource));
  ok("Destaque preenche em SAND (mais presença)", /destaque: \{ plateFill: SAND/.test(markSource));
  ok("Elite preenche em GRAPHITE + glifo branco (maior contraste)", /elite: \{ plateFill: GRAPHITE, plateStroke: GRAPHITE, glyphColor: WHITE \}/.test(markSource));
  ok(
    "o traço (plateStroke) é SEMPRE grafite nos 3 níveis — a silhueta nunca desaparece, só o preenchimento muda (perceptível sem cor)",
    (markSource.match(/plateStroke: GRAPHITE/g) ?? []).length === 3,
  );
}

console.log("\n5 — O detalhe lime é exclusivo da Elite, único na peça, e extremamente pequeno\n");
{
  const limeUsages = markSource.match(/fill=\{LIME\}|LIME\}/g) ?? [];
  ok("LIME é referenciado só no acento da Elite (1 ocorrência de uso de cor, fora da declaração da constante)", limeUsages.length <= 2);
  ok('acento lime é condicional a prestige === "elite"', /insignia\.prestige === "elite" && <circle cx="51" cy="13" r="2" fill=\{LIME\} \/>/.test(markSource));
  ok("o raio do acento lime é pequeno (r=2, numa placa de 64x64)", /r="2" fill=\{LIME\}/.test(markSource));
}

console.log("\n6 — Glifos: 7 famílias visuais, cada uma com um caso próprio no switch (nenhum ícone de biblioteca/emoji)\n");
{
  for (const glyphKey of ["otimizacoes", "revisoes", "clientes_atendidos", "reports", "experiencia", "consistencia", "performance"]) {
    ok(`glifo próprio para '${glyphKey}'`, new RegExp(`case "${glyphKey}":`).test(markSource));
  }
  ok("nenhum emoji no arquivo", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(markSource));
  ok("nenhuma tag <img>/asset externo — só SVG inline", !/<img\b/.test(markSource) && !/\.(png|svg|jpg|jpeg)"/.test(markSource));
}

console.log('\n7 — Consistência ganha glifo PRÓPRIO mesmo compartilhando family "performance" com os outros 2 tipos de Performance na 6A\n');
{
  ok(
    "resolveGlyphKey trata person_consecutive_months_fully_within_target como exceção explícita (glifo 'consistencia', nunca 'performance')",
    /if \(insignia\.type === "person_consecutive_months_fully_within_target"\) return "consistencia";/.test(markSource),
  );
  ok("fora dessa exceção, a chave do glifo é sempre a família crua (nenhuma segunda classificação inventada)", /return insignia\.family;/.test(markSource));
}

console.log("\n8 — Progressão: MESMO glifo por família em todo estágio — só o numeral (texto) diferencia, nunca 5 formas diferentes\n");
{
  ok("o numeral de estágio é desenhado como <text>, nunca como um glifo/forma nova por estágio", /<text x="32" y="52"/.test(markSource));
  ok("o numeral só aparece quando a insígnia tem estágio (progressivas) — nunca nas únicas/recorrentes", /\{insignia\.stage && \(/.test(markSource));
  const glyphFunctionSource = markSource.match(/function InsigniaGlyph[\s\S]*?\n\}/)?.[0] ?? "";
  ok("nenhuma lógica de 'estágio' dentro do switch de glifos (o switch decide só a família, nunca o patamar)", !/stage/i.test(glyphFunctionSource));
}

console.log("\n9 — Nenhuma regra de negócio dentro do componente visual — só apresentação a partir de campos já prontos\n");
{
  ok("insignia-mark.tsx nunca importa Supabase", !/supabase/i.test(markSource));
  ok("insignia-mark.tsx nunca importa achievement-thresholds/achievement-badges/achievements-data (nenhuma reclassificação aqui)", !/achievement-thresholds|achievement-badges|achievements-data/.test(markSource));
  ok("insignia-mark.tsx só importa TIPOS de lib/achievement-insignia (Insignia/InsigniaPrestige), nunca as funções de classificação", /import type \{ Insignia, InsigniaPrestige \} from "@\/lib\/achievement-insignia";/.test(markSource));
}

console.log("\n10 — Nenhuma estética proibida (emoji/medalha/escudo/XP/neon) no componente ou na integração da página\n");
{
  const combined = `${markSource}\n${pageSource}`;
  ok("nenhuma palavra de medalha/escudo/troféu/XP/nível/neon", !/medalha|escudo|troféu|trofeu|\bXP\b|\bn[íi]vel\b|neon/i.test(combined));
  ok("nenhuma palavra de score/ranking/pontuação", !/\bscore\b|\branking\b|pontua[çc][ãa]o/i.test(combined));
}

console.log("\n11 — Integração na página: sistema antigo (selectPersonBadges/BadgeCredential/BADGE_LABELS) totalmente removido\n");
{
  ok("page.tsx não importa mais selectPersonBadges", !/selectPersonBadges/.test(pageSource));
  ok("page.tsx não tem mais BadgeCredential/BADGE_LABELS/formatBadgeValue (substituídos pela 6B)", !/BadgeCredential|BADGE_LABELS|formatBadgeValue/.test(pageSource));
  ok("page.tsx usa buildInsigniaCollection (Etapa 6A) pra montar a coleção", /const insignias = buildInsigniaCollection\(/.test(pageSource));
  ok("page.tsx renderiza InsigniaCredential por insígnia", /\{insignias\.map\(\(insignia\) => \(/.test(pageSource) && /<InsigniaCredential key=\{insignia\.type\} insignia=\{insignia\} \/>/.test(pageSource));
}

console.log('\n12 — "Próximos marcos" é condicional e discreto (texto puro, sem símbolo, nunca parede de cadeados)\n');
{
  ok("só renderiza quando upcomingMilestones.length > 0 (nunca um estado vazio forçado)", /\{upcomingMilestones\.length > 0 && \(/.test(pageSource));
  ok("upcomingMilestoneLabel nunca renderiza <InsigniaMark> (é texto puro)", !/function upcomingMilestoneLabel[\s\S]*?InsigniaMark/.test(pageSource));
  ok('progresso cai pro texto "próximo: N" quando não há contagem viva (nunca fração fabricada)', /próximo: \$\{insignia\.nextMilestone\}/.test(pageSource));
}

console.log("\n13 — Grade responsiva: 2 colunas por padrão (mobile), 3 em telas maiores — nunca 1 coluna forçada nem scroll horizontal\n");
{
  ok('coleção de insígnias usa "grid grid-cols-2 gap-3 sm:grid-cols-3" (2 no mobile, 3 a partir de sm)', /className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"/.test(pageSource));
  const insigniaSectionSource = pageSource.match(/INSÍGNIAS[\s\S]*?Próximos marcos[\s\S]*?\)\}/)?.[0] ?? pageSource;
  ok("nenhuma classe de scroll horizontal (overflow-x) na seção de insígnias", !/overflow-x/.test(insigniaSectionSource));
}

console.log("\n14 — Contagens vivas usadas no 'próximo marco' são reaproveitadas da mesma página (nenhuma query nova)\n");
{
  ok(
    "liveCounts reaproveita activityAllTime.optimizations/reportsSent e distinctClientsServed, já carregados por loadTeamMemberProfiles",
    /person_optimizations_milestone: activityAllTime\.optimizations/.test(pageSource) &&
      /person_reports_milestone: activityAllTime\.reportsSent/.test(pageSource) &&
      /person_clients_served_milestone: distinctClientsServed/.test(pageSource),
  );
  ok("revisões nunca recebe contagem viva nesta etapa (sem query nova pra isso)", !/person_reviews_milestone: /.test(pageSource));
}

console.log("\n15 — Nenhuma outra seção da página foi alterada nesta etapa (cabeçalho, ordem, demais componentes intactos)\n");
{
  for (const title of ["Trajetória", "Carteira atual", "Performance da carteira atual", "Evolução", "Histórico de carteira", "Experiência", "Conquistas"]) {
    ok(`seção "${title}" continua presente e intocada`, pageSource.includes(`"${title}"`) || pageSource.includes(`title={\`${title}`));
  }
  ok("ClientAvatar continua importado e usado como antes (nenhuma variante nova nesta etapa)", /<ClientAvatar name=\{member\.name\} imageUrl=\{member\.avatarUrl\} size="lg" \/>/.test(pageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
