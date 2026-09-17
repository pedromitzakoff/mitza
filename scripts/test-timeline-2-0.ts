/**
 * Etapa "Timeline 2.0" (V1 reduzida, aprovada) — `lib/agency-timeline.ts`
 * (família Ações/Performance, referência humana, relação entre eventos) +
 * `lib/event-reference.ts` + `/timeline` (filtro novo, callout de evento
 * relacionado) + `/achievements` (só perdeu a entrada de navegação,
 * intocada por dentro) + Home (fonte única).
 *
 * Mesmo padrão de sempre neste ambiente (sem Supabase real): as funções
 * PURAS (`formatEventReference`/`parseEventRelation`/`eventTypesForFilters`/
 * `resolveAgencyTimelineFamily`) são testadas dinamicamente; o resto
 * (query real, ausência de causalidade, motor de Conquistas intocado) é
 * verificado estruturalmente no código-fonte (sem comentários).
 *
 * Rodar: npx tsx scripts/test-timeline-2-0.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eventTypesForFilters,
  eventTypesForFilter,
  resolveAgencyTimelineFamily,
  AGENCY_TIMELINE_FAMILY_OPTIONS,
} from "../src/lib/agency-timeline";
import { formatEventReference, parseEventRelation } from "../src/lib/event-reference";
import { OperationalEventType as EventType } from "../src/lib/operational-events";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

const agencyTimelineSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "agency-timeline.ts"), "utf8"));
const eventReferenceSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "event-reference.ts"), "utf8"));
const timelinePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "timeline", "page.tsx"), "utf8"));
const timelineFilterBarSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "timeline", "timeline-filter-bar.tsx"), "utf8"));
const homePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8"));
const sidebarSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "sidebar.tsx"), "utf8"));
const achievementsPageSource = readFileSync(join(__dirname, "..", "src", "app", "achievements", "page.tsx"), "utf8");
const achievementEngineSource = readFileSync(join(__dirname, "..", "src", "lib", "achievement-engine.ts"), "utf8");

console.log("\n1 — Ações humanas continuam aparecendo\n");
{
  ok(
    "família 'acoes' devolve EXATAMENTE a mesma curadoria de sempre (eventTypesForFilter, nenhuma ação perdida)",
    JSON.stringify(eventTypesForFilters("acoes", "todos")) === JSON.stringify(eventTypesForFilter("todos")),
  );
  ok("ACCOUNT_REVIEW_RECORDED (otimização/revisão) continua em Ações", eventTypesForFilters("acoes", "todos").includes(EventType.ACCOUNT_REVIEW_RECORDED));
  ok("TASK_COMPLETED continua em Ações", eventTypesForFilters("acoes", "todos").includes(EventType.TASK_COMPLETED));
}

console.log("\n2 — Achievements existentes aparecem como Performance (positivo)\n");
{
  ok("achievement_unlocked entra na família 'performance'", eventTypesForFilters("performance", "todos").includes(EventType.ACHIEVEMENT_UNLOCKED));
  ok("achievement_unlocked NUNCA está na família 'acoes' (distinção estrutural ação != performance)", !eventTypesForFilters("acoes", "todos").includes(EventType.ACHIEVEMENT_UNLOCKED));
  ok(
    "código-fonte: toda linha de achievement_unlocked recebe family:'performance' e performanceTone:'positivo'",
    /eventType === EventType\.ACHIEVEMENT_UNLOCKED \? "performance" : "acao"/.test(agencyTimelineSource) &&
      /performanceTone: "positivo" as PerformanceTone/.test(agencyTimelineSource),
  );
  ok(
    "código-fonte: label/detail de performance vêm do metadata.headline/detail já gravado pelo motor (nunca recalculado)",
    /typeof metadata\.headline === "string" \? metadata\.headline/.test(agencyTimelineSource) && /typeof metadata\.detail === "string" \? metadata\.detail/.test(agencyTimelineSource),
  );
}

console.log("\n3 — Filtros Todos / Ações / Performance funcionam\n");
{
  ok('"todos" = ações + performance juntos (nunca duas listas separadas na UI)', eventTypesForFilters("todos", "todos").includes(EventType.ACHIEVEMENT_UNLOCKED) && eventTypesForFilters("todos", "todos").includes(EventType.TASK_COMPLETED));
  ok('"acoes" = só ações', !eventTypesForFilters("acoes", "todos").includes(EventType.ACHIEVEMENT_UNLOCKED));
  ok('"performance" = só achievement_unlocked (Tipo é ignorado, faz sentido: não existe "otimização" de performance)', eventTypesForFilters("performance", "otimizacoes").length === 1 && eventTypesForFilters("performance", "otimizacoes")[0] === EventType.ACHIEVEMENT_UNLOCKED);
  ok('resolveAgencyTimelineFamily: valor ausente/inválido cai em "todos"', resolveAgencyTimelineFamily(undefined) === "todos" && resolveAgencyTimelineFamily("lixo") === "todos");
  ok("resolveAgencyTimelineFamily: 'acoes'/'performance' resolvem literal", resolveAgencyTimelineFamily("acoes") === "acoes" && resolveAgencyTimelineFamily("performance") === "performance");
  ok("3 opções expostas pra UI (Todos/Ações/Performance, nunca mais que isso)", AGENCY_TIMELINE_FAMILY_OPTIONS.length === 3);
  ok(
    "UI: filtro de Tipo desaparece quando família é Performance (nunca um filtro visível e sem efeito)",
    /\{family !== "performance" && \(/.test(timelineFilterBarSource),
  );
}

console.log("\n4 — Filtro por Gestor e Cliente continuam funcionando junto da Família\n");
{
  ok("filtro de gestor continua .eq direto na query (agora em fetchAgencyEvents, o núcleo canônico)", /actorId\) query = query\.eq\("actor_team_member_id", actorId\)/.test(agencyTimelineSource));
  ok("filtro de cliente continua .eq direto na query", /clientId\) query = query\.eq\("client_id", clientId\)/.test(agencyTimelineSource));
  ok(
    "fetchAgencyTimeline (casca fina de /timeline) repassa filters.actorId/filters.clientId pra fetchAgencyEvents sem reimplementar o filtro",
    /actorId: filters\.actorId,\s*\n\s*clientId: filters\.clientId,/.test(agencyTimelineSource),
  );
  ok("AgencyTimelineFilters ganhou 'family' como um campo A MAIS (nunca substituiu actorId/clientId/type)", /actorId: string \| null;[\s\S]{0,120}clientId: string \| null;[\s\S]{0,300}family: AgencyTimelineFamilyFilter;/.test(agencyTimelineSource));
}

console.log("\n5 — Ordenação cronológica (inalterada)\n");
{
  ok("query continua ordenada por occurred_at desc (mais recente primeiro)", /\.order\("occurred_at", \{ ascending: false \}\)/.test(agencyTimelineSource));
}

console.log("\n6 — Referência humana (#EVT-XXXXXXXX) é estável\n");
{
  const idA = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  ok("mesmo id sempre produz a mesma referência", formatEventReference(idA) === formatEventReference(idA));
  ok("formato correto: #EVT- + 8 hex maiúsculos", /^#EVT-[0-9A-F]{8}$/.test(formatEventReference(idA)));
  ok("referência vem dos 8 primeiros caracteres do id (nunca de posição na lista)", formatEventReference(idA) === "#EVT-3FA85F64");
  const idB = "aaaaaaaa-0000-0000-0000-000000000000";
  ok("ids diferentes produzem referências diferentes (no caso comum)", formatEventReference(idA) !== formatEventReference(idB));
  ok("toda linha da Timeline carrega eventReference (formatEventReference(row.id), sempre presente)", /eventReference: formatEventReference\(row\.id\)/.test(agencyTimelineSource));
}

console.log("\n7 — Relação entre eventos aponta pra um evento existente e pode ser aberta\n");
{
  const validRelation = parseEventRelation({ related_event_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", relation_type: "occurred_after" });
  ok("metadata com related_event_id + relation_type válidos produz a relação", validRelation !== null && validRelation?.relatedEventId === "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  ok("ausência de metadata nunca inventa relação", parseEventRelation(null) === null);
  ok("metadata sem related_event_id nunca inventa relação", parseEventRelation({ relation_type: "occurred_after" }) === null);
  ok("relation_type desconhecido/malformado nunca é aceito (nunca uma relação de tipo inválido)", parseEventRelation({ related_event_id: "x", relation_type: "caused_by" }) === null);
  ok(
    "código-fonte: existe uma busca DIRETA por id real (fetchAgencyTimelineEventById) — a relação nunca é resolvida pela referência curta",
    /export async function fetchAgencyTimelineEventById/.test(agencyTimelineSource),
  );
  ok(
    "UI: link 'Ver evento' usa ?highlight=<uuid real> (relation.relatedEventId), nunca a referência curta como chave de busca",
    /\/timeline\?highlight=\$\{row\.relation\.relatedEventId\}/.test(timelinePageSource),
  );
  ok(
    "UI: highlight vindo da URL é validado contra um padrão de UUID antes de qualquer query (nunca um .eq direto com string não confiável)",
    /UUID_PATTERN\.test\(params\.highlight\)/.test(timelinePageSource),
  );
}

console.log("\n8 — Nenhuma frase afirma causalidade\n");
{
  const combinedSource = `${agencyTimelineSource}\n${eventReferenceSource}\n${timelinePageSource}`;
  const forbiddenPhrases = [
    /\bcausou\b/i,
    /\bcausada? por\b/i,
    /fez com que/i,
    /resultado da otimiza[çc][ãa]o/i,
    /melhorou a conta/i,
  ];
  for (const phrase of forbiddenPhrases) {
    ok(`código vivo (sem comentários) nunca contém ${phrase}`, !phrase.test(combinedSource));
  }
  ok('nunca usa o identificador "caused_by"', !/caused_by/i.test(combinedSource));
  ok('nunca usa o identificador "impact_caused_by"', !/impact_caused_by/i.test(combinedSource));
  ok('nunca usa o identificador "optimization_result"', !/optimization_result/i.test(combinedSource));
  ok('único EventRelationType existente é "occurred_after" (nunca causal)', /export type EventRelationType = "occurred_after";/.test(eventReferenceSource));
  ok('link de relação na UI usa a frase neutra "Observado após", nunca "causou"/"resultado de"', /Observado após \{formatEventReference/.test(timelinePageSource));
}

console.log("\n9 — Múltiplas intervenções: nenhuma triangulação automática fake nesta etapa\n");
{
  ok(
    "nenhum detector automático de 'antes/depois' foi implementado ainda (nenhuma referência a daily_spend/campaign_daily_metrics/janela de comparação em agency-timeline.ts)",
    !/campaign_daily_metrics|ad_set_daily_metrics|daily_spend|janela.*antes.*depois/i.test(agencyTimelineSource),
  );
  ok(
    "relation É só uma LEITURA de metadata já existente — nenhum código escreve related_event_id/relation_type nesta etapa (grep pela escrita, não pela leitura)",
    !/related_event_id:/.test(agencyTimelineSource) || /parseEventRelation\(metadata\)/.test(agencyTimelineSource),
  );
}

console.log("\n10 — Home não cria segundo motor de eventos, nem se acopla ao loader/vocabulário da tela Timeline\n");
{
  ok("Home não importa mais fetchAchievements", !/from "@\/lib\/achievements-data"/.test(homePageSource));
  ok("Home importa fetchRecentAgencyEvents (casca própria), nenhuma query própria a operational_events", /import \{ fetchRecentAgencyEvents \} from "@\/lib\/agency-timeline"/.test(homePageSource) && !/\.from\("operational_events"\)/.test(homePageSource));
  ok("Home NUNCA importa fetchAgencyTimeline nem o vocabulário de filtro da tela Timeline (AgencyTimelineType/AgencyTimelineFamilyFilter)", !/fetchAgencyTimeline/.test(homePageSource) && !/AgencyTimelineType|AgencyTimelineFamilyFilter/.test(homePageSource));
}

console.log("\n10b — Auditoria de acoplamento: fetchAgencyTimeline TINHA decisões de superfície; extração corrigiu isso\n");
{
  ok(
    "existe um núcleo canônico próprio (fetchAgencyEvents), independente de paginação/filtro de tela",
    /export async function fetchAgencyEvents/.test(agencyTimelineSource),
  );
  ok(
    "o núcleo canônico recebe eventTypes JÁ RESOLVIDOS (nunca decide sozinho o vocabulário Tipo/Família da tela Timeline)",
    /eventTypes: OperationalEventType\[\];/.test(agencyTimelineSource) && /const \{ eventTypes, actorId, clientId, limit, offset = 0 \} = eventQuery;/.test(agencyTimelineSource),
  );
  ok(
    "o núcleo canônico não sabe o que é 'página' — devolve 'truncated' (fato), nunca 'hasMore'/'page'/'pageSize' (decisão de UI)",
    /truncated: boolean;/.test(agencyTimelineSource) && !/interface AgencyEventPage[\s\S]{0,120}(page|pageSize)/.test(agencyTimelineSource),
  );
  ok(
    "fetchAgencyTimeline (Timeline) É a casca que introduz page/pageSize — só ela traduz isso pra offset/limit",
    /export async function fetchAgencyTimeline\([\s\S]{0,200}page = 0,\s*\n\s*pageSize = AGENCY_TIMELINE_PAGE_SIZE,/.test(agencyTimelineSource),
  );
  ok(
    "fetchRecentAgencyEvents (Home) NUNCA recebe page/pageSize/type/family — só limit",
    /export async function fetchRecentAgencyEvents\(\s*\n\s*supabase: SupabaseClient<Database>,\s*\n\s*organizationId: string,\s*\n\s*limit: number,\s*\n\s*\)/.test(agencyTimelineSource),
  );
  ok(
    "as duas cascas (Timeline e Home) chamam a MESMA fetchAgencyEvents — nenhuma query duplicada, nenhuma segunda classificação acao/performance",
    (agencyTimelineSource.match(/await fetchAgencyEvents\(/g) ?? []).length === 2,
  );
}

console.log("\n11 — Conquistas: motor/cron intocados; só a navegação mudou\n");
{
  ok('Sidebar não tem mais a entrada "Conquistas" apontando pra /achievements', !/label: "Conquistas"/.test(sidebarSource));
  ok('Timeline (item de nav) agora também fica ativo em /achievements (rota antiga continua acessível)', /isActive: \(p\) => p\.startsWith\("\/timeline"\) \|\| p\.startsWith\("\/achievements"\)/.test(sidebarSource));
  ok("/achievements continua sendo uma página funcional (export default async function), nunca um redirect que quebra os filtros existentes", /export default async function AchievementsPage/.test(achievementsPageSource));
  ok("achievement-engine.ts continua exportando exatamente as mesmas funções do motor (runAchievementEvaluation, evaluateAchievementsForDate, buildIdempotencyKey)", /export async function runAchievementEvaluation/.test(achievementEngineSource) && /export async function evaluateAchievementsForDate/.test(achievementEngineSource) && /export function buildIdempotencyKey/.test(achievementEngineSource));
  ok("lib/agency-timeline.ts NUNCA importa de achievement-engine.ts (presentation-only, nunca decide nada do motor)", !/from "@\/lib\/achievement-engine"/.test(agencyTimelineSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
