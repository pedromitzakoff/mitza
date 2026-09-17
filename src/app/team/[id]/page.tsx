import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel, formatRelativeShortDateTime } from "@/lib/format";
import { loadTeamMemberProfiles, type TeamMemberPortfolioClient } from "@/lib/team-performance-data";
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
  const profiles = await loadTeamMemberProfiles(supabase, profile.organizationId, monthParam);
  const member = profiles.find((p) => p.teamMemberId === id);
  if (!member) notFound();

  const buildMonthHref = (nextMonth: string) => (nextMonth === currentRange.firstDay ? `/team/${id}` : `/team/${id}?month=${nextMonth}`);
  const now = new Date();

  const { portfolio, activityInPeriod, activityAllTime, achievements } = member;
  const nonComparableCount = portfolio.clientCount - portfolio.comparableCount;

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

      {/* PERFORMANCE DA CARTEIRA — desvio de custo (CPA/CPL/Custo por novo
          seguidor) contra a META DO PRÓPRIO CLIENTE, nunca volume absoluto.
          Reaproveita `evaluation.dimensions.cost` (Motor de Saúde) já
          calculado por `loadClientOperationalStates` — os mesmos 2 flags
          (`hasReliableSample`/`hasComparableScope`) que já protegem a
          Operação contra "Sem dados" mascarado de bom/mau desempenho.
          Denominador sempre explícito (nunca uma % sozinha escondendo
          quantos não entraram na conta). */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Performance da carteira atual" />
        {portfolio.comparableCount > 0 ? (
          <>
            <p className="mt-2 text-sm text-overview-text-primary">
              <span className="font-medium tabular-nums">
                {portfolio.withinOrAboveTargetCount} de {portfolio.comparableCount}
              </span>{" "}
              clientes com meta de custo comparável estão na meta ou melhor.
            </p>
            {nonComparableCount > 0 && (
              <p className="mt-1 text-[13px] text-overview-text-muted">
                {nonComparableCount} cliente{nonComparableCount !== 1 ? "s" : ""} sem meta de custo comparável ainda (amostra insuficiente, escopo de
                canal não comparável ou meta não configurada) — não contam nem a favor nem contra.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-overview-text-secondary">
            Nenhum cliente da carteira tem meta de custo comparável ainda neste período.
          </p>
        )}
      </div>

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
