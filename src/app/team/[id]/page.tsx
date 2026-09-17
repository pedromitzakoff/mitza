import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel, formatRelativeShortDateTime, formatDateFromInstant } from "@/lib/format";
import { loadTeamMemberProfiles, loadManagerAssignmentHistory, type TeamMemberPortfolioClient, type ManagerAssignmentHistoryEntry } from "@/lib/team-performance-data";
import {
  loadManagerPortfolioEvolution,
  describePortfolioUnavailableReason,
  type PortfolioClientEvaluation,
  type ManagerPortfolioEvolutionPoint,
} from "@/lib/team-portfolio-performance";
import { selectPersonBadges } from "@/lib/achievement-badges";
import type { AchievementRow } from "@/lib/achievements-data";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { IconButton, Button } from "@/components/workspace/button";
import { SectionHeader } from "@/components/workspace/section-header";
import { OperationMetric } from "@/app/operation-metric";

/**
 * `/team/[id]` — Perfil Profissional (Equipe, Fase 1). "Career profile", não
 * "employee dashboard": carteira ATUAL, quanto essa carteira investiu no
 * período, performance da carteira ATUAL relativa à PRÓPRIA meta de cada
 * cliente, atuação registrada (otimizações/reports/reuniões — essa sim
 * atribuível ao gestor, ator+timestamp reais) e conquistas pessoais já
 * atribuíveis com segurança. Sem score/nota/ranking/nível/bônus — ver
 * auditoria completa em `lib/team-performance-data.ts`.
 *
 * Etapa "Revisão semântica — atribuição de investimento/performance": sem
 * assignment history completo (auditoria original), nenhum texto aqui pode
 * sugerir que o gestor foi responsável pelo investimento/performance do
 * PERÍODO só porque `primary_manager_id` aponta pra ele HOJE — "carteira
 * atual" e "investimento da carteira atual" (nunca "gerenciado"/"gerenciou")
 * deixam claro que é uma leitura do PRESENTE, não uma atribuição retroativa.
 *
 * Reaproveita `loadTeamMemberProfiles` (a MESMA função da lista `/team`) —
 * nenhuma segunda implementação de cálculo só porque é 1 pessoa em vez de
 * todas.
 */
export default async function TeamMemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const { id } = await params;
  const searchParamsResolved = await searchParams;
  const today = todayUTC();
  const currentRange = currentMonthRange(today);
  const monthParam =
    searchParamsResolved.month && /^\d{4}-\d{2}-01$/.test(searchParamsResolved.month) ? searchParamsResolved.month : currentRange.firstDay;
  const monthLabel = formatMonthLabel(monthParam);
  const isCurrentMonth = monthParam === currentRange.firstDay;

  const supabase = await createSupabaseClient();
  const [profiles, assignmentHistory, portfolioEvolution] = await Promise.all([
    loadTeamMemberProfiles(supabase, profile.organizationId, monthParam),
    loadManagerAssignmentHistory(supabase, id),
    loadManagerPortfolioEvolution(supabase, id, currentRange.firstDay),
  ]);
  const member = profiles.find((p) => p.teamMemberId === id);
  if (!member) notFound();

  const buildMonthHref = (nextMonth: string) => (nextMonth === currentRange.firstDay ? `/team/${id}` : `/team/${id}?month=${nextMonth}`);
  const now = new Date();

  const { portfolio, portfolioPerformance, activityInPeriod, activityAllTime, achievements } = member;
  const badges = selectPersonBadges(achievements);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/team" className="inline-flex items-center gap-1.5 text-xs font-medium text-overview-text-muted hover:text-overview-text-secondary">
        &larr; Equipe
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <ClientAvatar name={member.name} imageUrl={member.avatarUrl} size="lg" />
          <div>
            <h1 className="text-xl font-semibold text-overview-text-primary">{member.name}</h1>
            <p className="mt-0.5 text-sm text-overview-text-secondary">
              {member.jobTitle ?? "Sem cargo definido"} · {member.status === "ativo" ? "Ativo" : "Inativo"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton href={buildMonthHref(shiftMonthParam({ firstDay: monthParam }, -1))} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[8rem] text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={buildMonthHref(shiftMonthParam({ firstDay: monthParam }, 1))} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
          {!isCurrentMonth && (
            <Button href={`/team/${id}`} variant="ghost" size="sm" className="ml-0.5">
              Mês atual
            </Button>
          )}
        </div>
      </div>

      {/* CARTEIRA ATUAL — fato do estado atual (`primary_manager_id`), nunca
          um total histórico (auditoria: não existe histórico de troca de
          gestor confiável no schema). */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Carteira atual" accent />
        <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3">
          <OperationMetric label="Clientes" value={String(portfolio.clientCount)} />
          <OperationMetric label={`Investimento da carteira atual em ${monthLabel.toLowerCase()}`} value={formatCurrency(portfolio.investmentActual)} />
        </div>

        {portfolio.clients.length > 0 ? (
          <div className="mt-4 flex flex-col divide-y divide-overview-border">
            {portfolio.clients.map((client) => (
              <PortfolioClientRow key={client.clientId} client={client} today={now} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-overview-text-secondary">Nenhum cliente atribuído atualmente.</p>
        )}
      </div>

      {/* PERFORMANCE DA CARTEIRA ATUAL — Etapa "Equipe — Fase 3": cada
          cliente comparado contra a PRÓPRIA meta, nunca volume/investimento
          absoluto (princípio central aprovado). Reaproveita
          `evaluation.dimensions.cost` (Motor de Saúde) já calculado por
          `loadClientOperationalStates` — nenhum cálculo novo, só a
          classificação do motivo quando não avaliável (ver
          `lib/team-portfolio-performance.ts`). "Seguidores" fica fora da
          avaliação nesta fase (decisão explícita — o pipeline hoje mistura
          investimento de todos os canais no denominador do custo por
          seguidor, mesmo quando só Meta Ads deveria contar). */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Performance da carteira atual" />
        <div className="mt-3 grid grid-cols-3 gap-x-10 gap-y-5">
          <OperationMetric label="Contas avaliáveis" value={String(portfolioPerformance.evaluableCount)} />
          <OperationMetric label="Dentro da meta" value={String(portfolioPerformance.withinTargetCount)} />
          <OperationMetric label="Fora da meta" value={String(portfolioPerformance.outsideTargetCount)} />
        </div>
        {portfolioPerformance.unavailableCount > 0 && (
          <p className="mt-2 text-[13px] text-overview-text-muted">
            {portfolioPerformance.unavailableCount} conta{portfolioPerformance.unavailableCount !== 1 ? "s" : ""} sem avaliação confiável — não
            contam nem a favor nem contra.
          </p>
        )}

        {portfolioPerformance.clients.length > 0 ? (
          <div className="mt-4 flex flex-col divide-y divide-overview-border">
            {portfolioPerformance.clients.map((client) => (
              <PortfolioPerformanceRow key={client.clientId} client={client} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-overview-text-secondary">Nenhum cliente atribuído atualmente.</p>
        )}
      </div>

      {/* EVOLUÇÃO — Etapa "Equipe — Fase 3": só meses com responsabilidade
          INTEIRA (nunca parcial) sobre pelo menos 1 cliente entram aqui (ver
          `periodCoversFullMonth`, `lib/team-portfolio-performance.ts`).
          Como `client_manager_assignments` só existe a partir do deploy da
          Fase 2, é esperado que esta seção comece vazia (o primeiro mês
          potencialmente elegível é o seguinte ao deploy) — a seção some
          inteira nesse caso, nunca mostra um "0/0" ou um mês fabricado. */}
      {portfolioEvolution.length > 0 && (
        <div className="mt-8 border-t border-overview-border pt-4">
          <SectionHeader title="Evolução" />
          <div className="mt-3 flex flex-col divide-y divide-overview-border">
            {portfolioEvolution.map((point) => (
              <EvolutionRow key={point.monthParam} point={point} />
            ))}
          </div>
        </div>
      )}

      {/* ATUAÇÃO NO MÊS — sempre por ATOR (quem de fato registrou a ação),
          nunca por gestor atual do cliente; cada evento é 1:1 com uma ação
          real (ver auditoria — otimizações somam account_optimization_recorded,
          nunca account_review_recorded no mesmo total, pra não contar a
          mesma análise duas vezes). */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title={`Atuação em ${monthLabel.toLowerCase()}`} />
        <div className="mt-3 grid grid-cols-3 gap-x-10 gap-y-5">
          <OperationMetric label="Otimizações" value={String(activityInPeriod.optimizations)} />
          <OperationMetric label="Reports enviados" value={String(activityInPeriod.reportsSent)} />
          <OperationMetric label="Reuniões" value={String(activityInPeriod.meetings)} />
        </div>
      </div>

      {/* HISTÓRICO — só o que é seguro historicamente (eventos com ator +
          data reais, tabela append-only). Deliberadamente SEM nenhum total
          de investimento: não existe histórico de troca de gestor
          confiável pra provar que os clientes da carteira ATUAL também
          eram dele em períodos passados. */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Histórico" />
        <div className="mt-3 grid grid-cols-3 gap-x-10 gap-y-5">
          <OperationMetric label="Otimizações" value={String(activityAllTime.optimizations)} />
          <OperationMetric label="Reports enviados" value={String(activityAllTime.reportsSent)} />
          <OperationMetric label="Reuniões" value={String(activityAllTime.meetings)} />
        </div>
        <p className="mt-3 text-[12px] text-overview-text-muted">
          Nenhum valor de investimento de períodos anteriores é mostrado aqui — não há como comprovar, com segurança, que os clientes da carteira
          atual já estavam sob esta gestão nesses períodos.
        </p>
      </div>

      {/* HISTÓRICO DE CARTEIRA — Etapa "Equipe — Fase 2": fonte é
          `client_manager_assignments` (via `loadManagerAssignmentHistory`),
          nunca reconstruída/inventada — todo período aqui é real a partir
          do deploy dessa etapa; nada antes disso aparece, porque nada antes
          disso existe com confiança (ver auditoria em
          `supabase/client-manager-assignments.sql`). Cada linha é um fato
          (cliente, início, fim/"atual"), nunca um agregado/score. */}
      {assignmentHistory.length > 0 && (
        <div className="mt-8 border-t border-overview-border pt-4">
          <SectionHeader title="Histórico de carteira" />
          <div className="mt-3 flex flex-col divide-y divide-overview-border">
            {assignmentHistory.map((entry) => (
              <AssignmentHistoryRow key={`${entry.clientId}-${entry.startedAt}`} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* INSÍGNIAS — Etapa "Equipe — Fase 4": maior patamar já cruzado por
          `type` escalonável (`selectPersonBadges`, `lib/achievement-badges.ts`),
          nunca um evento novo — reagrupamento puro sobre as mesmas
          conquistas já carregadas abaixo. Credencial editorial (borda +
          tipografia + acento verde-limão), nunca medalha/estrela/XP. */}
      {badges.length > 0 && (
        <div className="mt-8 border-t border-overview-border pt-4">
          <SectionHeader title="Insígnias" />
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <BadgeCredential key={badge.type} achievement={badge} />
            ))}
          </div>
        </div>
      )}

      {/* CONQUISTAS — só escopo Pessoa (ator real, gravado no momento da
          conquista). Conquistas de escopo Cliente nunca aparecem aqui (sem
          ator gravado — ver auditoria). Sem tokens/medalhas nesta fase. */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Conquistas" />
        {achievements.length > 0 ? (
          <div className="mt-3 flex flex-col divide-y divide-overview-border">
            {achievements.map((achievement) => (
              <div key={achievement.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-overview-text-primary">{achievement.headline}</p>
                  <span className="shrink-0 text-[12px] text-overview-text-muted">{formatRelativeShortDateTime(achievement.occurredAt, now)}</span>
                </div>
                {achievement.detail && <p className="mt-0.5 text-[13px] text-overview-text-secondary">{achievement.detail}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-overview-text-secondary">Nenhuma conquista registrada ainda.</p>
        )}
      </div>
    </div>
  );
}

function PortfolioClientRow({ client, today }: { client: TeamMemberPortfolioClient; today: Date }) {
  const goalLabel = client.performanceGoal === "leads" ? "Leads" : client.performanceGoal === "sales" ? "Vendas" : client.performanceGoal === "followers" ? "Seguidores" : null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <div>
        <p className="text-sm font-medium text-overview-text-primary">{client.clientName}</p>
        <p className="mt-0.5 text-[13px] text-overview-text-secondary">
          {goalLabel ?? "Objetivo não configurado"} · {client.channelsLabel}
        </p>
        {client.assignedWithinPeriodAt && (
          <p className="mt-0.5 text-[12px] text-overview-text-muted">Assumiu esta conta em {formatRelativeShortDateTime(client.assignedWithinPeriodAt, today)}</p>
        )}
      </div>
      <p className="text-[13px] text-overview-text-secondary tabular-nums">
        {client.costComparable && client.costActual !== null && client.costTarget !== null
          ? `${client.costMetricShortLabel} ${formatCurrency(client.costActual)} · Meta ${formatCurrency(client.costTarget)}`
          : "Sem meta de custo comparável"}
      </p>
    </div>
  );
}

function AssignmentHistoryRow({ entry }: { entry: ManagerAssignmentHistoryEntry }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <p className="text-sm font-medium text-overview-text-primary">{entry.clientName}</p>
      <p className="text-[13px] text-overview-text-secondary tabular-nums">
        {formatDateFromInstant(entry.startedAt)} &rarr; {entry.endedAt ? formatDateFromInstant(entry.endedAt) : "atual"}
      </p>
    </div>
  );
}

/** Rótulo curto por `type` de insígnia — único lugar que decide isso (nunca
 * reimplementado por card). Todo `type` de `ESCALATING_BADGE_TYPES`
 * (`lib/achievement-badges.ts`) precisa de uma entrada aqui. */
const BADGE_LABELS: Record<string, string> = {
  person_consecutive_months_fully_within_target: "Consistência",
  person_optimizations_milestone: "Otimizações",
  person_reviews_milestone: "Revisões",
  person_reports_milestone: "Reports",
  person_clients_served_milestone: "Clientes atendidos",
  person_tenure_milestone: "Tempo de casa",
};

/** Valor curto exibido no selo — mesma leitura de `metric.target` que já
 * sustenta a conquista (nenhum recálculo), só formatado pro espaço
 * compacto do selo. Tempo de casa e Consistência têm unidade própria (meses/
 * anos); o resto é contagem simples. */
function formatBadgeValue(achievement: AchievementRow): string {
  const target = achievement.metric?.target;
  if (target === null || target === undefined) return "";
  if (achievement.type === "person_tenure_milestone") {
    if (target >= 24) return `${target / 12} anos`;
    if (target === 12) return "1 ano";
    return `${target} meses`;
  }
  if (achievement.type === "person_consecutive_months_fully_within_target") return `${target} meses`;
  return String(target);
}

/** Credencial profissional — editorial/sóbria (borda + tipografia + filete
 * verde-limão como único acento), deliberadamente sem medalha/estrela/XP/
 * pódio. `title` (tooltip nativo) carrega o `headline` completo da conquista
 * por trás do selo, sem precisar de um componente de detalhe novo nesta
 * fase. */
function BadgeCredential({ achievement }: { achievement: AchievementRow }) {
  const label = BADGE_LABELS[achievement.type] ?? achievement.family;
  const value = formatBadgeValue(achievement);

  return (
    <div className="flex items-stretch gap-2 rounded-md border border-overview-border-strong bg-overview-surface-subtle px-3 py-2" title={achievement.headline}>
      <span className="w-0.5 shrink-0 rounded-full bg-lime" aria-hidden="true" />
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{label}</p>
        {value && <p className="text-sm font-semibold tabular-nums text-overview-text-primary">{value}</p>}
      </div>
    </div>
  );
}

/** Texto de distância relativa da meta — "20% melhor que a meta"/"20% acima
 * da meta", nunca uma média entre clientes (cada linha é a leitura de UM
 * cliente contra a PRÓPRIA meta). */
function formatRelativeDeviationLabel(deviation: number): string {
  const pct = Math.round(Math.abs(deviation) * 100);
  return deviation < 0 ? `${pct}% melhor que a meta` : `${pct}% acima da meta`;
}

function PortfolioPerformanceRow({ client }: { client: PortfolioClientEvaluation }) {
  const goalLabel = client.performanceGoal === "leads" ? "Leads" : client.performanceGoal === "sales" ? "Vendas" : client.performanceGoal === "followers" ? "Seguidores" : null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <div>
        <p className="text-sm font-medium text-overview-text-primary">{client.clientName}</p>
        <p className="mt-0.5 text-[13px] text-overview-text-secondary">{goalLabel ?? "Objetivo não configurado"}</p>
      </div>
      {client.evaluable && client.costActual !== null && client.costTarget !== null ? (
        <p className="text-right text-[13px] text-overview-text-secondary tabular-nums">
          {client.costMetricShortLabel} {formatCurrency(client.costActual)} · Meta {formatCurrency(client.costTarget)}
          {client.relativeDeviation !== null && (
            <>
              {" · "}
              <span className={client.withinTarget ? "text-overview-text-secondary" : "text-overview-danger"}>
                {formatRelativeDeviationLabel(client.relativeDeviation)}
              </span>
            </>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-overview-text-muted">
          Sem avaliação confiável — {client.unavailableReason ? describePortfolioUnavailableReason(client.unavailableReason).toLowerCase() : ""}
        </p>
      )}
    </div>
  );
}

function EvolutionRow({ point }: { point: ManagerPortfolioEvolutionPoint }) {
  const { summary } = point;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <p className="text-sm font-medium text-overview-text-primary">{formatMonthLabel(point.monthParam)}</p>
      <p className="text-[13px] text-overview-text-secondary tabular-nums">
        {summary.withinTargetCount}/{summary.evaluableCount} contas dentro da meta
      </p>
    </div>
  );
}
