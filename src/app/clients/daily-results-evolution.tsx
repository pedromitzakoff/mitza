import { formatDayShortMonth } from "@/lib/format";
import { computeDailyResultStats, type DailyResultSeries } from "@/lib/daily-results";

/** "7", "4,5" — mesma régua em toda a seção (Hoje/Ontem/Média/barras): nunca
 * mais de 1 casa decimal, vírgula pt-BR. Sem casa decimal fabricada num
 * valor inteiro (7 -> "7", nunca "7,0"). */
function formatCount(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

const BAR_MAX_HEIGHT_PX = 40;
const BAR_MIN_HEIGHT_PX = 3;

/**
 * "Evolução diária de resultados" — sub-bloco dentro do card já existente
 * "ACOMPANHAMENTO DA CONTA" (`AccountFollowUpPanel`), logo abaixo da grade
 * de KPIs mensais. Responde uma pergunta DIFERENTE da grade acima
 * ("quantos resultados no mês, até agora") — "quantos resultados por dia,
 * recentemente, e a velocidade está mudando" — nunca a mesma informação
 * repetida: a grade mostra o total do mês, este bloco mostra a granularidade
 * diária que não existia em lugar nenhum da Visão Geral antes desta etapa.
 *
 * Sem gráfico de biblioteca (pedido explícito do usuário: "não instalar
 * biblioteca só pra isso") — 7 barras de `<div>` puro, escala linear pelo
 * maior valor da própria janela, altura mínima visível mesmo em 0 (pra um
 * dia zerado nunca parecer "sumido" da sequência). Nunca mostra
 * recomendação/classificação de tendência (`acelerando`/`desacelerando`) —
 * só os números, a leitura é do gestor.
 */
export function DailyResultsEvolution({
  series,
  targetResultCount,
  expectedToDate,
  monthResultCount,
}: {
  series: DailyResultSeries;
  /** Meta de quantidade vigente pro mês selecionado — `null` = sem meta
   * configurada (nunca mostra "X/undefined"). */
  targetResultCount: number | null;
  /** `computeMonthlyExpectedToDateByCalendar` aplicado à meta de resultado —
   * mesma lógica temporal já usada pro investimento, nunca uma segunda
   * fórmula. Só relevante quando `targetResultCount` existe. */
  expectedToDate: number | null;
  /** Realizado do mês selecionado — já calculado por quem chama
   * (`summary.resultCount`), nunca recomputado aqui. */
  monthResultCount: number;
}) {
  if (series.kind === "unavailable") {
    return (
      <div className="mt-3 border-t border-overview-border pt-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Evolução diária</p>
        <p className="mt-1 text-xs text-overview-text-secondary">Sem dados diários disponíveis para este cliente.</p>
      </div>
    );
  }

  const { points } = series;
  const stats = computeDailyResultStats(points);
  const maxValue = Math.max(...points.map((p) => p.resultCount), 1);
  const todayDate = points[points.length - 1].date;

  return (
    <div className="mt-3 border-t border-overview-border pt-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Evolução diária</p>

      {targetResultCount !== null && expectedToDate !== null && (
        <p className="mt-1 text-xs text-overview-text-secondary">
          <span className="font-semibold text-overview-text-primary">
            {formatCount(monthResultCount)}/{formatCount(targetResultCount)}
          </span>{" "}
          · Esperado até hoje: {formatCount(expectedToDate)}
        </p>
      )}

      <div className="mt-2 flex items-end gap-1.5">
        {points.map((point) => {
          const isToday = point.date === todayDate;
          const heightPx = Math.max((point.resultCount / maxValue) * BAR_MAX_HEIGHT_PX, BAR_MIN_HEIGHT_PX);
          return (
            <div key={point.date} className="flex flex-1 flex-col items-center gap-0.5">
              <span className="text-[10px] font-medium text-overview-text-muted">{formatCount(point.resultCount)}</span>
              <div className="flex h-[40px] w-full items-end">
                <div
                  className={`w-full rounded-sm ${isToday ? "bg-brand" : "bg-overview-brand-subtle"}`}
                  style={{ height: `${heightPx}px` }}
                />
              </div>
              <span className={`text-[10px] ${isToday ? "font-semibold text-brand" : "text-overview-text-muted"}`}>
                {isToday ? "Hoje" : formatDayShortMonth(point.date)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 text-xs text-overview-text-secondary">
        Hoje {formatCount(stats.today)} · Ontem {formatCount(stats.yesterday)} · Média 7d {formatCount(stats.average7d)}/dia
      </p>
    </div>
  );
}
