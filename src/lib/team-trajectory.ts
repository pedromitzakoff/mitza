import type { AchievementRow } from "@/lib/achievements-data";

/**
 * Etapa "Equipe — Fase 5: Trajetória e Experiência Profissional" —
 * curadoria PURA sobre conquistas já carregadas (`scope: "person"`, mesma
 * fonte de sempre — `fetchAchievements`). Nunca uma nova fonte de eventos,
 * nunca um detector novo, nunca uma tabela nova: a Trajetória responde
 * "quais foram os principais marcos profissionais desta pessoa?", nunca
 * "tudo que essa pessoa já fez" (isso já existe, é a seção "Conquistas").
 *
 * `client_manager_assignments` foi deliberadamente DEIXADO DE FORA desta
 * curadoria (auditoria da etapa, ponto "Primeiro cliente sob
 * responsabilidade"): o backfill da Fase 2 dá a TODO gestor que já tinha
 * carteira, no instante do deploy, um período aberto com `started_at` =
 * esse mesmo instante — indistinguível, só pelos dados, de um marco real de
 * início de carreira. Não existe hoje nenhuma coluna que sinalize "este
 * período vem de backfill" vs. "este período é uma atribuição real", e
 * inventar essa distinção (ex.: comparar com uma data de deploy fixa no
 * código) seria exatamente o tipo de reconstrução que esta fase pediu pra
 * evitar. Seguindo a instrução explícita do pedido ("se essa semântica
 * ficar estranha ou enganosa, prefira omitir esse ponto"), "Primeira
 * responsabilidade de carteira" fica de fora da V1 — pode ser reavaliado
 * quando existir um sinal confiável de distinguir as duas origens.
 *
 * `person_tenure_milestone` também nunca entra aqui — deriva de
 * `team_members.created_at` (data de registro no sistema, não de
 * contratação; ver auditoria da etapa) e o pedido foi explícito: nenhuma
 * informação derivada desse campo aparece em lugar nenhum da Fase 5.
 *
 * `person_portfolio_fully_within_target` (conquista RECORRENTE — "mês
 * fechado com toda a carteira avaliável dentro da meta", pode acontecer em
 * vários meses diferentes) também fica fora: é sinal de bom desempenho
 * corrente, não um MARCO de trajetória — a família "consistência"
 * (`person_consecutive_months_fully_within_target`, que é uma escada de
 * patamar único) já representa essa história sem o ruído de repetir "mais
 * um mês bom" a cada ciclo.
 */

export interface TrajectoryPoint {
  type: string;
  occurredAt: string;
  headline: string;
}

/** Tipos ESCALONÁVEIS elegíveis pra Trajetória — mesmo espírito de
 * `ESCALATING_BADGE_TYPES` (`lib/achievement-badges.ts`), só que sem
 * `person_tenure_milestone` (ver comentário do topo). Só o maior patamar já
 * cruzado de cada tipo entra na curadoria — exatamente a garantia pedida:
 * ter 1, 50 E 100 otimizações nunca aparece como 3 pontos, só o mais alto. */
const ESCALATING_TRAJECTORY_TYPES: readonly string[] = [
  "person_reviews_milestone",
  "person_optimizations_milestone",
  "person_clients_served_milestone",
  "person_reports_milestone",
  "person_consecutive_months_fully_within_target",
];

/** Tipos de ocorrência ÚNICA — cada um existe no máximo 1 vez por pessoa
 * (idempotência do motor via `windowKey` fixo), sempre elegíveis quando
 * presentes. */
const ONE_TIME_TRAJECTORY_TYPES: readonly string[] = [
  "person_first_meeting_completed",
  "person_first_creative_delivery_completed",
  "person_first_client_within_target",
];

/**
 * Prioridade EDITORIAL fixa (nunca um score numérico) usada só quando há
 * mais candidatos elegíveis do que `MAX_TRAJECTORY_POINTS` — mesmo padrão
 * de lista ordenada fixa já usado em `ESCALATING_BADGE_TYPES`/`BADGE_LABELS`
 * (`lib/achievement-badges.ts`, `app/team/[id]/page.tsx`). Marcos de
 * performance/consistência (mais diretamente ligados ao resultado
 * profissional) vêm antes de marcos de volume de atividade, que vêm antes
 * de "primeiras vezes" operacionais (reunião/entrega de criativo) — esses
 * últimos são os mais prováveis de já estar implícitos numa trajetória mais
 * longa (quem tem 100 otimizações certamente já teve sua primeira reunião).
 */
const TRAJECTORY_TYPE_PRIORITY: readonly string[] = [
  "person_first_client_within_target",
  "person_consecutive_months_fully_within_target",
  "person_clients_served_milestone",
  "person_optimizations_milestone",
  "person_reports_milestone",
  "person_reviews_milestone",
  "person_first_meeting_completed",
  "person_first_creative_delivery_completed",
];

const MAX_TRAJECTORY_POINTS = 6;

/** Headline compacto e IMPESSOAL (sem o nome da pessoa — a página já está
 * no perfil dela) por `type` — mesmo espírito de `formatBadgeValue`
 * (`app/team/[id]/page.tsx`): nunca reaproveita `achievement.headline`
 * bruto (escrito pro feed de Conquistas compartilhado, sempre com nome —
 * ex.: "Fulano já enviou 100 reports"), sempre reconstrói a partir de
 * `type` + `metric.target`, os mesmos campos que já sustentam a conquista,
 * nenhum recálculo. */
function buildTrajectoryHeadline(achievement: AchievementRow): string {
  const target = achievement.metric?.target;

  switch (achievement.type) {
    case "person_reviews_milestone":
      return target === 1 ? "Primeira revisão registrada" : `${target} revisões registradas`;
    case "person_optimizations_milestone":
      return target === 1 ? "Primeira otimização registrada" : `${target} otimizações registradas`;
    case "person_clients_served_milestone":
      return target === 1 ? "Primeiro cliente atendido" : `${target} clientes atendidos`;
    case "person_reports_milestone":
      return target === 1 ? "Primeiro report enviado" : `${target} reports enviados`;
    case "person_consecutive_months_fully_within_target":
      return `${target} meses de consistência`;
    case "person_first_meeting_completed":
      return "Primeira reunião concluída";
    case "person_first_creative_delivery_completed":
      return "Primeira entrega de criativo concluída";
    case "person_first_client_within_target":
      return "Primeira conta dentro da meta";
    default:
      // Defensivo — nunca deveria ocorrer, dado que só tipos das duas listas
      // acima chegam a esta função (ver `curateTeamMemberTrajectory`).
      return achievement.headline;
  }
}

/**
 * Curadoria pura da Trajetória — recebe as conquistas de escopo Pessoa já
 * carregadas (mesma lista que já alimenta "Conquistas"/"Insígnias") e
 * devolve no máximo `MAX_TRAJECTORY_POINTS`, em ordem CRONOLÓGICA.
 *
 * Passo 1 — reduz cada tipo escalonável ao maior patamar já cruzado (nunca
 * os inferiores da mesma progressão); tipos de ocorrência única entram
 * como estão (no máximo 1 cada, por construção do motor).
 * Passo 2 — se ainda houver mais candidatos do que o teto, corta pela
 * prioridade editorial fixa (`TRAJECTORY_TYPE_PRIORITY`), nunca por data.
 * Passo 3 — ordena o que sobrou cronologicamente pra exibição.
 */
export function curateTeamMemberTrajectory(achievements: AchievementRow[]): TrajectoryPoint[] {
  const byType = new Map<string, AchievementRow>();

  for (const achievement of achievements) {
    if (ESCALATING_TRAJECTORY_TYPES.includes(achievement.type)) {
      const current = byType.get(achievement.type);
      const currentTarget = current?.metric?.target ?? -Infinity;
      const candidateTarget = achievement.metric?.target ?? -Infinity;
      if (!current || candidateTarget > currentTarget) byType.set(achievement.type, achievement);
    } else if (ONE_TIME_TRAJECTORY_TYPES.includes(achievement.type)) {
      if (!byType.has(achievement.type)) byType.set(achievement.type, achievement);
    }
    // Qualquer outro tipo (person_tenure_milestone, person_portfolio_fully_within_target,
    // ou qualquer tipo futuro não listado acima) nunca entra na Trajetória — ver
    // comentário no topo do arquivo.
  }

  const prioritized = TRAJECTORY_TYPE_PRIORITY.map((type) => byType.get(type))
    .filter((row): row is AchievementRow => row !== undefined)
    .slice(0, MAX_TRAJECTORY_POINTS);

  return prioritized
    .map((row) => ({ type: row.type, occurredAt: row.occurredAt, headline: buildTrajectoryHeadline(row) }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
