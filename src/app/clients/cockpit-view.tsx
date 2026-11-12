import Link from "next/link";
import { Fragment } from "react";
import { buildCockpitMonthHref, type CockpitViewModel } from "@/lib/cockpit-view-data";
import { MonthSelect } from "./month-select";
import { IconButton } from "@/components/workspace/button";
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

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {model.adBalance && <CockpitAdAccountBalance snapshot={model.adBalance} />}
        <DataFreshnessTimer lastSuccessAt={model.dataFreshness.lastSuccessAt} />
        {model.externalLinks.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            {model.externalLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-overview-text-secondary hover:underline"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-overview-text-primary">Visão executiva</h1>
          <p className="mt-0.5 text-sm text-overview-text-secondary">
            {model.clientName}
            {model.headerChannelsLabel ? ` · ${model.headerChannelsLabel}` : ""}
          </p>
        </div>
        {model.metasHref && (
          <Link href={model.metasHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
            Ver Metas →
          </Link>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <IconButton href={model.prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <MonthSelect today={today} selectedMonthParam={model.monthParam} buildHref={(value) => buildCockpitMonthHref(model.basePath, value)} />
          <IconButton href={model.nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <CockpitGlobalFilterBar initialText={model.filterText} initialMode={model.filterMode} />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CockpitBudgetCard
          headline={model.budget.headline}
          clientId={model.clientId}
          monthParam={model.monthParam}
          channels={model.budget.channels}
          canEdit={model.budget.canEdit}
          isGlobalFilterActive={model.isFilterActive}
        />
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
