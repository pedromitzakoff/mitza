/**
 * Etapa "Equipe — Fase 5: Trajetória e Experiência Profissional" —
 * `lib/team-trajectory.ts` (curadoria pura) + `lib/team-performance-data.ts`
 * (`countDistinctClientsByActor`, "Clientes atendidos") + reorganização de
 * `app/team/[id]/page.tsx`.
 *
 * Este ambiente não tem Supabase real — a curadoria é 100% pura (recebe
 * `AchievementRow[]` já montado), então é testada dinamicamente com
 * fixtures; o resto (ausência de nova fonte/evento/detector, ausência de
 * qualquer dependência de `team_members.created_at`, seções condicionais da
 * página) é verificado estruturalmente no código-fonte, mesmo padrão já
 * usado por `test-team-performance-data.ts`.
 *
 * Rodar: npx tsx scripts/test-team-trajectory.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { curateTeamMemberTrajectory } from "../src/lib/team-trajectory";
import { countDistinctClientsByActor } from "../src/lib/team-performance-data";
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

/** Fixture mínima — só os campos que `curateTeamMemberTrajectory` de fato lê
 * (`type`, `occurredAt`, `metric.target`, `headline` como fallback
 * defensivo). O resto recebe valores neutros irrelevantes pro teste. */
function achievement(type: string, occurredAt: string, target: number | null = null, overrides: Partial<AchievementRow> = {}): AchievementRow {
  return {
    id: `${type}:${occurredAt}`,
    occurredAt,
    detectedAt: occurredAt,
    scope: "person",
    family: "generic",
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

const teamTrajectorySource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-trajectory.ts"), "utf8"));
const teamPerformanceDataSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-performance-data.ts"), "utf8"));
const teamProfilePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));

console.log("\n1 — Curadoria básica: um marco de cada família aparece\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_optimizations_milestone", "2026-03-10T12:00:00-03:00", 50),
    achievement("person_first_meeting_completed", "2026-01-05T12:00:00-03:00"),
  ]);
  ok("2 pontos gerados", points.length === 2);
  ok("headline de otimizações é impessoal e sem nome ('50 otimizações registradas')", points.some((p) => p.headline === "50 otimizações registradas"));
  ok("headline de primeira reunião é impessoal ('Primeira reunião concluída')", points.some((p) => p.headline === "Primeira reunião concluída"));
}

console.log("\n2 — Máximo 6 pontos, mesmo com mais candidatos elegíveis\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_first_client_within_target", "2026-01-01T12:00:00-03:00"),
    achievement("person_consecutive_months_fully_within_target", "2026-02-01T12:00:00-03:00", 3),
    achievement("person_clients_served_milestone", "2026-03-01T12:00:00-03:00", 10),
    achievement("person_optimizations_milestone", "2026-04-01T12:00:00-03:00", 50),
    achievement("person_reports_milestone", "2026-05-01T12:00:00-03:00", 25),
    achievement("person_reviews_milestone", "2026-06-01T12:00:00-03:00", 100),
    achievement("person_first_meeting_completed", "2026-07-01T12:00:00-03:00"),
    achievement("person_first_creative_delivery_completed", "2026-08-01T12:00:00-03:00"),
  ]);
  ok("8 candidatos elegíveis, mas nunca mais que 6 pontos na saída", points.length === 6);
}

console.log("\n3 — Ordenação cronológica na saída, independente da ordem de entrada ou da prioridade de corte\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_optimizations_milestone", "2026-06-01T12:00:00-03:00", 50),
    achievement("person_first_meeting_completed", "2026-01-01T12:00:00-03:00"),
    achievement("person_reports_milestone", "2026-03-01T12:00:00-03:00", 25),
  ]);
  ok("3 pontos", points.length === 3);
  const dates = points.map((p) => p.occurredAt);
  ok("saída em ordem cronológica crescente", dates[0] < dates[1] && dates[1] < dates[2]);
  ok("o mais antigo (primeira reunião) vem primeiro, mesmo sendo o de menor prioridade editorial", points[0].type === "person_first_meeting_completed");
}

console.log("\n4 — Milestones inferiores nunca poluem quando existe um milestone superior do MESMO tipo\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_optimizations_milestone", "2026-01-01T12:00:00-03:00", 1),
    achievement("person_optimizations_milestone", "2026-05-01T12:00:00-03:00", 50),
    achievement("person_optimizations_milestone", "2026-09-01T12:00:00-03:00", 100),
  ]);
  ok("1, 50 e 100 otimizações no histórico -> só 1 ponto na Trajetória (nunca os 3)", points.length === 1);
  ok("o ponto mantido é o de maior patamar (100), nunca o mais recente por data ou o primeiro", points[0].headline === "100 otimizações registradas");
}

console.log("\n5 — Fontes/tipos diferentes coexistem tranquilamente (nunca um tipo suprime outro tipo)\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_optimizations_milestone", "2026-02-01T12:00:00-03:00", 50),
    achievement("person_reports_milestone", "2026-02-01T12:00:00-03:00", 25), // mesmo dia, tipo diferente
    achievement("person_first_client_within_target", "2026-04-01T12:00:00-03:00"),
  ]);
  ok("3 tipos distintos, 3 pontos (nenhum suprime o outro)", points.length === 3);
}

console.log("\n6 — Ausência de achievements -> trajetória vazia, nunca um ponto fabricado\n");
{
  ok("lista vazia de achievements gera trajetória vazia", curateTeamMemberTrajectory([]).length === 0);
}

console.log("\n7 — Tipos explicitamente excluídos da Trajetória nunca aparecem\n");
{
  const points = curateTeamMemberTrajectory([
    achievement("person_tenure_milestone", "2026-01-01T12:00:00-03:00", 12),
    achievement("person_portfolio_fully_within_target", "2026-02-01T12:00:00-03:00", 3),
  ]);
  ok(
    "person_tenure_milestone (derivado de team_members.created_at) e person_portfolio_fully_within_target (recorrente, não é marco) nunca entram",
    points.length === 0,
  );
}

console.log("\n8 — Nenhuma dependência de team_members.created_at em lugar nenhum do módulo (checagem estrutural)\n");
{
  ok("team-trajectory.ts nunca lê/importa created_at", !/created_at/.test(teamTrajectorySource));
  ok("team-trajectory.ts nunca referencia person_tenure_milestone como tipo elegível (só no comentário/exclusão)", !/byType\.set\("person_tenure_milestone/.test(teamTrajectorySource));
}

console.log("\n9 — Nenhuma nova query/evento/detector de achievement — curadoria é pura sobre dado já carregado\n");
{
  ok("team-trajectory.ts nunca importa Supabase", !/supabase/i.test(teamTrajectorySource));
  ok("team-trajectory.ts nunca importa/chama record_achievement_event", !/record_achievement_event/.test(teamTrajectorySource));
  ok("team-trajectory.ts nunca importa achievement-engine/achievement-metrics (nenhum novo detector)", !/achievement-engine|achievement-metrics/.test(teamTrajectorySource));
  ok(
    "team-trajectory.ts nunca lê client_manager_assignments (omitido nesta etapa — ver comentário do arquivo)",
    !/client_manager_assignments|client-manager-assignments/.test(teamTrajectorySource),
  );
}

console.log('\n10 — "Clientes atendidos" (atividade) nunca é confundido com "clientes sob responsabilidade" (atribuição)\n');
{
  const rows = [
    { actor_team_member_id: "gestor-1", client_id: "cliente-a" },
    { actor_team_member_id: "gestor-1", client_id: "cliente-a" }, // mesma revisão de novo, nunca duplica
    { actor_team_member_id: "gestor-1", client_id: "cliente-b" },
    { actor_team_member_id: "gestor-1", client_id: null }, // sem cliente, nunca conta
    { actor_team_member_id: null, client_id: "cliente-c" }, // sem ator, nunca conta
    { actor_team_member_id: "gestor-2", client_id: "cliente-a" },
  ];
  const byActor = countDistinctClientsByActor(rows);
  ok("gestor-1: 2 clientes distintos atendidos (cliente-a duplicado não conta duas vezes)", byActor.get("gestor-1") === 2);
  ok("gestor-2: 1 cliente distinto (carteira de gestor-1 nunca vaza)", byActor.get("gestor-2") === 1);
  ok(
    "team-performance-data.ts usa account_review_recorded (atividade) pra esta contagem, nunca client_manager_assignments (atribuição)",
    /distinctClientsServedRows[\s\S]{0,20}=[\s\S]{0,400}account_review_recorded/.test(teamPerformanceDataSource) ||
      /event_type", "account_review_recorded"\)[\s\S]{0,400}distinct-clients-served/.test(teamPerformanceDataSource),
  );
  ok(
    'label "Clientes atendidos" nunca é chamado de "clientes gerenciados" na página',
    /Clientes atendidos/.test(teamProfilePageSource) && !/[Cc]lientes gerenciados/.test(teamProfilePageSource),
  );
}

console.log('\n11 — "Meses com carteira avaliável" respeita a Fase 3 e nunca mostra "0 meses" enganoso\n');
{
  ok(
    'seção "Experiência" só renderiza o indicador quando portfolioEvolution.length > 0 (nunca um "0 meses" destacado)',
    /portfolioEvolution\.length > 0 &&[\s\S]{0,80}Meses com carteira avaliável/.test(teamProfilePageSource),
  );
  ok(
    "o valor exibido é exatamente portfolioEvolution.length (mesma fonte de 'Evolução', Fase 3 — nenhum recálculo próprio)",
    /value=\{String\(portfolioEvolution\.length\)\}/.test(teamProfilePageSource),
  );
}

console.log("\n12 — Página reorganizada preserva todas as seções existentes (nenhuma removida silenciosamente)\n");
{
  // Etapa "Equipe — Redesign do Perfil — 6D": "Carteira atual" +
  // "Performance da carteira atual" + "Evolução" (título próprio) +
  // "Histórico de carteira" (título próprio) foram consolidadas em
  // "Carteira & Performance" — mudança de título INTENCIONAL (ver
  // relatório da Etapa 6D), lista atualizada deliberadamente.
  for (const title of ["Trajetória", "Carteira & Performance", "Experiência", "Insígnias", "Conquistas"]) {
    ok(`seção "${title}" presente em app/team/[id]/page.tsx`, teamProfilePageSource.includes(`"${title}"`) || teamProfilePageSource.includes(`title={\`${title}`));
  }
  ok('"Evolução" continua presente como subleitura dentro de Carteira & Performance (não mais título de seção própria)', /Evolução/.test(teamProfilePageSource));
  ok('"Histórico de carteira" continua presente, agora revelável (<details>) dentro de Carteira & Performance', /Histórico de carteira/.test(teamProfilePageSource));
  ok('seção "Histórico" antiga (substituída por "Experiência") não existe mais isolada', !/title="Histórico"/.test(teamProfilePageSource));
}

console.log("\n13 — Nenhuma regressão de escopo: sem ranking/score/XP/bônus/especialização/progressão na Fase 5\n");
{
  const combined = `${teamTrajectorySource}\n${teamProfilePageSource}`;
  ok("nenhuma palavra de score/ranking/XP/nível", !/\bscore\b|\branking\b|\bXP\b|\bn[íi]vel\b/i.test(combined));
  ok("nenhuma palavra de bônus/comissão/prêmio", !/b[oô]nus|comiss[aã]o|pr[eê]mio/i.test(combined));
  ok('nenhuma menção a "especialização" (fora de escopo nesta etapa)', !/especializa[çc][aã]o/i.test(combined));
  ok('nenhuma menção a progressão Júnior/Pleno/Sênior', !/j[úu]nior|pleno|s[êe]nior/i.test(combined));
  ok('nenhum rótulo "Entrou na KOFF"/"Perfil registrado desde" na página do perfil', !/Entrou na KOFF|Perfil registrado desde/i.test(teamProfilePageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
