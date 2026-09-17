import type { AchievementRow } from "@/lib/achievements-data";

/**
 * Etapa "Equipe — Fase 4": seleção de INSÍGNIAS — pura, nunca lê
 * `operational_events` de novo, só reagrupa o que `fetchAchievements` já
 * devolveu (mesma salvaguarda já usada pelo resto do motor de Conquistas:
 * apresentação nunca recalcula o que já foi decidido no cron).
 *
 * Taxonomia (aprovada):
 * - INSÍGNIA = maior patamar já cruzado de um `type` ESCALONÁVEL (o mesmo
 *   `type` produz eventos com `metric.target` crescente ao longo do tempo —
 *   ex.: otimizações 1 → 50 → 100). O perfil mostra só o evento de maior
 *   patamar; nunca os inferiores da mesma progressão.
 * - CONQUISTA = toda ocorrência, sempre na lista cronológica (`achievements`),
 *   independente de virar insígnia ou não.
 *
 * Deliberadamente por `type` (nunca por `family`): a família "performance"
 * (Fase 4) tem 3 `type`s, mas só 1 é uma progressão de patamar
 * (`person_consecutive_months_fully_within_target`) — os outros 2 são
 * "conquista única" (`person_first_client_within_target`) e "conquista
 * recorrente por mês" (`person_portfolio_fully_within_target`), nenhum dos
 * dois uma escada. Usar `family` como chave misturaria progressões que não
 * têm a mesma unidade (ex.: "8 contas avaliáveis este mês" nunca deveria
 * competir com "6 meses consecutivos" pelo mesmo posto de "maior patamar").
 * Pela mesma razão, a família "experiencia" (primeira reunião/primeira
 * entrega de criativo) também nunca vira insígnia — são conquistas únicas,
 * ficam só na lista cronológica.
 */
const ESCALATING_BADGE_TYPES: readonly string[] = [
  "person_consecutive_months_fully_within_target",
  "person_optimizations_milestone",
  "person_reviews_milestone",
  "person_reports_milestone",
  "person_clients_served_milestone",
  "person_tenure_milestone",
];

/**
 * Dentre os eventos de conquista já carregados (`AchievementRow[]`, scope
 * "person"), devolve no máximo 1 por `type` escalonável — o de maior
 * `metric.target` (o patamar mais alto já cruzado). Ordem de saída FIXA
 * (`ESCALATING_BADGE_TYPES`), nunca a ordem de chegada dos dados — garante
 * que a UI sempre renderiza na mesma sequência, independente de qual
 * insígnia foi conquistada por último.
 */
export function selectPersonBadges(achievements: AchievementRow[]): AchievementRow[] {
  const byType = new Map<string, AchievementRow>();
  for (const achievement of achievements) {
    if (!ESCALATING_BADGE_TYPES.includes(achievement.type)) continue;
    const current = byType.get(achievement.type);
    const currentTarget = current?.metric?.target ?? -Infinity;
    const candidateTarget = achievement.metric?.target ?? -Infinity;
    if (!current || candidateTarget > currentTarget) byType.set(achievement.type, achievement);
  }
  return ESCALATING_BADGE_TYPES.map((type) => byType.get(type)).filter((row): row is AchievementRow => row !== undefined);
}
