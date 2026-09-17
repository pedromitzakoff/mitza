import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { loadTeamMemberProfiles } from "@/lib/team-performance-data";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { IconButton, Button } from "@/components/workspace/button";

/**
 * `/team` — Equipe, Fase 1 ("Perfil Profissional", não gestão administrativa
 * — essa mudou de rota pra `/settings/team`, ver `settings-shell.tsx`).
 *
 * Deliberadamente NÃO é uma lista de tarefas/pendências do gestor (isso já
 * existe em Operação/Timeline) — é uma leitura profissional: carteira
 * ATUAL, quanto essa carteira investiu no período, performance da carteira
 * ATUAL relativa à PRÓPRIA meta de cada cliente (nunca volume absoluto), e
 * atuação registrada (essa sim atribuível ao gestor — ator+timestamp
 * reais). Nenhum score/ranking/bônus/insígnia automática nesta fase — ver
 * `lib/team-performance-data.ts` pra auditoria completa de quais dados são
 * confiáveis e por quê.
 *
 * Etapa "Revisão semântica — atribuição de investimento/performance": como
 * não existe assignment history completo (auditoria original), nenhum
 * texto aqui pode sugerir que o gestor foi responsável pelo investimento/
 * performance do PERÍODO só porque `primary_manager_id` aponta pra ele
 * HOJE — por isso "R$ X gerenciados"/"gerenciado em {mês}" (que soa como
 * "este gestor gerenciou R$X neste mês") virou "Investimento da carteira
 * atual em {mês}" (a carteira é atual; o investimento é do mês; a frase
 * nunca afirma que o gestor gerenciou aquele valor o mês inteiro).
 *
 * Acesso: qualquer membro interno ativo (mesma regra de `getCurrentProfile`
 * já usada por Timeline/Conquistas) — não é uma área de RH, nenhuma RLS
 * nova.
 */
export default async function TeamDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const today = todayUTC();
  const currentRange = currentMonthRange(today);
  const monthParam = params.month && /^\d{4}-\d{2}-01$/.test(params.month) ? params.month : currentRange.firstDay;
  const monthLabel = formatMonthLabel(monthParam);

  const supabase = await createSupabaseClient();
  const profiles = await loadTeamMemberProfiles(supabase, profile.organizationId, monthParam);

  const buildMonthHref = (nextMonth: string) => (nextMonth === currentRange.firstDay ? "/team" : `/team?month=${nextMonth}`);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-overview-text-primary">Equipe</h1>
          <p className="mt-0.5 text-xs text-overview-text-secondary">{profiles.length} pessoas ativas</p>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton href={buildMonthHref(shiftMonthParam({ firstDay: monthParam }, -1))} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[8rem] text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={buildMonthHref(shiftMonthParam({ firstDay: monthParam }, 1))} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
          {monthParam !== currentRange.firstDay && (
            <Button href="/team" variant="ghost" size="sm" className="ml-0.5">
              Mês atual
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col divide-y divide-overview-border border-t border-overview-border">
        {profiles.map((member) => (
          <TeamMemberSummaryRow
            key={member.teamMemberId}
            monthLabel={monthLabel}
            profileHref={monthParam === currentRange.firstDay ? `/team/${member.teamMemberId}` : `/team/${member.teamMemberId}?month=${monthParam}`}
            member={member}
          />
        ))}
      </div>
    </div>
  );
}

function TeamMemberSummaryRow({
  member,
  monthLabel,
  profileHref,
}: {
  member: Awaited<ReturnType<typeof loadTeamMemberProfiles>>[number];
  monthLabel: string;
  profileHref: string;
}) {
  const { portfolio, activityInPeriod } = member;
  const hasComparablePerformance = portfolio.comparableCount > 0;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        <ClientAvatar name={member.name} imageUrl={member.avatarUrl} size="md" />
        <div>
          <p className="text-sm font-semibold text-overview-text-primary">{member.name}</p>
          {member.jobTitle && <p className="text-xs text-overview-text-secondary">{member.jobTitle}</p>}
        </div>
      </div>

      <div className="flex flex-1 flex-wrap items-baseline gap-x-8 gap-y-2 sm:justify-end">
        <div>
          <p className="text-[13px] text-overview-text-secondary">Carteira</p>
          <p className="mt-0.5 text-sm font-medium text-overview-text-primary">
            {portfolio.clientCount} cliente{portfolio.clientCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div>
          <p className="text-[13px] text-overview-text-secondary">Investimento da carteira atual em {monthLabel.toLowerCase()}</p>
          <p className="mt-0.5 text-sm font-medium text-overview-text-primary tabular-nums">{formatCurrency(portfolio.investmentActual)}</p>
        </div>
        {hasComparablePerformance && (
          <div>
            <p className="text-[13px] text-overview-text-secondary">Carteira atual na meta de custo</p>
            <p className="mt-0.5 text-sm font-medium text-overview-text-primary tabular-nums">
              {portfolio.withinOrAboveTargetCount} de {portfolio.comparableCount}
            </p>
          </div>
        )}
        <div>
          <p className="text-[13px] text-overview-text-secondary">Otimizações no mês</p>
          <p className="mt-0.5 text-sm font-medium text-overview-text-primary tabular-nums">{activityInPeriod.optimizations}</p>
        </div>
        <Link
          href={profileHref}
          className="self-center text-[13px] text-overview-text-muted underline decoration-overview-border hover:text-overview-text-secondary"
        >
          Ver perfil →
        </Link>
      </div>
    </div>
  );
}
