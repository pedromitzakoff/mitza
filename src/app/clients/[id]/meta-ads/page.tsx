import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildMetaAdsDashboardData } from "@/lib/meta-ads-dashboard/dashboard-data";
import { buildMetricCardViewModels } from "@/lib/meta-ads-dashboard/metric-cards";
import { formatDateRange } from "@/lib/format";
import { DataFreshnessTimer } from "../../data-freshness-timer";
import { WORKSPACE_CONTENT_MAX_WIDTH_CLASS } from "../../workspace-container";
import { MetaAdsPeriodControl } from "./period-control";
import { MetricCardsPanel } from "./metric-cards-panel";
import { EvolutionSection } from "./evolution-section";

/**
 * MITZA ONE — KOFF Analytics Fase 2 — `/clients/[id]/meta-ads`, decisão 1
 * da Fase 2: dashboard principal de mídia paga do cliente, independente de
 * `/relatorio` (PDF/link externo, intocado).
 *
 * - `preset`/`start`/`end` na URL (vocabulário PRÓPRIO desta rota, nunca
 *   `analyticsPreset`/`analyticsStart`/`analyticsEnd` do Relatório) são a
 *   ÚNICA fonte de verdade do período em exibição — refresh/back/forward
 *   sempre reproduzem exatamente o mesmo período, mesma disciplina do resto
 *   da MITZA. Toda troca de período (`MetaAdsPeriodControl`) navega pra
 *   ESTA MESMA rota, nunca pra fora ("experiência de página única").
 * - `buildMetaAdsDashboardData` busca TUDO de uma vez (período atual e
 *   anterior: investimento/resultado/alcance/frequência/séries diárias),
 *   então cards E gráficos sempre respeitam o MESMO período selecionado,
 *   com a MESMA comparação — nenhuma segunda consulta.
 * - Ordem da tela (Etapa 2.3, pedido explícito do usuário): filtros globais
 *   → cards de KPI (`MetricCardsPanel`) → gráficos de evolução
 *   (`EvolutionSection`) → futura exploração de campanhas/conjuntos/
 *   anúncios (ainda não implementada, próxima etapa).
 */
export default async function ClientMetaAdsDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const { id } = await params;
  const { preset: presetParam, start: startParam, end: endParam } = await searchParams;
  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) console.error(`[ClientMetaAdsDashboardPage] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  const today = todayDateString();
  const activePreset = (presetParam ?? "this_month") as AnalyticsPeriodPreset;
  const period = resolveAnalyticsPeriod(presetParam, today, { start: startParam, end: endParam });

  const data = await buildMetaAdsDashboardData(supabase, id, period);
  if (!data) notFound();

  const cards = buildMetricCardViewModels(data);

  return (
    <div className={`mx-auto w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} px-4 py-4 sm:px-6 sm:py-6 lg:px-10`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17171A]">Meta Ads</h1>
          <p className="mt-0.5 text-sm text-[#6F6B65]">{formatDateRange(period.start, period.end)} — comparado ao período anterior de mesma duração.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MetaAdsPeriodControl clientId={id} activePreset={activePreset} customStart={period.start} customEnd={period.end} today={today} />
          {/* Pedido do usuário: exibir a última sincronização e nunca
              apresentar a atualização como instantânea — mesmo componente
              já usado no Cockpit, nenhum segundo cálculo de frescor. */}
          <DataFreshnessTimer lastSuccessAt={data.lastSyncAt} />
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
        {/* Pedido do usuário: diferenciar métricas atribuídas pela Meta de
            resultados gerais do negócio — rótulo explícito, sempre visível
            junto dos cards de resultado (nunca só numa legenda distante). */}
        <p className="text-xs text-[#6F6B65]">
          Resultados atribuídos pela Meta (janela de atribuição do Ads Manager) — não confirmados por uma fonte de negócio independente.
        </p>

        <div className="mt-4">
          <MetricCardsPanel clientId={id} cards={cards} />
        </div>

        <EvolutionSection series={data.evolution} />
      </div>
    </div>
  );
}
