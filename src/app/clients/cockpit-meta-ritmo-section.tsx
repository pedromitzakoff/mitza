import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import type { SpendStatus } from "@/lib/spend-status";
import type { MetricTone } from "@/lib/metric-diagnostics";
import { formatCurrency } from "@/lib/format";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { PACE_VERDICT_LABEL, PACE_VERDICT_TONE, COCKPIT_CARD_CLASSES, COCKPIT_TONE_BADGE_CLASSES, COCKPIT_TONE_DOT_CLASSES } from "@/lib/cockpit-pace";
import { DashboardBudget, type DashboardBudgetChannel } from "./dashboard-budget";

/**
 * MITZA ONE — Refinamento do Cockpit (seção 2 do pedido): dados pra abrir o
 * fluxo OFICIAL de edição de meta direto do Cockpit. `kind` decide qual
 * editor já existente é reaproveitado: "primary" → calculadora de
 * Investimento/Resultado/Custo (mesma de `/metas` pro objetivo principal);
 * "secondary" → `MetasSecondaryTargetForm` (só Meta de quantidade —
 * objetivo secundário nunca tem Investimento/Custo planejados manualmente,
 * mesma trava de `set_goal_monthly_target`). `null` em qualquer card = sem
 * permissão de edição aqui (não-admin ou mês encerrado) — nenhum lápis
 * aparece.
 *
 * MITZA ONE — pedido do usuário ("nao quero mais essa tela [drawer]. Quero
 * q seja tudo feito ali no painel central mesmo"): `CockpitResultCard`/
 * `CockpitCostCard` (que efetivamente montam o lápis + o editor inline)
 * moraram pra `cockpit-goal-card.tsx` ("use client", precisam de estado
 * `isEditing` próprio) — este arquivo (`cockpit-meta-ritmo-section.tsx`)
 * continua Server Component e só define os dados/views serializáveis
 * (`CockpitGoalEditAffordance`/`CockpitResultCardView`/
 * `CockpitCostCardView`) consumidos lá, nunca uma função cruzando a
 * fronteira Server->Client.
 */
export interface CockpitGoalEditAffordance {
  kind: "primary" | "secondary";
  clientId: string;
  monthParam: string;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  currentPlanningEndDate: string | null;
  channels: TrafficChannel[];
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  performanceGoal: PerformanceGoal;
  returnTo: string;
}

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Meta & Ritmo"
 * (pedido, seções 5-10): primeira grande seção do cockpit — "Estamos no
 * caminho certo?". Três famílias de card: RESULTADO, CUSTO POR RESULTADO,
 * ORÇAMENTO/INVESTIMENTO — nenhum cálculo novo, só uma composição nova em
 * torno de fontes já oficiais:
 *
 * - Resultado/Custo: um PAR de cards por objetivo realmente em jogo
 *   (`groupChannelsByResultType`, `lib/cockpit-result-groups.ts` — seção 9
 *   do pedido: "não somar resultados incompatíveis"). Cliente com um só
 *   objetivo (o caso comum) mostra 1 par; mais de um objetivo mostra um
 *   par por objetivo, nunca um consolidado fabricado entre eles.
 * - Orçamento: sempre 1 card só (dinheiro soma entre canais, independente
 *   de objetivo) — cabeçalho novo (status/necessário por dia/barra) seguido
 *   do `DashboardBudget` já oficial (composição por canal + edição inline,
 *   MESMA Server Action/RPC de sempre, nenhuma segunda implementação).
 *
 * Barra de progresso: `AgencyInvestmentBar` já existente (identidade MITZA,
 * nunca uma barra nova) — `showLegend={false}` porque o card já tem seu
 * próprio texto de "necessário/dia" (evita repetir a mesma informação duas
 * vezes, seção 17 do pedido).
 *
 * Custo por resultado NUNCA tem barra de progresso (seção 10 do pedido:
 * "Custo por resultado é ratio, não tratar como métrica cumulativa").
 */

function PaceVerdictBadge({ status }: { status: SpendStatus }) {
  const tone = PACE_VERDICT_TONE[status];
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${COCKPIT_TONE_DOT_CLASSES[tone]}`} />
      <span className={COCKPIT_TONE_BADGE_CLASSES[tone]}>{PACE_VERDICT_LABEL[status]}</span>
    </p>
  );
}

export interface CockpitResultCardView {
  resultType: PerformanceGoal;
  /** "Meta + Google", "Google" — rótulo dos canais deste objetivo, só
   * exibido quando há mais de um objetivo em jogo (nunca necessário no
   * caso comum de 1 objetivo só). */
  channelsLabel: string | null;
  resultCount: number;
  targetResultCount: number | null;
  expectedResultsToDate: number | null;
  /** `computeNeededDailyRate` — `null` sem meta configurada ou sem dias
   * elegíveis restantes (nunca 0 fabricado). */
  neededDailyRate: number | null;
  /** MITZA ONE — Refinamento do Cockpit (seção 2): `null` = sem permissão
   * de edição aqui (não-admin ou mês encerrado, mesmo gate de
   * `canEditBudgetInline`) — nenhum lápis aparece. */
  edit: CockpitGoalEditAffordance | null;
  /** KOFF Analytics — "Filtro global de performance": presente SÓ quando o
   * filtro global está ativo — substitui meta/progresso/lápis por uma nota
   * explícita ("Escopo filtrado — meta do mês não comparável aqui"), nunca
   * compara o subconjunto filtrado contra a meta da carteira inteira
   * (pedido explícito do usuário). `null`/ausente = comportamento de
   * sempre. Nunca coexiste com `unavailableReason`. */
  filteredNotice?: string;
  /** KOFF Analytics — "Filtro global de performance": presente SÓ quando o
   * filtro está ativo E este objetivo não pode ser recalculado no escopo
   * filtrado (combina canais sem granularidade de campanha, ou não tem
   * nenhuma linha de campanha pra recalcular) — `resultCount` já vem `0`
   * fabricado neste caso (`resolveFilteredExecutiveCardOverride`,
   * `lib/cockpit-global-filter.ts`); o card mostra "—" em vez do número e
   * este texto no lugar de meta/progresso, NUNCA o número global
   * disfarçado de filtrado (pedido explícito do usuário). */
  unavailableReason?: string;
}

export interface CockpitCostCardView {
  resultType: PerformanceGoal;
  costPerResult: number | null;
  targetCostPerResult: number | null;
  deviationPct: number | null;
  tone: MetricTone;
  /** Só pro objetivo PRINCIPAL — ver nota no componente abaixo. `null`
   * também cobre "sem permissão de edição aqui". */
  edit: CockpitGoalEditAffordance | null;
  /** Ver `CockpitResultCardView.filteredNotice` — mesma regra. */
  filteredNotice?: string;
  /** Ver `CockpitResultCardView.unavailableReason` — mesma regra. */
  unavailableReason?: string;
}

/**
 * Etapa "Faturamento e ROAS nos cards principais" (pedido explícito do
 * usuário): só existe (não-`null`) pro grupo de objetivo "vendas" — nenhum
 * cliente com Leads/Conversas/Cadastros/Seguidores ganha estes cards.
 * `revenue`/`roas` nunca são metas com meta/progresso/edição — não existe
 * "meta de faturamento" nesta plataforma, por isso esta view é só leitura
 * (`PerformanceSummary.revenue`/`.roas`, `lib/performance.ts`, já
 * calculados há muito tempo — só não eram exibidos ainda). `null` é sempre
 * "sem faturamento registrado" (objetivo vendas sem o evento de valor
 * configurado no mapeamento Meta, ou cliente manual sem receita lançada) —
 * nunca `0` fabricado. */
export interface CockpitSalesExtraCardView {
  revenue: number | null;
  roas: number | null;
  /** Ver `CockpitResultCardView.filteredNotice` — mesma regra. */
  filteredNotice?: string;
  /** Ver `CockpitResultCardView.unavailableReason` — mesma regra. */
  unavailableReason?: string;
}

export interface CockpitBudgetHeadlineView {
  monthActual: number;
  monthPlanned: number;
  monthExpectedToDate: number;
  monthStatus: SpendStatus;
  /** `computeMonthlyBudgetPlan(...).recommendedDaily` — `null` quando o mês
   * está encerrado/futuro ou sem orçamento (mesmo guard de
   * `MonthInvestmentPaceNote.hasPace`, nunca um valor fabricado). */
  neededDailyRate: number | null;
}

/** Card "ORÇAMENTO" — cabeçalho (status/investido/necessário-dia/barra)
 * seguido do `DashboardBudget` oficial (composição por canal + edição
 * inline). Um card visual só, duas partes: a de cima é NOVA composição
 * (nenhum cálculo novo — `monthActual`/`monthPlanned`/`monthStatus` já
 * vêm prontos de `[id]/page.tsx`, exatamente como antes desta fase); a de
 * baixo é o componente já oficial, intocado. */
export function CockpitBudgetCard({
  headline,
  clientId,
  monthParam,
  channels,
  canEdit,
  /** KOFF Analytics — "Filtro global de performance": Orçamento é sempre
   * do CLIENTE INTEIRO (dinheiro planejado pro mês, nunca um recorte por
   * campanha) — nunca recalculado pro escopo filtrado (pedido explícito do
   * usuário: "orçamentos e metas globais não devem ser apresentados como
   * metas do subconjunto filtrado"). Quando o filtro está ativo, mostra
   * uma nota explícita deixando claro que este card continua olhando o
   * cliente inteiro — nunca mistura silenciosamente dado global com
   * filtrado. */
  isGlobalFilterActive = false,
  /** Etapa "Correção do rótulo de Investimento fora do mês" (bug
   * reportado pelo usuário): `headline.monthActual` já vinha certo fora de
   * "Este mês" (Hoje/Ontem/Últimos 7/30 dias/Personalizado) — era sempre o
   * gasto do INTERVALO CONSULTADO, nunca do mês (`monthActualForHeadline`,
   * `lib/cockpit-view-data.ts`); só o RÓTULO ficava hardcoded "no mês",
   * uma falha de comunicação real (o número certo com a legenda errada).
   * `monthPlanned` já vem forçado a `0` fora do mês (nenhuma meta mensal
   * faz sentido pra comparar contra uma janela de poucos dias) — por isso
   * o texto do estado vazio também precisa deixar de mencionar "o mês". */
  isMonthAligned = true,
}: {
  headline: CockpitBudgetHeadlineView;
  clientId: string;
  monthParam: string;
  channels: DashboardBudgetChannel[];
  canEdit: boolean;
  isGlobalFilterActive?: boolean;
  isMonthAligned?: boolean;
}) {
  const summary = resolveMonthPeriodSummary(
    {
      monthPlanned: headline.monthPlanned,
      monthActual: headline.monthActual,
      monthExpectedToDate: headline.monthExpectedToDate,
      monthStatus: headline.monthStatus,
    },
    "",
    { firstDay: "", lastDay: "" },
  );

  return (
    <div className={`rounded-lg border p-2.5 ${COCKPIT_CARD_CLASSES}`}>
      <PaceVerdictBadge status={headline.monthStatus} />
      <p className="mt-1 text-2xl font-bold tracking-tight text-overview-text-primary tabular-nums">{formatCurrency(headline.monthActual)}</p>
      <p className="text-xs text-overview-text-secondary">
        investido {isMonthAligned ? "no mês" : "no período"}
        {isGlobalFilterActive && <span className="text-overview-text-muted"> · cliente inteiro, não filtrado</span>}
      </p>
      {headline.monthPlanned > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-overview-text-muted">
          {headline.neededDailyRate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span>Necessário</span>
              <span className="tabular-nums font-medium text-overview-text-secondary">{formatCurrency(headline.neededDailyRate)} / dia</span>
            </div>
          )}
          <AgencyInvestmentBar summary={summary} showLegend={false} />
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-overview-text-muted">
          {isMonthAligned ? "Sem planejamento configurado para o mês." : "Sem planejamento mensal comparável neste período."}
        </p>
      )}

      {/* `compact`: `DashboardBudget` mostra "Planejado" (pencil + composição
          por canal) sem repetir sua própria moldura/título — a caixa única
          deste card já estabelece o contexto "ORÇAMENTO" acima (seção 1 do
          pedido: eliminar a caixa dupla, mantendo edição/multicanal
          intactos). Único lugar onde o valor planejado aparece agora. */}
      <div className="mt-2 border-t border-overview-border/60 pt-2">
        <DashboardBudget clientId={clientId} monthParam={monthParam} total={headline.monthPlanned} channels={channels} canEdit={canEdit} compact />
      </div>
    </div>
  );
}

/** Nota compartilhada por `CockpitRevenueCard`/`CockpitRoasCard` abaixo do
 * valor principal — mesma hierarquia de prioridade que Resultado/Custo já
 * usam (indisponível no escopo filtrado > nota de escopo filtrado > sem
 * dado real). Nunca os três ao mesmo tempo. */
function SalesExtraCardNote({ view, valueIsNull, emptyText }: { view: CockpitSalesExtraCardView; valueIsNull: boolean; emptyText: string }) {
  if (view.unavailableReason) return <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.unavailableReason}</p>;
  if (view.filteredNotice) return <p className="mt-1.5 text-[11px] text-overview-text-muted">{view.filteredNotice}</p>;
  if (valueIsNull) return <p className="mt-1.5 text-[11px] text-overview-text-muted">{emptyText}</p>;
  return null;
}

/** Card "VALOR GERADO" — só existe pro grupo de objetivo "vendas" (ver
 * `CockpitSalesExtraCardView`). Sem meta/progresso/edição: faturamento não
 * tem meta planejada nesta plataforma, só o realizado. */
export function CockpitRevenueCard({ view }: { view: CockpitSalesExtraCardView }) {
  return (
    <div className={`rounded-lg border p-2.5 ${COCKPIT_CARD_CLASSES}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">VALOR GERADO</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-overview-text-primary tabular-nums">
        {view.unavailableReason || view.revenue === null ? "—" : formatCurrency(view.revenue)}
      </p>
      <p className="text-xs text-overview-text-secondary">Faturamento em vendas</p>
      <SalesExtraCardNote
        view={view}
        valueIsNull={view.revenue === null}
        emptyText="Sem faturamento registrado — configure o evento de valor no mapeamento Meta."
      />
    </div>
  );
}

/** Card "ROAS" — mesmo par ("VALOR GERADO"/"ROAS") sempre juntos, mesma
 * fonte (`PerformanceSummary.roas = revenue ÷ investimento`,
 * `computeRoas`, lib/performance.ts). Formato "x,xx" — mesma convenção já
 * usada pelo ROAS de "Indicadores Meta Ads" (`meta-ads-dashboard/metric-
 * cards.ts`), nunca uma segunda formatação pro mesmo tipo de métrica. */
export function CockpitRoasCard({ view }: { view: CockpitSalesExtraCardView }) {
  return (
    <div className={`rounded-lg border p-2.5 ${COCKPIT_CARD_CLASSES}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-secondary">ROAS</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-overview-text-primary tabular-nums">
        {view.unavailableReason || view.roas === null ? "—" : `${view.roas.toFixed(2)}x`}
      </p>
      <p className="text-xs text-overview-text-secondary">Retorno sobre investimento</p>
      <SalesExtraCardNote view={view} valueIsNull={view.roas === null} emptyText="Sem faturamento registrado pra calcular ROAS." />
    </div>
  );
}
