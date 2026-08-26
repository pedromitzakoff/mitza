import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import {
  aggregatePerformanceResults,
  computeCostPerResult,
  type PerformanceRecordRow,
  type PerformanceStatus,
  type PerformanceSummary,
} from "@/lib/performance";
import { computePercentChange } from "@/lib/period-comparison";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";

/**
 * Lógica pura do MVP de Analytics (aba dentro do cliente, nunca visível na
 * visão global da agência) — mesmo princípio central do pedido do usuário:
 * UMA estrutura única, que recebe as métricas disponíveis e decide o que
 * renderizar; nenhum `if (objective === "leads") return <LeadsDashboard />`
 * em lugar nenhum. Reaproveita 100% do núcleo de performance já existente
 * (`lib/performance.ts`, `lib/performance-goals.ts`) — nenhum cálculo de
 * custo/ROAS/agregação é reimplementado aqui.
 */

export type AnalyticsPeriodPreset = "last_7_days" | "last_30_days" | "this_month" | "last_month" | "custom";

export const ANALYTICS_PERIOD_PRESET_OPTIONS: { value: Exclude<AnalyticsPeriodPreset, "custom">; label: string }[] = [
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
];

export interface AnalyticsPeriod {
  start: string;
  end: string;
}

function lastNDaysRange(today: string, days: number): AnalyticsPeriod {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: today };
}

function monthRange(year: number, month: number): AnalyticsPeriod {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return { start: firstDay.toISOString().slice(0, 10), end: lastDay.toISOString().slice(0, 10) };
}

/**
 * Resolve o período do Analytics a partir do preset da URL — SEMPRE
 * independente de sprint (pedido explícito do usuário: "não vincular o
 * Analytics a uma sprint"). "custom" exige as duas datas preenchidas (o
 * formulário de período personalizado só submete com elas); qualquer preset
 * desconhecido ou ausente cai no padrão ("this_month"), nunca lança erro.
 */
export function resolveAnalyticsPeriod(
  preset: string | undefined,
  today: string,
  custom?: { start?: string; end?: string },
): AnalyticsPeriod {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const year = todayDate.getUTCFullYear();
  const month = todayDate.getUTCMonth();

  switch (preset) {
    case "last_7_days":
      return lastNDaysRange(today, 7);
    case "last_30_days":
      return lastNDaysRange(today, 30);
    case "last_month":
      return monthRange(year, month - 1);
    case "custom":
      if (custom?.start && custom?.end && custom.end >= custom.start) return { start: custom.start, end: custom.end };
      return monthRange(year, month);
    case "this_month":
    default:
      return monthRange(year, month);
  }
}

export type AnalyticsKpiComparisonTone = "positive" | "negative" | "neutral";

export interface AnalyticsKpiComparison {
  text: string;
  tone: AnalyticsKpiComparisonTone;
}

export interface AnalyticsKpiCard {
  key: string;
  label: string;
  value: string;
  /** Linha auxiliar de contexto — variação vs. período anterior OU meta
   * configurada (nunca as duas juntas no mesmo card). `null`/ausente = sem
   * base de comparação real (nunca fabricada). */
  comparison?: AnalyticsKpiComparison | null;
}

/** Constrói a linha "↑18% vs período anterior" — `direction` decide se um
 * aumento é bom (`higher_is_better`, ex.: ROAS/resultado/receita), ruim
 * (`lower_is_better`, ex.: custo por resultado) ou nem uma coisa nem outra
 * (`neutral`, ex.: investimento — gastar mais/menos não é em si bom ou
 * ruim). `null` sempre que não há período anterior comparável (mesma regra
 * de `computePercentChange`: nunca uma variação fabricada). */
function buildPercentChangeComparison(
  current: number,
  previous: number | null,
  direction: "higher_is_better" | "lower_is_better" | "neutral",
): AnalyticsKpiComparison | null {
  const percentChange = computePercentChange(current, previous);
  if (percentChange === null) return null;

  const symbol = percentChange >= 0 ? "↑" : "↓";
  const tone: AnalyticsKpiComparisonTone =
    direction === "neutral" ? "neutral" : direction === "higher_is_better" ? (percentChange >= 0 ? "positive" : "negative") : percentChange <= 0 ? "positive" : "negative";

  return { text: `${symbol}${Math.abs(percentChange).toFixed(0)}% vs período anterior`, tone };
}

/**
 * Cards de KPI — Etapa "Analytics Instagramável": lista curta e EXPLÍCITA por
 * objetivo (pedido direto do usuário — "poucas informações muito bem
 * apresentadas", nunca uma dezena de cards). Investimento aparece sempre (é
 * o único KPI comum a todo objetivo, sempre o primeiro); os demais são
 * exatamente os indicadores que o usuário definiu como relevantes por
 * objetivo — nunca um card a mais mostrando um dado que já está no Hero
 * (por isso "Vendas"/contagem bruta não aparece aqui pra `sales`: ROAS +
 * CPA + Receita já contam essa história, e a contagem em si já é o Hero
 * quando não há receita configurada). Métrica indisponível vira "—", nunca
 * um card removido (a ausência do dado é informação: mostra que existe uma
 * lacuna, não esconde o card inteiro).
 *
 * Facelift "Analytics Instagramável": cada card ganha uma linha de contexto
 * (variação vs. período anterior, ou "Meta: R$X" quando configurada) —
 * reaproveita 100% dado que já existe (`previousSummary`, já buscado pro
 * Hero; `targetCostPerResult`, já dentro de `summary`), nenhuma consulta
 * nova. Meta tem prioridade sobre variação pro card de custo — é a
 * comparação mais acionável pro gestor quando existe.
 */
export function buildAnalyticsKpiCards(
  goal: PerformanceGoal | null,
  actualSpend: number,
  summary: PerformanceSummary | null,
  previousSummary: PerformanceSummary | null,
  formatCurrencyValue: (value: number) => string,
): AnalyticsKpiCard[] {
  const investment: AnalyticsKpiCard = {
    key: "investment",
    label: "Investimento",
    value: formatCurrencyValue(actualSpend),
    comparison: buildPercentChangeComparison(actualSpend, previousSummary?.actualSpend ?? null, "neutral"),
  };
  if (!goal || !summary || !summary.hasAnyRecord) return [investment];

  const config = PERFORMANCE_GOALS[goal];

  const costComparison: AnalyticsKpiComparison | null =
    summary.targetCostPerResult !== null
      ? { text: `Meta: ${formatCurrencyValue(summary.targetCostPerResult)}`, tone: "neutral" }
      : summary.costPerResult !== null
        ? buildPercentChangeComparison(summary.costPerResult, previousSummary?.costPerResult ?? null, "lower_is_better")
        : null;

  const cost: AnalyticsKpiCard = {
    key: "cost",
    label: config.costMetricShortLabel,
    value: summary.costPerResult !== null ? formatCurrencyValue(summary.costPerResult) : "—",
    comparison: costComparison,
  };

  if (goal === "sales") {
    return [
      investment,
      {
        key: "roas",
        label: "ROAS",
        value: summary.roas !== null ? `${summary.roas.toFixed(2)}x` : "—",
        comparison: summary.roas !== null ? buildPercentChangeComparison(summary.roas, previousSummary?.roas ?? null, "higher_is_better") : null,
      },
      cost,
      {
        key: "revenue",
        label: "Receita",
        value: summary.revenue !== null ? formatCurrencyValue(summary.revenue) : "—",
        comparison: summary.revenue !== null ? buildPercentChangeComparison(summary.revenue, previousSummary?.revenue ?? null, "higher_is_better") : null,
      },
      // Etapa "Visão Geral: decisão em 5 segundos": Ticket médio saiu da
      // Visão Geral (era ruído numa tela pensada pra decisão em 5 segundos)
      // e passou a viver só aqui — Analytics é a tela de investigação, o
      // lugar certo pra mais um dado de contexto sobre a mesma receita já
      // mostrada acima. Mesmo valor de sempre (`PerformanceSummary.averageTicket`),
      // nenhum cálculo novo.
      {
        key: "averageTicket",
        label: "Ticket médio",
        value: summary.averageTicket !== null ? formatCurrencyValue(summary.averageTicket) : "—",
        comparison:
          summary.averageTicket !== null
            ? buildPercentChangeComparison(summary.averageTicket, previousSummary?.averageTicket ?? null, "higher_is_better")
            : null,
      },
    ];
  }

  return [
    investment,
    {
      key: "result",
      label: config.resultMetricLabel,
      value: String(summary.resultCount),
      comparison: buildPercentChangeComparison(summary.resultCount, previousSummary?.resultCount ?? null, "higher_is_better"),
    },
    cost,
  ];
}

export interface AnalyticsChannelRow {
  channel: TrafficChannel;
  spend: number;
  resultCount: number;
  costPerResult: number | null;
  revenue: number | null;
}

/**
 * Detalhamento por CANAL (Meta/Google/etc.) — granularidade mais alta que
 * campanha/criativo (essas duas hoje vivem em `ad_creative_daily_metrics`,
 * ver `lib/creative-analytics.ts`/`lib/campaign-analytics.ts` e as
 * sub-seções Criativos/Campanhas do hub). Este agregado por canal continua
 * existindo só como INSUMO da frase de concentração de canal em
 * `buildLearningsNarrative` (ex.: "o Meta concentrou X% do investimento") —
 * Etapa "Resumo Executivo" removeu a tabela visual por canal do Resumo
 * (Capítulo antigo "Onde aconteceu?"), porque a sub-seção Campanhas já
 * responde essa pergunta com muito mais profundidade. Só inclui canais com
 * pelo menos investimento ou resultado real registrado no período (nunca
 * uma linha "zerada" por completo).
 *
 * `instagram` nunca entra aqui (Etapa Integração Instagram) — é uma fonte
 * de RESULTADO orgânico, nunca um canal de investimento próprio; uma linha
 * "Instagram: R$0,00 por seguidor" seria enganosa (o investimento real que
 * cruza com esse resultado é de outro canal, Meta Ads — ver
 * `resolvePerformanceSummaryForGoal`, `lib/instagram-metrics.ts`). O
 * cruzamento cross-fonte aparece só nos cards de KPI do topo, nunca nesta
 * tabela por canal (que assume implicitamente "mesmo canal investe e
 * gera o resultado").
 */
export function buildAnalyticsChannelRows(
  goal: PerformanceGoal,
  records: PerformanceRecordRow[],
  spendByChannel: Partial<Record<TrafficChannel, number>>,
): AnalyticsChannelRow[] {
  const channelsWithData = new Set<TrafficChannel>();
  for (const record of records) {
    if (record.resultType === goal && record.channel !== "instagram") channelsWithData.add(record.channel);
  }
  for (const channel of Object.keys(spendByChannel) as TrafficChannel[]) {
    if (channel !== "instagram" && (spendByChannel[channel] ?? 0) > 0) channelsWithData.add(channel);
  }

  return Array.from(channelsWithData)
    .map((channel): AnalyticsChannelRow => {
      const spend = spendByChannel[channel] ?? 0;
      const aggregated = aggregatePerformanceResults(records, goal, channel);
      return {
        channel,
        spend,
        resultCount: aggregated.resultCount,
        costPerResult: computeCostPerResult(spend, aggregated.resultCount, aggregated.hasAnyRecord),
        revenue: aggregated.revenue,
      };
    })
    .sort((a, b) => b.resultCount - a.resultCount);
}

export interface AnalyticsHero {
  /** Já formatado ("438", "R$ 247.000") — nunca um número bruto. */
  value: string;
  label: string;
  /** Variação vs. período anterior de mesma duração — `null` quando não há
   * base anterior confiável pra comparar (sem dado no período anterior, ou
   * período anterior zerado/negativo): nunca uma seta fabricada. */
  percentChange: number | null;
}

/**
 * Métrica principal do Hero — Etapa "Analytics Instagramável": UM número
 * central por objetivo (pedido explícito: "a métrica principal deve
 * depender do objetivo da conta", nunca uma lista). Pra `sales` com receita
 * configurada, o destaque é o faturamento (o exemplo do usuário: "R$
 * 247.000 em vendas"); sem receita mapeada, cai pra contagem de vendas —
 * nunca finge ter receita que a integração não fornece.
 */
export function buildAnalyticsHero(input: {
  goal: PerformanceGoal;
  summary: PerformanceSummary;
  /** Resumo do mesmo cálculo pro período anterior de mesma duração — `null`
   * quando ainda não há essa consulta feita (nunca inventa comparação). */
  previousSummary: PerformanceSummary | null;
  formatCurrencyValue: (value: number) => string;
}): AnalyticsHero {
  const { goal, summary, previousSummary, formatCurrencyValue } = input;
  const config = PERFORMANCE_GOALS[goal];

  if (!summary.hasAnyRecord) {
    return { value: "—", label: config.resultMetricLabel, percentChange: null };
  }

  const usesRevenue = goal === "sales" && summary.revenue !== null;
  const currentValue = usesRevenue ? summary.revenue! : summary.resultCount;
  const previousValue = !previousSummary ? null : usesRevenue ? previousSummary.revenue : previousSummary.resultCount;

  return {
    value: usesRevenue ? formatCurrencyValue(currentValue) : String(currentValue),
    label: usesRevenue ? "em vendas" : config.resultMetricLabel,
    percentChange: computePercentChange(currentValue, previousValue),
  };
}

/**
 * Capítulo I do relatório ("Como foi o resultado?") — Etapa "Analytics como
 * Relatório": manchete em prosa em vez de um número isolado. Sem base de
 * comparação real (`hero.percentChange === null`) ou sem nenhum registro no
 * período (`hasAnyRecord === false`), cai num enunciado neutro — nunca
 * afirma "cresceu"/"caiu" sem uma base real por trás.
 */
export function buildResultHeadline(goal: PerformanceGoal, hero: AnalyticsHero, hasAnyRecord: boolean): string {
  const config = PERFORMANCE_GOALS[goal];
  if (!hasAnyRecord || hero.percentChange === null) return `${config.resultMetricLabel} no período`;
  const direction = hero.percentChange >= 0 ? "cresceram" : "caíram";
  return `${config.resultMetricLabel} ${direction} ${Math.abs(hero.percentChange).toFixed(0)}% no período`;
}

/** Lide do Capítulo I — a frase logo abaixo da manchete, com o número real
 * embutido na prosa (nunca um número solto do lado de um rótulo). */
export function buildResultLede(input: {
  goal: PerformanceGoal;
  hero: AnalyticsHero;
  hasAnyRecord: boolean;
  actualSpend: number;
  formatCurrencyValue: (value: number) => string;
}): string {
  const { goal, hero, hasAnyRecord, actualSpend, formatCurrencyValue } = input;
  if (!hasAnyRecord) {
    return `Ainda não há ${PERFORMANCE_GOALS[goal].resultMetricLabel.toLowerCase()} registrados neste período.`;
  }
  const comparisonClause =
    hero.percentChange !== null
      ? ` (${hero.percentChange >= 0 ? "alta" : "queda"} de ${Math.abs(hero.percentChange).toFixed(0)}% vs. período anterior)`
      : "";
  return `O período fechou em ${hero.value} ${hero.label}${comparisonClause} — resultado de ${formatCurrencyValue(actualSpend)} investidos.`;
}

/**
 * Resumo Executivo — Etapa "Analytics Instagramável": mesmas regras
 * determinísticas que antes alimentavam `AnalyticsInsight` (nenhum dado
 * novo, nenhuma IA), reescritas como frases corridas em vez de um grid de
 * mini-cards (pedido explícito do usuário: "parecer uma apresentação, não
 * um dashboard técnico"). Cada frase só entra quando há uma base real pra
 * afirmá-la — sem dado suficiente, a frase correspondente simplesmente não
 * existe (nunca um texto genérico tipo "dados insuficientes" no lugar).
 *
 * Etapa "Resumo Executivo": renomeada de `buildExecutiveSummaryNarrative` —
 * alimenta o bloco "O que aprendemos" (pedido explícito do usuário: "esse
 * talvez seja o bloco mais importante do Analytics"). Ganhou a frase de
 * investimento vs. eficiência (`previousSummary`); frases sobre tipo de
 * criativo (vídeo/estático) ou estabilidade de CPA entre canais ficaram de
 * fora desta primeira versão — a MITZA não guarda tipo de mídia por
 * criativo hoje, e estabilidade exigiria uma métrica de variância que ainda
 * não existe. Nunca fabricar essas frases sem o dado real por trás.
 */
export function buildLearningsNarrative(input: {
  goal: PerformanceGoal;
  summary: PerformanceSummary;
  previousSummary: PerformanceSummary | null;
  channelRows: AnalyticsChannelRow[];
  totalActualSpend: number;
  heroPercentChange: number | null;
}): string[] {
  const { goal, summary, previousSummary, channelRows, totalActualSpend, heroPercentChange } = input;
  const config = PERFORMANCE_GOALS[goal];
  const resultLabel = config.resultMetricLabel.toLowerCase();
  const sentences: string[] = [];

  if (heroPercentChange !== null) {
    const direction = heroPercentChange >= 0 ? "crescimento" : "queda";
    sentences.push(
      `O período apresentou ${direction} de ${Math.abs(heroPercentChange).toFixed(0)}% em ${resultLabel} em relação ao período anterior.`,
    );
  }

  if (channelRows.length >= 2 && totalActualSpend > 0) {
    const topSpend = [...channelRows].sort((a, b) => b.spend - a.spend)[0];
    const topVolume = [...channelRows].sort((a, b) => b.resultCount - a.resultCount)[0];
    const share = Math.round((topSpend.spend / totalActualSpend) * 100);
    const topSpendLabel = TRAFFIC_CHANNELS[topSpend.channel].label;

    if (topSpend.channel === topVolume.channel && topVolume.resultCount > 0) {
      sentences.push(`${topSpendLabel} concentrou ${share}% do investimento e foi responsável pelo maior volume de ${resultLabel}.`);
    } else {
      sentences.push(`${topSpendLabel} concentrou ${share}% do investimento no período.`);
      if (topVolume.resultCount > 0) {
        sentences.push(`${TRAFFIC_CHANNELS[topVolume.channel].label} foi responsável pelo maior volume de ${resultLabel}.`);
      }
    }
  }

  if (summary.costPerResult !== null && summary.targetCostPerResult !== null) {
    const statusText: Partial<Record<PerformanceStatus, string>> = {
      better: `${config.costMetricLabel} permaneceu abaixo da meta durante o período.`,
      worse: `${config.costMetricLabel} ficou acima da meta durante o período.`,
      on_target: `${config.costMetricLabel} ficou dentro da meta durante o período.`,
    };
    const sentence = statusText[summary.comparison.status];
    if (sentence) sentences.push(sentence);
  }

  // Investimento vs. eficiência — só com período anterior comparável (ambos
  // com gasto e custo por resultado reais). "Aumentou sem perda de
  // eficiência" quando o gasto cresceu e o custo por resultado não piorou
  // na mesma proporção (piorou menos da metade do quanto o gasto cresceu,
  // ou até melhorou); nunca a leitura inversa fabricada quando os números
  // não sustentam essa conclusão.
  if (
    previousSummary?.actualSpend &&
    previousSummary.actualSpend > 0 &&
    previousSummary.costPerResult !== null &&
    summary.costPerResult !== null
  ) {
    const spendChange = computePercentChange(totalActualSpend, previousSummary.actualSpend);
    const costChange = computePercentChange(summary.costPerResult, previousSummary.costPerResult);
    if (spendChange !== null && costChange !== null && spendChange > 5 && costChange <= spendChange / 2) {
      sentences.push("O investimento aumentou sem perda proporcional de eficiência.");
    }
  }

  return sentences;
}

export interface AnalyticsTrendSeries {
  label: string;
  points: { date: string; value: number }[];
}

export interface AnalyticsTrend {
  /** Sempre presente quando houver dias suficientes — `daily_spend` tem
   * granularidade diária pra qualquer cliente (sync nativo do Meta). */
  spend: AnalyticsTrendSeries;
  /** `null` quando não há granularidade diária de RESULTADO — só existe pra
   * clientes com integração Stract ativa (`daily_performance`); o fluxo
   * manual (`performance_records`) só registra por sprint/período, nunca
   * por dia. Limitação real do que a MITZA armazena hoje, não uma omissão. */
  result: AnalyticsTrendSeries | null;
}

const MIN_TREND_DAYS = 2;

/**
 * Série de evolução diária pro gráfico principal — `null` quando não há
 * pelo menos `MIN_TREND_DAYS` dias de investimento no período (a interface
 * mostra a mensagem discreta nesse caso, nunca um gráfico vazio/quebrado).
 */
export function buildAnalyticsTrend(
  goal: PerformanceGoal | null,
  dailySpendByDate: Map<string, number>,
  dailyResultByDate: Map<string, number> | null,
): AnalyticsTrend | null {
  const spendDates = Array.from(dailySpendByDate.keys()).sort();
  if (spendDates.length < MIN_TREND_DAYS) return null;

  const spend: AnalyticsTrendSeries = {
    label: "Investimento",
    points: spendDates.map((date) => ({ date, value: dailySpendByDate.get(date) ?? 0 })),
  };

  if (!goal || !dailyResultByDate || dailyResultByDate.size === 0) return { spend, result: null };

  const result: AnalyticsTrendSeries = {
    label: PERFORMANCE_GOALS[goal].resultMetricLabel,
    points: spendDates.map((date) => ({ date, value: dailyResultByDate.get(date) ?? 0 })),
  };

  return { spend, result };
}

/**
 * Legenda em prosa do Capítulo IV ("O que mudou?") — Etapa "Analytics como
 * Relatório": aponta a direção observada na própria série diária do
 * período atual (primeiro dia vs. último dia), DIFERENTE da comparação do
 * Capítulo II (que compara PERÍODOS inteiros) — nunca o mesmo dado
 * reaproveitado como se fosse uma segunda evidência. `null` sem pelo menos
 * 2 pontos na série (nada a descrever).
 */
export function buildTrendCaption(trend: AnalyticsTrend): string | null {
  const series = trend.result ?? trend.spend;
  if (series.points.length < 2) return null;

  const first = series.points[0].value;
  const last = series.points[series.points.length - 1].value;
  if (first === last) return `${series.label} se manteve estável ao longo do período.`;

  const direction = last > first ? "cresceu" : "caiu";
  return `${series.label} ${direction} entre o início e o fim do período.`;
}
