import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel, formatRelativeShortDateTime, formatDateFromInstant } from "@/lib/format";
import {
  loadTeamMemberProfiles,
  loadManagerAssignmentHistory,
  type TeamMemberPortfolioClient,
  type ManagerAssignmentHistoryEntry,
  type TeamMemberPortfolioSummary,
} from "@/lib/team-performance-data";
import {
  loadManagerPortfolioEvolution,
  describePortfolioUnavailableReason,
  type PortfolioClientEvaluation,
  type ManagerPortfolioEvolutionPoint,
  type PortfolioPerformanceSummary,
} from "@/lib/team-portfolio-performance";
import { curateTeamMemberTrajectory, type TrajectoryPoint } from "@/lib/team-trajectory";
import { buildInsigniaCollection, selectFeaturedInsignias, selectUpcomingMilestones, type Insignia } from "@/lib/achievement-insignia";
import { PERSON_FAMILY_LABEL } from "@/lib/achievement-labels";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { IconButton, Button } from "@/components/workspace/button";
import { SectionHeader } from "@/components/workspace/section-header";
import { InsigniaMark, stageNumeral } from "@/components/workspace/insignia-mark";
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
 *
 * Etapa "Equipe — Fase 5: Trajetória e Experiência Profissional": nova
 * seção "Trajetória" no topo (curadoria pura sobre `achievements`, ver
 * `lib/team-trajectory.ts` — nenhum evento/detector novo) e "Experiência"
 * (substitui a antiga seção "Histórico", mesmos números + "Clientes
 * atendidos"/"Meses com carteira avaliável" novos). Reorganização de
 * seções pra reduzir fragmentação visual (pedido explícito), nenhuma
 * remoção de informação existente. Deliberadamente SEM Especialização por
 * canal/objetivo (auditoria da etapa: sem histórico confiável antes de
 * hoje) e SEM qualquer data derivada de `team_members.created_at` — nem
 * "Entrou na KOFF em...", nem "Perfil registrado desde..." (pedido
 * explícito: omitir completamente, não substituir por uma frase mais
 * cautelosa).
 *
 * Etapa "Redesign do Perfil + Sistema Visual de Insígnias — 6B": a seção
 * "Insígnias" passa a usar `buildInsigniaCollection`/`InsigniaMark`
 * (`lib/achievement-insignia.ts` + `components/workspace/insignia-mark.tsx`,
 * Etapa 6A/6B) no lugar do antigo `selectPersonBadges`/`BadgeCredential` —
 * mesma fonte (`achievements`), nenhum dado novo, só a representação visual
 * própria da KOFF (placa geométrica + glifo por família + prestígio
 * Marco/Destaque/Elite). "Próximos marcos" (nova, discreta, texto puro)
 * usa `selectUpcomingMilestones`. Nenhuma outra seção desta página foi
 * tocada nesta etapa — cabeçalho, ordem das seções e demais componentes
 * seguem intocados (isso é trabalho da Etapa 6C, ainda não aprovada).
 *
 * Etapa "Redesign do Perfil + Sistema Visual de Insígnias — 6C": cabeçalho
 * redesenhado — identidade (nome, cargo/status, avatar em paleta KOFF via
 * `ClientAvatar palette="koff"`, opt-in, padrão de todo outro uso
 * intocado) ganha a maior hierarquia da página; até 3 insígnias em
 * destaque (`selectFeaturedInsignias`, Etapa 6A — nenhuma segunda seleção)
 * aparecem como objeto visual puro (`InsigniaMark`, sem credencial
 * completa — essa continua só na coleção, seção "Insígnias"); uma leitura
 * curta do estado profissional atual (`resolveProfileContextLine`, abaixo
 * — só reaproveita `portfolio`/`portfolioPerformance` já calculados,
 * nenhum cálculo novo, nunca menciona investimento). Seletor de mês
 * preservado, deslocado pra um papel visualmente secundário.
 *
 * Etapa "Redesign do Perfil + Sistema Visual de Insígnias — 6D:
 * Consolidação Visual": reduz fragmentação, nenhum cálculo/fonte/regra
 * nova. "Carteira atual" + "Performance da carteira atual" + "Evolução" +
 * "Histórico de carteira" viram UMA seção ("Carteira & Performance") —
 * lista por cliente fundida numa linha só (`PortfolioClientRow`, abaixo,
 * combina os campos das duas antigas linhas), Evolução como subleitura com
 * estado vazio honesto (nunca mais some inteira), Histórico revelável via
 * `<details>` nativo (nenhuma dependência nova). Investimento vira
 * contexto operacional discreto, nunca mais um `OperationMetric` de peso
 * igual à performance. "Atuação em [mês]" + "Experiência" (Fase 5) viram
 * UMA seção ("Experiência") — all-time é o número principal,
 * `activityInPeriod` vira contexto (`OperationMetric.context`) do MESMO
 * metric, nunca um segundo metric-peer repetindo o rótulo; as duas janelas
 * continuam dados diferentes, nunca somadas.
 *
 * Etapa "Redesign do Perfil + Sistema Visual de Insígnias — 6E: Acabamento
 * final do perfil profissional": nenhuma seção nova, nenhum cálculo/fonte
 * novo — só ritmo, hierarquia e consistência visual sobre o que 6A-6D já
 * construíram. A página passa a se ler como 3 grupos (nunca como
 * containers próprios — só espaço/linha/composição marcam a transição):
 * Identidade (cabeçalho) → História profissional (Trajetória, Carteira &
 * Performance, Experiência — mesma régua visual, as 3 com `accent` no
 * título) → Reconhecimento (Insígnias, Conquistas — sem `accent`, entrada
 * marcada por um respiro maior que o ritmo interno de cada grupo, nunca por
 * um container novo). Dentro de Reconhecimento, Conquistas propositalmente
 * pesa menos que Insígnias (tipografia mais discreta, linhas mais densas) —
 * Insígnias é a coleção curada, Conquistas é o registro histórico; a
 * diferença precisa ser perceptível sem parágrafo explicativo. Ordem final:
 * Perfil → Trajetória → Carteira & Performance → Experiência → Insígnias →
 * Conquistas.
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

  const { portfolio, portfolioPerformance, activityInPeriod, activityAllTime, distinctClientsServed, achievements } = member;
  const trajectory = curateTeamMemberTrajectory(achievements);
  // Contagens vivas já carregadas por esta mesma página (nenhuma query
  // nova) — exatamente os 3 tipos com contagem canônica simples disponível
  // aqui (ver auditoria da Etapa 6A). "Revisões" fica de fora: não existe
  // hoje uma contagem viva exposta por `loadTeamMemberProfiles` pra ela —
  // sem esse número, `buildInsigniaCollection` já nunca fabrica progresso.
  const insignias = buildInsigniaCollection(achievements, {
    person_optimizations_milestone: activityAllTime.optimizations,
    person_reports_milestone: activityAllTime.reportsSent,
    person_clients_served_milestone: distinctClientsServed,
  });
  const upcomingMilestones = selectUpcomingMilestones(insignias);
  const featuredInsignias = selectFeaturedInsignias(insignias);
  const profileContextLine = resolveProfileContextLine(portfolio, portfolioPerformance);
  // Etapa 6D — funde a leitura de carteira (portfolio.clients) com a de
  // performance (portfolioPerformance.clients) por cliente, numa única
  // linha (`PortfolioClientRow`, abaixo). Os dois arrays vêm sempre do
  // MESMO `managerStates` (`lib/team-performance-data.ts`), mesmo
  // clientId — o Map só existe pra casar os dois sem depender de ordem.
  const performanceByClientId = new Map(portfolioPerformance.clients.map((client) => [client.clientId, client]));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/team" className="inline-flex items-center gap-1.5 text-xs font-medium text-overview-text-muted hover:text-overview-text-secondary">
        &larr; Equipe
      </Link>

      {/* IDENTIDADE — Etapa "Equipe — Redesign do Perfil — 6C": a pessoa é o
          elemento de maior hierarquia da página, nunca o mês/KPIs/carteira.
          Rail em areia (mesmo token de `SectionHeader accent`, nenhuma cor
          nova) separa a coluna de identidade do avatar. Seletor de mês
          preservado, mas deslocado pra um papel visualmente secundário
          (controle da página, não parte da identidade) e empurrado pra
          depois da identidade na ordem de leitura mobile. */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <ClientAvatar name={member.name} imageUrl={member.avatarUrl} size="lg" palette="koff" />
          <div className="border-l-[3px] border-sand pl-4">
            <h1 className="text-2xl font-semibold tracking-tight text-overview-text-primary sm:text-3xl">{member.name}</h1>
            <p className="mt-1 text-sm text-overview-text-secondary">
              {member.jobTitle ?? "Sem cargo definido"} · {member.status === "ativo" ? "Ativo" : "Inativo"}
            </p>

            {/* Até 3 insígnias em destaque — objeto visual puro (nunca a
                credencial completa, essa é só da coleção abaixo). Seleção
                determinística da Etapa 6A (`selectFeaturedInsignias`),
                nunca reimplementada aqui. 0 destaques = nenhuma linha, sem
                cadeado/placeholder. */}
            {featuredInsignias.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                {featuredInsignias.map((insignia) => (
                  <span key={insignia.type} role="img" aria-label={insignia.achievement.headline} title={insignia.achievement.headline} className="inline-flex">
                    <InsigniaMark insignia={insignia} size="sm" />
                  </span>
                ))}
              </div>
            )}

            <p className="mt-3 text-[13px] text-overview-text-secondary">{profileContextLine}</p>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:pt-0.5">
          <IconButton href={buildMonthHref(shiftMonthParam({ firstDay: monthParam }, -1))} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[7rem] text-center text-[13px] text-overview-text-muted">{monthLabel}</span>
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

      {/* TRAJETÓRIA — Etapa "Equipe — Fase 5": resumo editorial dos
          principais marcos profissionais (curadoria pura sobre
          `achievements`, `lib/team-trajectory.ts`), no máximo 6 pontos, em
          ordem cronológica. Some inteira sem dado — nunca um estado vazio
          fabricado (mesmo padrão de "Evolução"/"Histórico de carteira"
          abaixo). A visão completa e não-curada continua em "Conquistas",
          no fim da página. */}
      {trajectory.length > 0 && (
        <div className="mt-8 border-t border-overview-border pt-4">
          <SectionHeader title="Trajetória" accent />
          <div className="mt-4 flex flex-col gap-5 border-l border-overview-border pl-5">
            {trajectory.map((point) => (
              <TrajectoryRow key={point.type} point={point} />
            ))}
          </div>
        </div>
      )}

      {/* CARTEIRA & PERFORMANCE — Etapa "Equipe — Redesign do Perfil — 6D":
          consolida as 4 antigas seções (Carteira atual / Performance da
          carteira atual / Evolução / Histórico de carteira) numa única
          leitura editorial — "qual é a responsabilidade atual dessa pessoa
          e como essa carteira está performando", nenhum cálculo novo, só
          composição. Nenhuma fonte/regra/período mudou: `portfolio.clientCount`
          e `portfolioPerformance.evaluableCount/withinTargetCount` continuam
          exatamente os mesmos agregados de sempre; `portfolioEvolution`
          continua só meses com responsabilidade INTEIRA (Fase 3,
          `periodCoversFullMonth`); `assignmentHistory` continua vindo de
          `client_manager_assignments` via `loadManagerAssignmentHistory`
          (Fase 2), nunca reconstruído.
          Investimento vira contexto operacional discreto (nunca mais um
          `OperationMetric` de peso igual aos números de performance —
          pedido explícito: nunca "mais investimento = melhor gestor").
          A lista por cliente funde as duas antigas linhas (Carteira atual +
          Performance) numa só (`PortfolioClientRow`, abaixo) — MESMOS
          campos dos dois lados, nenhuma informação removida, só uma leitura
          por cliente em vez de duas. */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Carteira & Performance" accent />
        <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-5">
          <OperationMetric label="Clientes sob responsabilidade" value={String(portfolio.clientCount)} />
          <OperationMetric label="Dentro da meta" value={`${portfolioPerformance.withinTargetCount} / ${portfolioPerformance.evaluableCount}`} />
        </div>
        {portfolioPerformance.unavailableCount > 0 && (
          <p className="mt-2 text-[13px] text-overview-text-muted">
            {portfolioPerformance.unavailableCount} conta{portfolioPerformance.unavailableCount !== 1 ? "s" : ""} sem avaliação confiável — não
            contam nem a favor nem contra.
          </p>
        )}
        <p className="mt-2 text-[13px] text-overview-text-muted">
          Investimento da carteira atual em {monthLabel.toLowerCase()}: {formatCurrency(portfolio.investmentActual)} — contexto operacional, não é
          leitura de performance.
        </p>

        {portfolio.clients.length > 0 ? (
          <div className="mt-4 flex flex-col divide-y divide-overview-border">
            {portfolio.clients.map((client) => (
              <PortfolioClientRow key={client.clientId} client={client} evaluation={performanceByClientId.get(client.clientId)} today={now} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-overview-text-secondary">Nenhum cliente sob responsabilidade atualmente.</p>
        )}

        {/* EVOLUÇÃO — subleitura, mesma regra temporal da Fase 3. Estado
            vazio honesto e discreto (nunca a seção inteira some mais —
            agora vive dentro de um bloco persistente). */}
        <div className="mt-6 border-t border-overview-border pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Evolução</p>
          {portfolioEvolution.length > 0 ? (
            <div className="mt-2 flex flex-col divide-y divide-overview-border">
              {portfolioEvolution.map((point) => (
                <EvolutionRow key={point.monthParam} point={point} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-overview-text-muted">Ainda sem meses completos suficientes para mostrar evolução da carteira.</p>
          )}
        </div>

        {/* HISTÓRICO DE CARTEIRA — revelável (`<details>` nativo, sem
            dependência nova), nunca escondido de forma inacessível. Some
            inteiro só quando não há NENHUM período pra mostrar (nada antes
            do deploy da Fase 2 existe com confiança). */}
        {assignmentHistory.length > 0 && (
          <details className="mt-5 border-t border-overview-border pt-3">
            <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-overview-text-muted hover:text-overview-text-secondary">
              Histórico de carteira
            </summary>
            <div className="mt-3 flex flex-col divide-y divide-overview-border">
              {assignmentHistory.map((entry) => (
                <AssignmentHistoryRow key={`${entry.clientId}-${entry.startedAt}`} entry={entry} />
              ))}
            </div>
          </details>
        )}
      </div>

      {/* EXPERIÊNCIA — Etapa "Equipe — Redesign do Perfil — 6D": funde as
          antigas "Atuação em [mês]" + "Experiência" (Fase 5) — mesmos 3
          números de atuação, agora numa ÚNICA leitura por métrica: all-time
          é o número principal, o período selecionado vira contexto
          (`OperationMetric.context`, nunca um segundo metric-peer repetindo
          o mesmo rótulo). As duas janelas continuam sendo DOIS dados
          diferentes (`activityAllTime` / `activityInPeriod`, nenhuma soma,
          nenhuma substituição) — só a apresentação foi unificada. Contexto
          só aparece quando > 0 (nunca "0 neste mês" como se fosse
          informação). "Clientes atendidos" (`distinctClientsServed`)
          continua distinto de `portfolio.clientCount` (carteira atual) —
          atendeu (atividade histórica) nunca é o mesmo que ser responsável
          (atribuição atual), ver `lib/team-performance-data.ts`. */}
      <div className="mt-8 border-t border-overview-border pt-4">
        <SectionHeader title="Experiência" accent />
        <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3">
          <OperationMetric label="Clientes atendidos" value={String(distinctClientsServed)} />
          <OperationMetric
            label="Otimizações"
            value={String(activityAllTime.optimizations)}
            context={activityInPeriod.optimizations > 0 ? `${activityInPeriod.optimizations} neste mês` : undefined}
          />
          <OperationMetric
            label="Reports enviados"
            value={String(activityAllTime.reportsSent)}
            context={activityInPeriod.reportsSent > 0 ? `${activityInPeriod.reportsSent} neste mês` : undefined}
          />
          <OperationMetric
            label="Reuniões concluídas"
            value={String(activityAllTime.meetings)}
            context={activityInPeriod.meetings > 0 ? `${activityInPeriod.meetings} neste mês` : undefined}
          />
          {portfolioEvolution.length > 0 && <OperationMetric label="Meses com carteira avaliável" value={String(portfolioEvolution.length)} />}
        </div>
        <p className="mt-3 text-[12px] text-overview-text-muted">
          Nenhum valor de investimento de períodos anteriores é mostrado aqui — não há como comprovar, com segurança, que os clientes da carteira
          atual já estavam sob esta gestão nesses períodos.
        </p>
      </div>

      {/* INSÍGNIAS — Etapa "Equipe — Redesign do Perfil + Sistema Visual de
          Insígnias — 6A/6B": `buildInsigniaCollection` (maior patamar já
          cruzado por tipo escalonável, mais os tipos únicos/recorrente de
          Performance — Etapa 6A) representada pelo sistema visual próprio
          da KOFF (`InsigniaMark` — Etapa 6B), nunca um evento novo, nunca
          medalha/estrela/XP. "Próximos marcos" é deliberadamente discreto
          (texto puro, sem símbolo, sem parede de cadeados) — só aparece
          quando a Etapa 6A já tem sinal confiável (família com atividade
          real, nunca uma família zerada). */}
      {insignias.length > 0 && (
        <div className="mt-14 border-t border-overview-border pt-4">
          <SectionHeader title="Insígnias" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {insignias.map((insignia) => (
              <InsigniaCredential key={insignia.type} insignia={insignia} />
            ))}
          </div>

          {upcomingMilestones.length > 0 && (
            <div className="mt-5 border-t border-overview-border pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Próximos marcos</p>
              <div className="mt-2 flex flex-col gap-1">
                {upcomingMilestones.map((insignia) => (
                  <p key={insignia.type} className="text-[13px] text-overview-text-secondary">
                    {upcomingMilestoneLabel(insignia)}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONQUISTAS — só escopo Pessoa (ator real, gravado no momento da
          conquista). Conquistas de escopo Cliente nunca aparecem aqui (sem
          ator gravado — ver auditoria). Sem tokens/medalhas nesta fase. */}
      {/* Etapa 6E — Conquistas é o registro histórico (denso, textual),
          Insígnias é a coleção curada (símbolo, protagonista). A diferença
          de peso vem só de tipografia/densidade, nunca de um parágrafo
          explicando a distinção. Quando não há Insígnias pra abrir o grupo
          Reconhecimento, Conquistas herda o respiro maior de entrada do
          grupo (mesma regra visual, nunca um container novo). */}
      <div className={insignias.length > 0 ? "mt-8 border-t border-overview-border pt-4" : "mt-14 border-t border-overview-border pt-4"}>
        <SectionHeader title="Conquistas" />
        {achievements.length > 0 ? (
          <div className="mt-3 flex flex-col divide-y divide-overview-border">
            {achievements.map((achievement) => (
              <div key={achievement.id} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] text-overview-text-secondary">{achievement.headline}</p>
                  <span className="shrink-0 text-[12px] text-overview-text-muted">{formatRelativeShortDateTime(achievement.occurredAt, now)}</span>
                </div>
                {achievement.detail && <p className="mt-0.5 text-[12px] text-overview-text-muted">{achievement.detail}</p>}
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

/**
 * Leitura curta do "estado profissional atual" pro cabeçalho (Etapa 6C) —
 * só reaproveita `portfolio.clientCount` (Carteira atual) e
 * `portfolioPerformance.evaluableCount`/`.withinTargetCount` (Performance
 * da carteira atual, Fase 3), nenhum cálculo novo. Nunca menciona
 * investimento (nunca mérito por volume administrado — pedido explícito).
 *
 * 3 estados, sempre honestos, nunca uma frase fabricada/enganosa:
 * - sem cliente algum -> frase própria, sem tentar falar de performance;
 * - com cliente(s) mas nenhuma conta avaliável -> diz isso explicitamente,
 *   nunca "0 de 0 dentro da meta";
 * - caso geral -> "X de Y contas avaliáveis dentro da meta", onde Y
 *   (`evaluableCount`) pode ser menor que a carteira inteira (contas sem
 *   meta/amostra/objetivo comparável ficam de fora do denominador, exatamente
 *   como a seção "Performance da carteira atual" já faz) — nunca escondido,
 *   só não detalhado aqui; o motivo completo já vive na seção logo abaixo.
 */
export function resolveProfileContextLine(portfolio: TeamMemberPortfolioSummary, portfolioPerformance: PortfolioPerformanceSummary): string {
  if (portfolio.clientCount === 0) return "Nenhum cliente sob responsabilidade no momento.";

  const clientsClause = `${portfolio.clientCount} cliente${portfolio.clientCount !== 1 ? "s" : ""} sob responsabilidade`;

  if (portfolioPerformance.evaluableCount === 0) return `${clientsClause} · nenhuma conta avaliável no momento`;

  const accountWord = portfolioPerformance.evaluableCount === 1 ? "conta avaliável" : "contas avaliáveis";
  return `${clientsClause} · ${portfolioPerformance.withinTargetCount} de ${portfolioPerformance.evaluableCount} ${accountWord} dentro da meta`;
}

/**
 * Etapa "Equipe — Redesign do Perfil — 6D": linha ÚNICA por cliente,
 * fundindo as antigas `PortfolioClientRow` (carteira: objetivo/canais/
 * "assumiu em") + `PortfolioPerformanceRow` (performance: avaliável/custo/
 * meta/desvio/motivo de indisponibilidade) — mesmos campos dos dois lados,
 * nenhum removido. A leitura de custo usa `evaluation` (mais completa —
 * `evaluable` já exclui objetivos não suportados/sem meta/amostra
 * insuficiente/escopo não comparável, ver `evaluatePortfolioClient`,
 * `lib/team-portfolio-performance.ts`) em vez do `client.costComparable`
 * mais estreito — os VALORES (`costActual`/`costTarget`) são idênticos nos
 * dois lados (mesma leitura de `state.evaluation.dimensions.cost`), só a
 * classificação "isso é comparável?" é mais completa em `evaluation`.
 */
function PortfolioClientRow({
  client,
  evaluation,
  today,
}: {
  client: TeamMemberPortfolioClient;
  evaluation: PortfolioClientEvaluation | undefined;
  today: Date;
}) {
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
      {evaluation?.evaluable && evaluation.costActual !== null && evaluation.costTarget !== null ? (
        <p className="text-[13px] text-overview-text-secondary tabular-nums sm:text-right">
          {evaluation.costMetricShortLabel} {formatCurrency(evaluation.costActual)} · Meta {formatCurrency(evaluation.costTarget)}
          {evaluation.relativeDeviation !== null && (
            <>
              {" · "}
              <span className={evaluation.withinTarget ? "text-overview-text-secondary" : "text-overview-danger"}>
                {formatRelativeDeviationLabel(evaluation.relativeDeviation)}
              </span>
            </>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-overview-text-muted">
          Sem avaliação confiável{evaluation?.unavailableReason ? ` — ${describePortfolioUnavailableReason(evaluation.unavailableReason).toLowerCase()}` : ""}
        </p>
      )}
    </div>
  );
}

/** "OUT 2026" — mês abreviado maiúsculo + ano, sem "de" (Etapa "Equipe —
 * Fase 5": rótulo pedido pra Trajetória, diferente de `formatMonthLabel`,
 * que devolve "Outubro de 2026" pro seletor de mês da própria página —
 * dois estilos deliberadamente distintos, cada um no seu lugar, nenhum dos
 * dois reescrito). `point.occurredAt` já é um timestamp completo (meio-dia
 * fixo no fuso da agência, ver `achievement-engine.ts:persistCandidate`) —
 * nunca precisa do sufixo `T00:00:00Z` que as datas civis puras deste
 * arquivo usam em outro lugar. */
const trajectoryMonthYearFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });

function formatTrajectoryMonthLabel(occurredAt: string): string {
  const [month, year] = trajectoryMonthYearFormatter.format(new Date(occurredAt)).split(" de ");
  return `${month.replace(/\.$/, "").toUpperCase()} ${year}`;
}

/** Uma linha da Trajetória — timeline editorial discreta (trilho fino +
 * marcador verde-limão pequeno, nunca troféu/medalha/card pesado/gráfico).
 * Mesmos tokens de identidade KOFF já usados no resto da página
 * (`bg-lime`, `overview-*`) — nenhuma cor nova inventada. */
function TrajectoryRow({ point }: { point: TrajectoryPoint }) {
  return (
    <div className="relative">
      <span className="absolute top-1.5 -left-[21px] h-1.5 w-1.5 rounded-full bg-lime" aria-hidden="true" />
      <p className="text-[11px] font-medium tracking-wide text-overview-text-muted uppercase">{formatTrajectoryMonthLabel(point.occurredAt)}</p>
      <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{point.headline}</p>
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

/** Texto compacto de "o que foi conquistado" por `type` — estilo rótulo
 * ("100 otimizações"), sempre a partir de `insignia.milestone`/`type`
 * (campos já classificados pela Etapa 6A, nenhum recálculo). Deliberadamente
 * uma função PRÓPRIA, nunca reaproveita `buildTrajectoryHeadline`
 * (`lib/team-trajectory.ts`, Fase 5): aquela escreve pra uma linha do tempo
 * narrativa ("100 otimizações registradas"), esta pra uma credencial
 * compacta ("100 otimizações") — finalidades diferentes, mesmo dado de
 * origem. Nunca reaproveita `achievement.headline` bruto (escrito pro feed
 * de Conquistas compartilhado, sempre com nome). */
function insigniaHeadline(insignia: Insignia): string {
  const n = insignia.milestone ?? 0;
  switch (insignia.type) {
    case "person_reviews_milestone":
      return `${n} ${n === 1 ? "revisão" : "revisões"}`;
    case "person_optimizations_milestone":
      return `${n} ${n === 1 ? "otimização" : "otimizações"}`;
    case "person_clients_served_milestone":
      return `${n} ${n === 1 ? "cliente atendido" : "clientes atendidos"}`;
    case "person_reports_milestone":
      return `${n} ${n === 1 ? "report enviado" : "reports enviados"}`;
    case "person_consecutive_months_fully_within_target":
      return `${n} ${n === 1 ? "mês" : "meses"} de consistência`;
    case "person_first_meeting_completed":
      return "Primeira reunião concluída";
    case "person_first_creative_delivery_completed":
      return "Primeira entrega de criativo concluída";
    case "person_first_client_within_target":
      return "Primeira conta dentro da meta";
    case "person_portfolio_fully_within_target":
      return "Carteira inteira dentro da meta";
    default:
      // Defensivo — nunca deveria ocorrer: todo `type` que chega até aqui já
      // passou pela classificação da Etapa 6A (`buildInsigniaCollection`).
      return insignia.achievement.headline;
  }
}

/** Credencial profissional — Etapa 6B: o símbolo (`InsigniaMark`) é
 * protagonista, texto mínimo e hierárquico (família → estágio, só
 * progressivas → o que foi conquistado → data), nunca um card grande.
 * `title` (tooltip nativo) carrega o `headline` completo da conquista de
 * origem, sem precisar de um componente de detalhe novo nesta etapa. */
function InsigniaCredential({ insignia }: { insignia: Insignia }) {
  const familyLabel = PERSON_FAMILY_LABEL[insignia.family] ?? insignia.family;

  return (
    <div className="flex items-start gap-3 rounded-md border border-overview-border-strong bg-overview-surface-subtle p-3" title={insignia.achievement.headline}>
      <InsigniaMark insignia={insignia} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">{familyLabel}</p>
        {insignia.stage && <p className="mt-0.5 text-[12px] font-medium text-overview-text-secondary">Estágio {stageNumeral(insignia.stage.current)}</p>}
        <p className="mt-0.5 text-sm font-semibold text-overview-text-primary">{insigniaHeadline(insignia)}</p>
        <p className="mt-0.5 text-[12px] text-overview-text-muted">Conquistada em {formatDateFromInstant(insignia.occurredAt)}</p>
      </div>
    </div>
  );
}

/** "Otimizações IV · 187 / 250" — linha discreta de texto puro (sem
 * símbolo, sem cadeado), Etapa 6B. `progress` só existe quando a Etapa 6A
 * recebeu uma contagem viva pra este tipo (ver `LIVE_PROGRESS_ALLOWED_TYPES`,
 * `lib/achievement-insignia.ts`) — sem ela, cai pro texto "próximo: N", nunca
 * uma fração fabricada. */
function upcomingMilestoneLabel(insignia: Insignia): string {
  const familyLabel = PERSON_FAMILY_LABEL[insignia.family] ?? insignia.family;
  const nextStage = insignia.stage ? ` ${stageNumeral(insignia.stage.current + 1)}` : "";
  const progress = insignia.progress ? `${insignia.progress.current} / ${insignia.progress.next}` : `próximo: ${insignia.nextMilestone}`;
  return `${familyLabel}${nextStage} · ${progress}`;
}

/** Texto de distância relativa da meta — "20% melhor que a meta"/"20% acima
 * da meta", nunca uma média entre clientes (cada linha é a leitura de UM
 * cliente contra a PRÓPRIA meta). */
function formatRelativeDeviationLabel(deviation: number): string {
  const pct = Math.round(Math.abs(deviation) * 100);
  return deviation < 0 ? `${pct}% melhor que a meta` : `${pct}% acima da meta`;
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
