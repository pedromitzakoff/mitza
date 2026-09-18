import type { AchievementRow } from "@/lib/achievements-data";
import { selectPersonBadges } from "@/lib/achievement-badges";
import {
  PERSON_REVIEWS_MILESTONES,
  PERSON_OPTIMIZATIONS_MILESTONES,
  PERSON_CLIENTS_SERVED_MILESTONES,
  PERSON_REPORTS_MILESTONES,
  PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS,
} from "@/lib/achievement-thresholds";

/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6A":
 * camada PURA que transforma `achievements` (escopo Pessoa) na representação
 * profissional de Insígnia. Nenhuma fonte de verdade nova — tudo lido de
 * `AchievementRow[]` já carregado (mesmo array que já alimenta "Conquistas"
 * e a Trajetória, Fase 5) + dos MESMOS arrays de patamar já existentes em
 * `achievement-thresholds.ts` (nunca duplicados aqui, só reordenados —
 * ver `PROGRESSIVE_LADDERS`).
 *
 *   achievements → selectPersonBadges (Fase 4, preservada) → Insignia[]
 *
 * `selectPersonBadges` continua sendo a única função que decide "qual é o
 * maior patamar já cruzado de cada tipo escalonável" — esta camada nunca
 * reimplementa essa redução, só a estende: filtra `person_tenure_milestone`
 * (decisão desta etapa — `team_members.created_at` não representa
 * contratação formal; os eventos históricos continuam intactos, só saem da
 * PROJEÇÃO visual nova) e adiciona os tipos que `selectPersonBadges` nunca
 * cobriu (únicos e recorrente da família "performance"/"experiencia").
 *
 * Nenhuma UI aqui — nenhum SVG, nenhum componente, nenhuma cor, nenhum
 * rótulo de exibição. Só dado + classificação, testável sem Supabase.
 */

export type InsigniaPrestige = "marco" | "destaque" | "elite";

/**
 * - `progressive`: tipo escalonável (`selectPersonBadges`) — várias
 *   ocorrências ao longo do tempo, cada uma um patamar mais alto da MESMA
 *   escada (ex.: otimizações 1 → 50 → 100 → 250 → 500).
 * - `unique`: ocorre no máximo 1 vez na vida (idempotência do motor via
 *   `windowKey` fixo) — nunca escalona, nunca se repete.
 * - `recurring`: pode ocorrer de novo em janelas diferentes (ex.: um mês
 *   fechado com a carteira inteira dentro da meta), mas NUNCA é uma escada
 *   de patamar — a Insígnia representa sempre a ocorrência MAIS RECENTE,
 *   nunca um acumulado.
 */
export type InsigniaNature = "progressive" | "unique" | "recurring";

export interface InsigniaStage {
  /** 1-indexado — o patamar atual é o Nº `current` de `total` da escada. */
  current: number;
  total: number;
}

export interface InsigniaProgress {
  /** Contagem VIVA (recalculada no momento da leitura, nunca o valor
   * congelado no instante em que o patamar foi cruzado) — só presente
   * quando quem chama fornece um valor real via `InsigniaLiveCounts` E o
   * tipo está na lista de progresso permitido (ver `LIVE_PROGRESS_ALLOWED_TYPES`).
   * Nunca fabricado/estimado. */
  current: number;
  next: number;
}

export interface Insignia {
  /** `type` do `AchievementRow` de origem (ex.: "person_optimizations_milestone"). */
  type: string;
  /** Família crua, mesma chave de `achievement.family`/`PERSON_FAMILY_LABEL`
   * (`lib/achievement-labels.ts`) — nunca redefinida aqui. */
  family: string;
  nature: InsigniaNature;
  /** Classificação editorial/visual — NUNCA pontuação. Mapping explícito por
   * `type` (+ estágio, quando progressivo) — ver `FIXED_PRESTIGE`/
   * `PROGRESSIVE_STAGE_PRESTIGE`, nunca inferido automaticamente de
   * "estágio mais alto = Elite" pra toda família. */
  prestige: InsigniaPrestige;
  /** Só presente pra `nature: "progressive"`, e só quando o patamar do
   * achievement de origem é reconhecível na escada canônica. */
  stage: InsigniaStage | null;
  /** Patamar (`metric.target`) do achievement atual — só pra progressivos
   * com escada reconhecida. */
  milestone: number | null;
  /** Próximo patamar da MESMA escada — `null` quando já é o último estágio
   * OU quando não é progressivo. */
  nextMilestone: number | null;
  /** Ver `InsigniaProgress`. `null` sempre que não houver contagem viva
   * confiável fornecida — nunca uma fração fabricada. */
  progress: InsigniaProgress | null;
  /** Mesma data do `achievement` de origem — conveniência (evita quem
   * consome ter que sempre descer até `achievement.occurredAt`). */
  occurredAt: string;
  /** A "evidência" pedida na auditoria — o `AchievementRow` de origem
   * completo, nunca reconstruído: quem consome decide que texto/detalhe
   * mostrar a partir daqui, esta camada não escreve nenhum headline novo. */
  achievement: AchievementRow;
}

/**
 * Escadas canônicas por tipo progressivo — SEMPRE os mesmos arrays de
 * `achievement-thresholds.ts` (nunca duplicados aqui). As constantes de
 * origem são DESCENDENTES (pensadas pra `highestMilestoneCrossed`, que
 * procura o maior patamar já cruzado); a Insígnia pensa em "estágio 1 = o
 * mais simples", então só reordena (`.reverse()`) pra uso interno — a fonte
 * numérica continua sendo uma só.
 *
 * `person_tenure_milestone` deliberadamente NUNCA aparece aqui (nem em
 * nenhuma outra lista deste arquivo) — excluído da projeção visual nova por
 * decisão desta etapa (ver comentário do topo do arquivo).
 */
const PROGRESSIVE_LADDERS: Record<string, readonly number[]> = {
  person_optimizations_milestone: [...PERSON_OPTIMIZATIONS_MILESTONES].reverse(),
  person_reviews_milestone: [...PERSON_REVIEWS_MILESTONES].reverse(),
  person_clients_served_milestone: [...PERSON_CLIENTS_SERVED_MILESTONES].reverse(),
  person_reports_milestone: [...PERSON_REPORTS_MILESTONES].reverse(),
  person_consecutive_months_fully_within_target: [...PERSON_CONSECUTIVE_MONTHS_FULLY_WITHIN_TARGET_THRESHOLDS].reverse(),
};

/**
 * Prestígio EXPLÍCITO por estágio (índice 0 = estágio 1) — mapping
 * editorial, nunca inferido ("último estágio = Elite" NÃO é uma regra
 * automática; cada família define seus próprios cortes). Tamanho de cada
 * array precisa bater com `PROGRESSIVE_LADDERS[type].length` (garantido por
 * teste — `scripts/test-achievement-insignia.ts`).
 *
 * Critério usado (documentado, não arbitrário): os 2-3 primeiros patamares
 * de cada escada são volume/experiência inicial ("marco"); o penúltimo
 * patamar já é um volume incomum ("destaque"); só o ÚLTIMO patamar de cada
 * escada operacional (500 otimizações/revisões, 100 reports, 50 clientes
 * atendidos) vira "elite". Consistência (3/6 meses de carteira inteira
 * dentro da meta) já nasce mais exigente — os dois patamares que existem
 * são "destaque"/"elite", nunca "marco" (não existe um patamar trivial
 * nesta família).
 */
const PROGRESSIVE_STAGE_PRESTIGE: Record<string, readonly InsigniaPrestige[]> = {
  person_optimizations_milestone: ["marco", "marco", "marco", "destaque", "elite"],
  person_reviews_milestone: ["marco", "marco", "marco", "destaque", "elite"],
  person_clients_served_milestone: ["marco", "marco", "destaque", "elite"],
  person_reports_milestone: ["marco", "marco", "destaque", "elite"],
  person_consecutive_months_fully_within_target: ["destaque", "elite"],
};

/**
 * Prestígio FIXO pros tipos que não são progressivos (não têm "estágio").
 * `person_first_meeting_completed`/`person_first_creative_delivery_completed`
 * são marcos de onboarding operacional — sempre "marco". Os dois tipos da
 * família "performance" fora da escada de consistência já são prova real de
 * qualidade de entrega (não só volume) — "destaque" nos dois: uma conta
 * dentro da meta pela primeira vez, ou um mês inteiro de carteira dentro da
 * meta, são feitos de qualidade — mas nenhum dos dois sozinho tem a
 * exigência prolongada que justificaria "elite" (essa fica reservada pra
 * `person_consecutive_months_fully_within_target` no patamar mais alto).
 */
const FIXED_PRESTIGE: Record<string, InsigniaPrestige> = {
  person_first_meeting_completed: "marco",
  person_first_creative_delivery_completed: "marco",
  person_first_client_within_target: "destaque",
  person_portfolio_fully_within_target: "destaque",
};

const NATURE_BY_TYPE: Record<string, InsigniaNature> = {
  person_reviews_milestone: "progressive",
  person_optimizations_milestone: "progressive",
  person_clients_served_milestone: "progressive",
  person_reports_milestone: "progressive",
  person_consecutive_months_fully_within_target: "progressive",
  person_first_meeting_completed: "unique",
  person_first_creative_delivery_completed: "unique",
  person_first_client_within_target: "unique",
  person_portfolio_fully_within_target: "recurring",
};

/** Tipos não-escalonáveis elegíveis pra Insígnia — `selectPersonBadges`
 * nunca os cobre (só conhece os 6 `ESCALATING_BADGE_TYPES`), por isso
 * `buildInsigniaCollection` os busca separadamente, sempre pela ocorrência
 * MAIS RECENTE de cada tipo (única regra pros dois casos: `unique` tem no
 * máximo 1 ocorrência por construção do motor, então "mais recente" é um
 * no-op seguro; `recurring` pode ter várias, e a Insígnia deve representar
 * sempre o estado mais atual, nunca um acumulado). */
const NON_ESCALATING_ELIGIBLE_TYPES: readonly string[] = [
  "person_first_meeting_completed",
  "person_first_creative_delivery_completed",
  "person_first_client_within_target",
  "person_portfolio_fully_within_target",
];

/**
 * Tipos com progresso ao vivo PERMITIDO nesta etapa — consistência,
 * performance (únicos/recorrente) e tempo de casa NUNCA entram aqui, mesmo
 * que `liveCounts` receba um valor pra eles por engano: a trava é desta
 * camada, não depende de disciplina de quem chama. "Revisões" está na
 * lista (permitida quando a contagem viva existir) — hoje nenhum chamador
 * real fornece esse valor ainda (não wired nesta etapa, só lógica), então
 * `progress` continua `null` pra revisões até essa contagem existir de
 * fato, sem esta camada precisar saber o motivo.
 */
const LIVE_PROGRESS_ALLOWED_TYPES: readonly string[] = [
  "person_optimizations_milestone",
  "person_reports_milestone",
  "person_clients_served_milestone",
  "person_reviews_milestone",
];

/** Contagens vivas opcionais, por `type` — só usadas pros 4 tipos de
 * `LIVE_PROGRESS_ALLOWED_TYPES`. `undefined`/campo ausente = sem contagem
 * viva disponível pra esse tipo agora (nunca fabricado). */
export interface InsigniaLiveCounts {
  person_optimizations_milestone?: number;
  person_reports_milestone?: number;
  person_clients_served_milestone?: number;
  person_reviews_milestone?: number;
}

function resolveStageIndex(achievement: AchievementRow): number | null {
  const ladder = PROGRESSIVE_LADDERS[achievement.type];
  const target = achievement.metric?.target;
  if (!ladder || target === null || target === undefined) return null;
  const index = ladder.indexOf(target);
  return index === -1 ? null : index;
}

function resolveStage(achievement: AchievementRow): { stage: InsigniaStage | null; milestone: number | null; nextMilestone: number | null } {
  const ladder = PROGRESSIVE_LADDERS[achievement.type];
  if (!ladder) return { stage: null, milestone: null, nextMilestone: null };

  const index = resolveStageIndex(achievement);
  if (index === null) return { stage: null, milestone: null, nextMilestone: null };

  return {
    stage: { current: index + 1, total: ladder.length },
    milestone: ladder[index],
    nextMilestone: ladder[index + 1] ?? null,
  };
}

function resolvePrestige(achievement: AchievementRow): InsigniaPrestige {
  const fixed = FIXED_PRESTIGE[achievement.type];
  if (fixed) return fixed;

  const ladder = PROGRESSIVE_STAGE_PRESTIGE[achievement.type];
  const stageIndex = resolveStageIndex(achievement);
  if (ladder && stageIndex !== null && ladder[stageIndex]) return ladder[stageIndex];

  // Defensivo — nunca deveria ocorrer: todo `type` que chega até aqui já
  // passou pelo filtro de `NATURE_BY_TYPE` (que só conhece tipos com
  // prestígio explícito mapeado acima).
  return "marco";
}

function resolveProgress(type: string, nextMilestone: number | null, liveCounts: InsigniaLiveCounts): InsigniaProgress | null {
  if (nextMilestone === null) return null;
  if (!LIVE_PROGRESS_ALLOWED_TYPES.includes(type)) return null;

  const current = liveCounts[type as keyof InsigniaLiveCounts];
  if (current === undefined) return null;

  return { current, next: nextMilestone };
}

function toInsignia(achievement: AchievementRow, liveCounts: InsigniaLiveCounts): Insignia {
  const nature = NATURE_BY_TYPE[achievement.type];
  const { stage, milestone, nextMilestone } = resolveStage(achievement);

  return {
    type: achievement.type,
    family: achievement.family,
    nature,
    prestige: resolvePrestige(achievement),
    stage,
    milestone,
    nextMilestone,
    progress: resolveProgress(achievement.type, nextMilestone, liveCounts),
    occurredAt: achievement.occurredAt,
    achievement,
  };
}

function mostRecentByType(achievements: AchievementRow[], type: string): AchievementRow | null {
  let latest: AchievementRow | null = null;
  for (const achievement of achievements) {
    if (achievement.type !== type) continue;
    if (!latest || achievement.occurredAt > latest.occurredAt) latest = achievement;
  }
  return latest;
}

/**
 * Constrói a coleção de Insígnias — consolidação garantida por construção:
 * cada tipo escalonável entra no máximo 1 vez (via `selectPersonBadges`,
 * o maior patamar já cruzado — nunca as 3 conquistas de 1/50/100
 * simultaneamente), e cada tipo não-escalonável entra no máximo 1 vez (a
 * ocorrência mais recente). `person_tenure_milestone` nunca aparece no
 * resultado. Ordem determinística e estável: primeiro os progressivos (na
 * mesma ordem de `ESCALATING_BADGE_TYPES`, menos tempo de casa), depois os
 * não-escalonáveis (ordem fixa de `NON_ESCALATING_ELIGIBLE_TYPES`) — nunca
 * por data, quem consome decide como reordenar pra exibição.
 */
export function buildInsigniaCollection(achievements: AchievementRow[], liveCounts: InsigniaLiveCounts = {}): Insignia[] {
  const insignias: Insignia[] = [];

  for (const achievement of selectPersonBadges(achievements)) {
    if (achievement.type === "person_tenure_milestone") continue;
    insignias.push(toInsignia(achievement, liveCounts));
  }

  for (const type of NON_ESCALATING_ELIGIBLE_TYPES) {
    const achievement = mostRecentByType(achievements, type);
    if (achievement) insignias.push(toInsignia(achievement, liveCounts));
  }

  return insignias;
}

const PRESTIGE_RANK: Record<InsigniaPrestige, number> = { elite: 0, destaque: 1, marco: 2 };

/**
 * Seleção determinística de até `max` Insígnias em destaque — regra
 * explicável em 3 passos, nunca score oculto:
 *   1. No máximo 1 por família (`achievement.family`) — dentro de uma
 *      família com mais de uma Insígnia elegível (ex.: "performance" pode
 *      ter até 3: conta na meta, carteira na meta, consistência), fica só
 *      a de maior prestígio; empate de prestígio desempata pela conquista
 *      mais recente.
 *   2. Ordena o que sobrou por prestígio (elite > destaque > marco).
 *   3. Desempate final por data mais recente.
 * Corta em `max` (padrão 3) — nunca preenche artificialmente quando há
 * menos elegíveis: `slice` simplesmente devolve o que existir.
 */
export function selectFeaturedInsignias(insignias: Insignia[], max = 3): Insignia[] {
  const bestByFamily = new Map<string, Insignia>();

  for (const insignia of insignias) {
    const current = bestByFamily.get(insignia.family);
    if (!current) {
      bestByFamily.set(insignia.family, insignia);
      continue;
    }
    const currentRank = PRESTIGE_RANK[current.prestige];
    const candidateRank = PRESTIGE_RANK[insignia.prestige];
    if (candidateRank < currentRank || (candidateRank === currentRank && insignia.occurredAt > current.occurredAt)) {
      bestByFamily.set(insignia.family, insignia);
    }
  }

  return Array.from(bestByFamily.values())
    .sort((a, b) => {
      const rankDiff = PRESTIGE_RANK[a.prestige] - PRESTIGE_RANK[b.prestige];
      if (rankDiff !== 0) return rankDiff;
      return b.occurredAt.localeCompare(a.occurredAt);
    })
    .slice(0, max);
}

/**
 * Até `max` "próximos marcos" — só considera Insígnias `nature: "progressive"`
 * com `nextMilestone` disponível. Isso já garante "só famílias com atividade
 * real > 0" por construção: uma Insígnia só existe quando pelo menos o
 * primeiro patamar da escada já foi cruzado (nunca uma família zerada
 * aparece aqui) — nenhuma checagem de atividade extra é necessária.
 *
 * Consistência (`person_consecutive_months_fully_within_target`) É
 * progressiva e PODE aparecer aqui (ex.: "próximo patamar: 6 meses") — o
 * pedido de "consistência/performance nunca mostrar fração" é garantido em
 * outro lugar: `progress` fica sempre `null` pra ela (fora de
 * `LIVE_PROGRESS_ALLOWED_TYPES`), então o item chega à UI futura só com
 * `nextMilestone`, nunca com uma fração fabricada. Performance
 * (`person_first_client_within_target`/`person_portfolio_fully_within_target`)
 * nunca aparece aqui — `nature` delas é `unique`/`recurring`, não
 * `progressive`, então nunca têm `nextMilestone`.
 *
 * Ordenação: famílias com progresso vivo disponível vêm primeiro (mais
 * informativas), pelo menor "quanto falta"; o resto vem depois, ordenado
 * pelo próximo patamar.
 */
export function selectUpcomingMilestones(insignias: Insignia[], max = 3): Insignia[] {
  const candidates = insignias.filter((insignia) => insignia.nature === "progressive" && insignia.nextMilestone !== null);

  const sorted = [...candidates].sort((a, b) => {
    if (a.progress && b.progress) {
      const gapA = a.progress.next - a.progress.current;
      const gapB = b.progress.next - b.progress.current;
      return gapA - gapB;
    }
    if (a.progress && !b.progress) return -1;
    if (!a.progress && b.progress) return 1;
    return (a.nextMilestone ?? 0) - (b.nextMilestone ?? 0);
  });

  return sorted.slice(0, max);
}
