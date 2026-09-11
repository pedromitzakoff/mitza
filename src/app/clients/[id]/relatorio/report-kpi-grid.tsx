import type { AnalyticsKpiCard, AnalyticsKpiComparisonTone } from "@/lib/analytics";
import type { PerformanceReportHero, PerformanceReportSummaryBlock } from "@/lib/performance-report/report-document";

/**
 * Resumo do período — Etapa "Visual Polish Mobile": desktop preservado
 * PIXEL A PIXEL (a mesma grade de 4 cards com o KPI de destaque em fundo
 * grafite, só agora atrás de `hidden sm:block`) — o pedido explícito desta
 * rodada foi "não redesenhe o desktop". O mobile (`sm:hidden`, componentes
 * abaixo) é uma composição nova: resultado principal (`hero`) com
 * protagonismo tipográfico real, métricas secundárias em linhas de 2 sem
 * card/borda própria, e a grande superfície `#17171A` removida — ela
 * dominava o primeiro viewport mais do que a identidade KOFF pede (creme/
 * areia = superfície, grafite = só tipografia/contraste, nunca uma massa
 * inteira). Nenhum valor é recalculado aqui — `hero`/`summary.kpis` já
 * chegam prontos de `report-document.ts`.
 */
export function ReportKpiGrid({ summary, hero }: { summary: PerformanceReportSummaryBlock; hero: PerformanceReportHero | null }) {
  if (summary.status !== "ok") {
    return <p className="pt-2 text-sm text-[#6F6B65]">{summary.message}</p>;
  }

  return (
    <>
      <MobileSummary kpis={summary.kpis} hero={hero} />
      <DesktopSummary kpis={summary.kpis} note={summary.note} hero={hero} />
    </>
  );
}

/**
 * Ordem editorial das métricas secundárias (tudo que não é o resultado
 * principal, já virado `hero`) — CPA/CPL primeiro (a pergunta mais
 * imediata depois do resultado: "a que custo?"), ROAS ao lado quando
 * existe, Receita e Investimento juntos (dinheiro que saiu vs. que
 * entrou), Ticket médio por último. Puramente uma ordem de APRESENTAÇÃO:
 * `summary.kpis` já vem calculado por `buildAnalyticsKpiCards` — isto só
 * escolhe em que posição cada card (quando existe) aparece no mobile,
 * nunca recalcula nada. "result" nunca aparece aqui — virou o `hero`.
 */
const SECONDARY_KPI_ORDER = ["cost", "roas", "revenue", "investment", "averageTicket"] as const;

function orderSecondaryKpis(kpis: AnalyticsKpiCard[]): AnalyticsKpiCard[] {
  const byKey = new Map(kpis.map((kpi) => [kpi.key, kpi]));
  return SECONDARY_KPI_ORDER.map((key) => byKey.get(key)).filter((kpi): kpi is AnalyticsKpiCard => kpi !== undefined);
}

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

/** Verde-limão só quando a variação vs. meta é `positive` (mesma
 * classificação de `getPerformanceStatus`/`comparison.tone` — nunca uma
 * segunda régua de "isso é bom?"). `negative` fica em grafite, nunca uma
 * cor de alerta nova (a paleta KOFF não tem vermelho/laranja de
 * semáforo) — só mais peso visual, sem virar aviso. */
function ComparisonNote({ comparison }: { comparison: { text: string; tone: AnalyticsKpiComparisonTone } }) {
  if (comparison.tone === "positive") {
    return <span className="inline-block rounded-full bg-[#D8F238] px-2 py-0.5 text-[11px] font-bold text-[#17171A]">{comparison.text}</span>;
  }
  return (
    <span className={`text-[11px] font-semibold ${comparison.tone === "negative" ? "text-[#17171A]" : "text-[#6F6B65]"}`}>{comparison.text}</span>
  );
}

function SecondaryMetricRow({ kpis }: { kpis: AnalyticsKpiCard[] }) {
  const withComparison = kpis.filter((kpi): kpi is AnalyticsKpiCard & { comparison: NonNullable<AnalyticsKpiCard["comparison"]> } => Boolean(kpi.comparison));
  return (
    <div>
      <div className="flex gap-6">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="min-w-0 flex-1">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-[#17171A]">{kpi.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#6F6B65]">{kpi.label}</div>
          </div>
        ))}
      </div>
      {withComparison.map((kpi) => (
        <div key={kpi.key} className="mt-1.5">
          <ComparisonNote comparison={kpi.comparison} />
        </div>
      ))}
    </div>
  );
}

/** Composição editorial nova — item 4 do pedido: "reduzir fortemente a
 * sensação de cards independentes". Nenhuma métrica secundária ganha
 * borda/fundo própria; a única divisória visual fica entre a 1ª linha
 * (CPA/ROAS, a leitura de eficiência) e o resto (Receita/Investimento/
 * Ticket médio, a leitura financeira) — a MESMA distinção que já existe
 * nos dados (custo por resultado vs. dinheiro bruto), nunca decorativa. */
function MobileSummary({ kpis, hero }: { kpis: AnalyticsKpiCard[]; hero: PerformanceReportHero | null }) {
  const secondary = orderSecondaryKpis(kpis);
  const rows = chunkPairs(secondary);

  return (
    <div className="sm:hidden">
      {hero && (
        <div>
          <div className="text-[52px] font-extrabold leading-[0.9] tracking-tight text-[#17171A]">{hero.value}</div>
          <div className="mt-1 text-base font-semibold text-[#6F6B65]">{hero.label}</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className={`flex flex-col gap-4 ${hero ? "mt-6" : ""}`}>
          <SecondaryMetricRow kpis={rows[0]} />
          {rows.length > 1 && <div className="h-px bg-[#D9D3C9]" aria-hidden="true" />}
          {rows.slice(1).map((row, index) => (
            <SecondaryMetricRow key={index} kpis={row} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Desktop — mesma grade de cards de sempre (destaque em fundo grafite,
 * demais em branco). Correção pontual: `summary.kpis` nunca inclui uma
 * métrica "result" pra objetivo `sales` (`buildAnalyticsKpiCards` só monta
 * investimento/ROAS/custo/receita/ticket médio pra esse objetivo — o total
 * de vendas nunca tinha card próprio aqui, só no mobile via `hero`) — o
 * card do resultado (`hero`, já calculado em `report-document.ts` a partir
 * de `PerformanceSummary.resultCount`, mesmo dado usado pelo mobile) entra
 * logo depois de "Investimento", na mesma posição em que `leads`/`followers`
 * já mostravam "Resultado" (`kpis[1]`, antes desta correção) — nunca
 * duplicado quando esse card já existe. Resto do layout (card de destaque,
 * radius, nota de metodologia) inalterado. */
function DesktopSummary({ kpis, note, hero }: { kpis: AnalyticsKpiCard[]; note: string; hero: PerformanceReportHero | null }) {
  const hasResultCard = kpis.some((kpi) => kpi.key === "result");
  const cards: AnalyticsKpiCard[] =
    hero && !hasResultCard
      ? [kpis[0], { key: "result", label: hero.label, value: hero.value }, ...kpis.slice(1)].filter(
          (kpi): kpi is AnalyticsKpiCard => kpi !== undefined,
        )
      : kpis;

  return (
    <div className="hidden sm:block">
      <div className="grid grid-cols-4 gap-3.5">
        {cards.map((kpi, index) => {
          const isAccent = index === 0;
          return (
            <div
              key={kpi.key}
              className={
                isAccent
                  ? "min-h-[110px] rounded-2xl border border-[#17171A] bg-[#17171A] p-5"
                  : "min-h-[110px] rounded-2xl border border-[#D9D3C9] bg-white p-5"
              }
            >
              <div className={`text-xs font-bold ${isAccent ? "text-[#B9B9BA]" : "text-[#6F6B65]"}`}>{kpi.label}</div>
              <div className={`mt-2.5 text-[28px] font-extrabold tracking-tight ${isAccent ? "text-white" : "text-[#17171A]"}`}>{kpi.value}</div>
              {kpi.comparison && <div className={`mt-2 text-xs ${isAccent ? "text-[#BCBCBD]" : "text-[#6F6B65]"}`}>{kpi.comparison.text}</div>}
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-l-[3px] border-[#C8BEAD] bg-white/60 px-4 py-3 text-xs text-[#6F6B65]">{note}</p>
    </div>
  );
}
