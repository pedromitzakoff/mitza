import Link from "next/link";
import { Fragment } from "react";
import { buildCockpitChannelHref, type CockpitViewModel } from "@/lib/cockpit-view-data";
import { VisaoGeralChannelSwitch } from "./visao-geral-channel-switch";
import { PeriodRangePicker } from "./period-range-picker";
import { CockpitBudgetCard } from "./cockpit-meta-ritmo-section";
import { CockpitResultCard, CockpitCostCard } from "./cockpit-goal-card";
import { CockpitDiagnosticsCard } from "./cockpit-diagnostics-card";
import { CockpitEvolutionSection } from "./cockpit-evolution-section";
import { CockpitGlobalFilterBar } from "./cockpit-global-filter-bar";
import { CockpitAdAccountBalance } from "./cockpit-ad-account-balance";
import { CockpitAdMetricCards } from "./cockpit-ad-metric-cards";
import { CockpitAdExplorationSection } from "./cockpit-ad-exploration-section";
import { CockpitChannelBreakdown } from "./cockpit-channel-breakdown";
import { DashboardMetricsCards } from "./dashboard-metrics-cards";
import { DataFreshnessTimer } from "./data-freshness-timer";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_BADGE_CLASSES } from "@/lib/client-fields";
import { AccountInfoDrawerLauncher } from "./account-info-drawer-launcher";
import { CockpitMobileFilterToggle } from "./cockpit-mobile-filter-toggle";

/** Glifo "infinito" da Meta — identifica o canal no cabeçalho unificado
 * (ao lado do rótulo "Meta Ads"), sempre junto do MESMO critério que já
 * decide `showMetaSection` (nunca um ícone genérico por canal — só a Meta
 * tem integração automática nesta etapa). */
function MetaGlyph() {
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" className="h-3.5 w-5 shrink-0">
      <circle cx="7" cy="8" r="5.5" fill="none" stroke="#0866FF" strokeWidth="3" />
      <circle cx="17" cy="8" r="5.5" fill="none" stroke="#0866FF" strokeWidth="3" />
    </svg>
  );
}

/**
 * Correção definitiva da divergência Dashboard interno × link compartilhado
 * (pedido explícito do usuário): única árvore visual do Cockpit, usada pelas
 * DUAS rotas (`/clients/[id]` e `/r/[token]`) — nunca uma segunda
 * implementação. Puramente apresentacional: todo campo administrativo já
 * chega `null`/`false` no `CockpitViewModel` quando o visitante é
 * compartilhado (decidido na origem, em `buildCockpitViewModel` —
 * `lib/cockpit-view-data.ts`), então este componente só precisa checar
 * `null` como faria em qualquer outro caso opcional, nunca reimplementar a
 * regra de quem pode ver o quê.
 *
 * `today`/mês atual não entram aqui — os hrefs de navegação de mês
 * (`prevMonthHref`/`nextMonthHref`) já chegam prontos do modelo.
 */
export function CockpitView({ model, today }: { model: CockpitViewModel; today: Date }) {
  return (
    <>
      {model.banners.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {model.banners.map((banner, index) => (
            <p
              key={index}
              className={
                banner.tone === "red"
                  ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  : banner.tone === "amber"
                    ? "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
              }
            >
              {banner.text}
            </p>
          ))}
        </div>
      )}

      {/* Cabeçalho unificado (Etapa "Cabeçalho unificado"): única faixa, nunca
          mais duas (antes: uma linha com saldo/frescor/links + outra, abaixo,
          com título/nome/Ver Metas — a MESMA informação espalhada em dois
          lugares). Reaproveita 100% dos dados já existentes no
          `CockpitViewModel` — nenhum cálculo novo, só reorganização visual.
          Compartilhada por `/clients/[id]` e `/r/[token]` (este componente é
          o mesmo nos dois), então a atualização chega automaticamente nos
          dois no mesmo deploy. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-overview-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <ClientAvatar name={model.clientName} imageUrl={model.clientAvatarUrl} size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-overview-text-primary">Visão executiva</h1>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[model.clientStatus]}`}>
                {CLIENT_STATUS_LABEL[model.clientStatus]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-overview-text-secondary">
              {model.clientName}
              {model.headerChannelsLabel ? ` · ${model.headerChannelsLabel}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-overview-text-muted">
          {/* Etapa "Otimizacao mobile - Fase 1": o canal ja aparece no
              subtitulo (nome + canal, sempre visivel) - este chip so
              repetiria a mesma informacao num celular que precisa do
              minimo de altura possivel, por isso fica so no desktop. */}
          {model.showMetaSection && (
            <span className="hidden items-center gap-1.5 font-medium text-overview-text-secondary lg:flex">
              <MetaGlyph />
              Meta Ads
            </span>
          )}
          <span className="flex items-center gap-1.5 lg:border-l lg:border-overview-border lg:pl-4">
            {model.adBalance && <CockpitAdAccountBalance snapshot={model.adBalance} />}
            <DataFreshnessTimer lastSuccessAt={model.dataFreshness.lastSuccessAt} />
          </span>
          {model.externalLinks.length > 0 &&
            model.externalLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                {link.label}
              </a>
            ))}
          {model.accountInfoClientId && (
            <span className="border-l border-overview-border pl-4">
              {/* Desktop: pill com texto (layout ja aprovado, intocado).
                  Mobile: so o icone (mesmo gatilho/drawer), pra nao
                  adicionar mais uma linha inteira ao cabecalho compacto. */}
              <span className="hidden lg:inline">
                <AccountInfoDrawerLauncher
                  clientId={model.accountInfoClientId}
                  triggerClassName="rounded-full border border-overview-border px-3 py-1.5 font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
                />
              </span>
              <span className="lg:hidden">
                <AccountInfoDrawerLauncher
                  clientId={model.accountInfoClientId}
                  iconOnly
                  triggerClassName="mitza-pressable flex h-8 w-8 items-center justify-center rounded-full border border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
                />
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Etapa "Seletor global de período" (pedido explícito do usuário):
            substitui o antigo trio seta/MonthSelect/seta por um único
            botão — mesmo componente/estado em qualquer tela/dispositivo
            (ver `period-range-picker.tsx`). */}
        <PeriodRangePicker basePath={model.basePath} resolved={model.periodResolved} today={today.toISOString().slice(0, 10)} />
        {/* Etapa "Visualizações independentes por canal" (pedido explícito
            do usuário): só aparece quando há de fato mais de 1 canal pra
            escolher pra este cliente — a grande maioria (1 canal só) nunca
            vê isto, o nome do canal já está no subtítulo do cabeçalho. */}
        {model.channelScopeOptions.length > 1 && (
          <VisaoGeralChannelSwitch
            options={model.channelScopeOptions}
            active={model.channelScope}
            buildHref={(channel) => buildCockpitChannelHref(model.basePath, model.monthParam, channel)}
          />
        )}
        <div className="hidden lg:block">
          <CockpitGlobalFilterBar initialText={model.filterText} initialMode={model.filterMode} />
        </div>
        <CockpitMobileFilterToggle initialText={model.filterText} initialMode={model.filterMode} isFilterActive={model.isFilterActive} />
        {model.metasHref && (
          <Link href={model.metasHref} className="ml-auto shrink-0 text-xs font-medium text-brand hover:underline">
            Ver Metas →
          </Link>
        )}
      </div>

      {/* Etapa "Otimizacao mobile - Fase 1" (pedido explicito do usuario):
          Investimento ocupa a largura toda, Resultado+Custo formam um par
          lado a lado logo abaixo - ja a partir do menor celular (375px),
          nunca so a partir de tablet. `grid-cols-2` e a base (mobile/
          tablet); o desktop aprovado (3 colunas) fica intocado em `lg:`. */}
      <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        <div className="col-span-2 lg:col-span-1">
          <CockpitBudgetCard
            headline={model.budget.headline}
            clientId={model.clientId}
            monthParam={model.monthParam}
            channels={model.budget.channels}
            canEdit={model.budget.canEdit}
            isGlobalFilterActive={model.isFilterActive}
          />
        </div>
        {model.resultCards.map(({ result, status, cost }) => (
          <Fragment key={`group-${result.resultType}-${result.channelsLabel ?? "all"}`}>
            <CockpitResultCard view={result} status={status} />
            <CockpitCostCard view={cost} />
          </Fragment>
        ))}
      </div>

      <div className="mt-3">
        <CockpitDiagnosticsCard insights={model.insights} />
      </div>

      {model.channelBreakdownRows.length > 1 && (
        <div className="mt-3">
          <CockpitChannelBreakdown rows={model.channelBreakdownRows} />
        </div>
      )}

      {model.showMetaSection && (
        <div className="mt-4">
          <p className="text-xs text-overview-text-secondary">
            Indicadores Meta Ads — resultados atribuídos pela Meta (janela de atribuição do Ads Manager), não confirmados por uma fonte de negócio
            independente.
          </p>
          <div className="mt-2">
            <CockpitAdMetricCards clientId={model.clientId} cards={model.adMetricCards} />
          </div>
        </div>
      )}

      {model.hasConfiguredDashboardMetrics && (
        <div className="mt-4">
          <p className="text-xs text-overview-text-secondary">
            Métricas exibidas
            {model.dashboardMetricsConfigHref && (
              <>
                {" "}
                — configurável em{" "}
                <Link href={model.dashboardMetricsConfigHref} className="font-medium text-brand hover:underline">
                  Cadastro do Cliente
                </Link>
              </>
            )}
            .
          </p>
          <div className="mt-2">
            <DashboardMetricsCards views={model.dashboardMetricViews} />
          </div>
        </div>
      )}

      {/* ÁREA 2 — EVOLUÇÃO DA PERFORMANCE: módulo único (SVG artesanal +
          Recharts consolidados em `cockpit-evolution-section.tsx`),
          seletor de métrica cobre tanto os objetivos (Resultado/Custo/
          Investimento, por dia) quanto as métricas Meta Ads (impressões,
          CTR, CPM, ROAS...). */}
      <div className="mt-8">
        <CockpitEvolutionSection
          clientId={model.clientId}
          series={model.evolution.series}
          defaultLeftId={model.evolution.defaultLeftId}
          defaultRightId={model.evolution.defaultRightId}
          freshness={model.evolution.freshness}
          emptyMessage={model.evolution.emptyMessage}
        />
      </div>

      {/* ÁREA 3 — CAMPANHAS, CONJUNTOS E ANÚNCIOS: seção ampla e
          prioritária (pedido explícito do usuário), drill-down completo na
          MESMA tela, mesma largura das demais áreas. */}
      {model.adExploration && (
        <div className="mt-8">
          <h2 className="text-base font-medium text-overview-text-primary">Campanhas, conjuntos e anúncios</h2>
          <div className="mt-3">
            <CockpitAdExplorationSection
              clientId={model.clientId}
              campaigns={model.adExploration.campaigns}
              adSetDailyRows={model.adExploration.adSetDailyRows}
              creativeDailyRows={model.adExploration.creativeDailyRows}
            />
          </div>
        </div>
      )}
    </>
  );
}
