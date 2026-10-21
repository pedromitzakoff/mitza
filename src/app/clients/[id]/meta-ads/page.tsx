import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod } from "@/lib/analytics";
import { buildMetaAdsDashboardData } from "@/lib/meta-ads-dashboard/dashboard-data";
import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import { DataFreshnessTimer } from "../../data-freshness-timer";
import { WORKSPACE_CONTENT_MAX_WIDTH_CLASS } from "../../workspace-container";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.1 (Fundação) —
 * `/clients/[id]/meta-ads`: dashboard principal de mídia paga do cliente,
 * decisão 1 do usuário ("Criar `/clients/[id]/meta-ads` como dashboard
 * principal de mídia paga do cliente, preservando a rota de Relatório para
 * PDFs e compartilhamento"). Rota NOVA e independente de `/relatorio` — não
 * reaproveita `report-data.ts`/`report-document.ts` (esses continuam
 * servindo só o documento/PDF/link externo, intocados); usa a camada de
 * dados própria deste dashboard (`lib/meta-ads-dashboard/dashboard-data.ts`).
 *
 * Esta etapa é deliberadamente só a FUNDAÇÃO: prova que a rota, a consulta e
 * a comparação de período funcionam de ponta a ponta, sem ainda construir a
 * apresentação final (cards de KPI configuráveis, gráficos interativos,
 * tabelas por nível com seleção de coluna) — essas chegam nas etapas 2.2+
 * do plano aprovado. Alcance/frequência de período (pedido do usuário:
 * nunca somar alcance diário) ainda não têm UI — `comparison`/`reach` já
 * carregam o contrato correto (`reach: null` nesta etapa), documentado em
 * `dashboard-data.ts`.
 */
export default async function ClientMetaAdsDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) console.error(`[ClientMetaAdsDashboardPage] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  const today = todayDateString();
  const period = resolveAnalyticsPeriod("this_month", today);

  const data = await buildMetaAdsDashboardData(supabase, id, period);
  if (!data) notFound();

  const { comparison } = data;

  return (
    <div className={`mx-auto w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} px-4 py-4 sm:px-6 sm:py-6 lg:px-10`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17171A]">Meta Ads</h1>
          <p className="mt-0.5 text-sm text-[#6F6B65]">Mês atual — comparado ao período anterior de mesma duração.</p>
        </div>
        {/* Pedido do usuário: exibir a última sincronização e nunca
            apresentar a atualização como instantânea — mesmo componente já
            usado no Cockpit, nenhum segundo cálculo de frescor. */}
        <DataFreshnessTimer lastSuccessAt={data.lastSyncAt} />
      </div>

      <div className="mt-5 rounded-lg bg-[#EFE9E0] px-3.5 py-4 sm:rounded-2xl sm:border sm:border-[#D9D3C9] sm:px-8 sm:py-6">
        {/* Pedido do usuário: diferenciar métricas atribuídas pela Meta de
            resultados gerais do negócio — rótulo explícito, sempre visível
            junto do número de resultado (nunca só numa legenda distante). */}
        <p className="text-xs text-[#6F6B65]">
          Resultados atribuídos pela Meta (janela de atribuição do Ads Manager) — não confirmados por uma fonte de negócio independente.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <DashboardStat label="Investimento" value={formatCurrency(comparison.current.totals.spend)} changePct={comparison.spendChangePct} />
          <DashboardStat label="Impressões" value={formatCount(comparison.current.totals.impressions)} />
          <DashboardStat label="Cliques" value={formatCount(comparison.current.totals.clicks)} />
          <DashboardStat label="Resultados" value={formatCount(comparison.current.totals.resultCount)} changePct={comparison.resultCountChangePct} />
          <DashboardStat label="CPM" value={comparison.current.derived.cpm !== null ? formatCurrency(comparison.current.derived.cpm) : "—"} />
          <DashboardStat
            label="CTR"
            value={comparison.current.derived.ctr !== null ? formatPercent(comparison.current.derived.ctr * 100) : "—"}
          />
          <DashboardStat label="CPC" value={comparison.current.derived.cpc !== null ? formatCurrency(comparison.current.derived.cpc) : "—"} />
          <DashboardStat label="ROAS" value={comparison.current.derived.roas !== null ? `${comparison.current.derived.roas.toFixed(2)}x` : "—"} />
        </dl>

        {/* Pedido do usuário: alcance/frequência nunca somados a partir do
            alcance diário — esta etapa ainda não busca o valor correto
            (consulta de período inteiro, `fetchMetaApiPeriodReach`), então
            documenta a limitação em vez de esconder ou fabricar o número. */}
        <p className="mt-4 text-xs text-[#6F6B65]">
          Alcance e frequência exigem uma consulta própria à Meta pelo período inteiro (nunca soma de alcance diário) — ainda não conectados nesta
          etapa da Fundação.
        </p>
      </div>
    </div>
  );
}

function DashboardStat({ label, value, changePct }: { label: string; value: string; changePct?: number | null }) {
  return (
    <div className="min-h-[90px] rounded-xl border border-[#D9D3C9] bg-white p-4">
      <div className="text-xs font-bold text-[#6F6B65]">{label}</div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-[#17171A] tabular-nums">{value}</div>
      {changePct !== undefined && changePct !== null && (
        <div className="mt-1 text-xs text-[#6F6B65]">
          {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(1)}% vs. período anterior
        </div>
      )}
    </div>
  );
}
