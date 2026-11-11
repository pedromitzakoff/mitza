import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS, type PerformanceGoal } from "@/lib/performance-goals";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { AdSetSummary } from "@/lib/ad-set-analytics";
import type { CreativeSummary } from "@/lib/creative-analytics";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.4 (Exploração de campanhas,
 * conjuntos e anúncios). Núcleo puro da tabela de exploração — normaliza os
 * três `Summary` já existentes (`CampaignSummary`/`AdSetSummary`/
 * `CreativeSummary`, `lib/campaign-analytics.ts`/`ad-set-analytics.ts`/
 * `creative-analytics.ts`) pra UMA forma comum (`ExplorationRow`), sempre
 * reaproveitando os totais/índices JÁ calculados por essas funções — nenhum
 * cálculo novo aqui, só adaptação de formato pra uma tabela genérica.
 *
 * Alcance NUNCA é uma coluna aqui — pedido explícito do usuário (item 8 da
 * Etapa 2.4: "não somar métricas não aditivas, especialmente alcance e
 * frequência"). Achado da auditoria desta etapa: `CampaignSummary.totalReach`/
 * `AdSetSummary.totalReach`/`CreativeSummary.totalReach` (consumidos hoje
 * pelo Relatório de Performance) já somam `reach` diário entre dias — uma
 * limitação PRÉ-EXISTENTE fora do escopo desta etapa (o Relatório continua
 * intocado), mas que esta tabela NOVA não deveria herdar: por isso nenhuma
 * das colunas abaixo exibe alcance. Frequência nunca existiu nesses
 * `Summary` (nenhum `totalFrequency`), então já nasce ausente.
 */

/** Resultado/custo por resultado de UM objetivo, pra uma linha que pertence
 * exatamente a esse objetivo — nunca presente pra objetivo diferente do
 * `resultType` da própria linha (uma campanha/público/anúncio tem UM
 * objetivo por vez, ver `resultType` abaixo). `cost: null` sem base pra
 * calcular (mesma regra de sempre: nunca R$0,00 fabricado). */
export interface ExplorationGoalResult {
  count: number | null;
  cost: number | null;
}

export interface ExplorationRow {
  id: string;
  name: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  /** Cliques no link/CTA de destino — DISTINTO de `clicks`. */
  linkClicks: number | null;
  revenue: number | null;
  cpc: number | null;
  linkCpc: number | null;
  ctr: number | null;
  linkCtr: number | null;
  cpm: number | null;
  roas: number | null;
  resultType: PerformanceGoal | null;
  /** Pedido explícito do usuário ("quero selecionar colunas específicas por
   * objetivo, não uma coluna genérica que muda conforme o objetivo
   * principal"): resultado/custo SEMPRE no objetivo PRÓPRIO da linha — uma
   * linha de Leads só preenche `resultByGoal.leads`, nunca `.sales`/
   * `.conversations` (objeto com no máximo 1 chave, a de `resultType`).
   * Nenhum cálculo novo: reaproveita `totalResultCount`/`cpa`, já corretos
   * (denominador = investimento da PRÓPRIA linha, nunca de outro objetivo). */
  resultByGoal: Partial<Record<PerformanceGoal, ExplorationGoalResult>>;
  /** Só criativos — `undefined` pra campanhas/conjuntos (nunca `null`
   * fabricado pra um nível que nem tem esse conceito). */
  previewImageUrl?: string | null;
  /** Campanhas onde este conjunto/anúncio aparece — vem de
   * `AdSetSummary.campaignNames`/`CreativeSummary.campaignNames` (já
   * calculado, nunca um cálculo novo). `undefined` pra campanhas (não se
   * aplica); exibido como legenda da linha só quando a tabela está em modo
   * "entrada direta" (sem campanha selecionada), pra deixar explícito a
   * qual campanha cada conjunto/anúncio pertence. */
  campaignNames?: string[];
}

/** Monta `resultByGoal` a partir do par (resultType, count, cost) JÁ
 * calculado por um `Summary` — nunca mais de 1 chave (o objetivo da própria
 * linha), nunca um segundo cálculo. */
function buildResultByGoal(
  resultType: PerformanceGoal | null,
  count: number | null,
  cost: number | null,
): Partial<Record<PerformanceGoal, ExplorationGoalResult>> {
  return resultType ? { [resultType]: { count, cost } } : {};
}

export function campaignSummaryToRow(summary: CampaignSummary): ExplorationRow {
  return {
    id: summary.campaignName,
    name: summary.campaignName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    revenue: summary.totalRevenue,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
    resultByGoal: buildResultByGoal(summary.resultType, summary.totalResultCount, summary.cpa),
  };
}

export function adSetSummaryToRow(summary: AdSetSummary): ExplorationRow {
  return {
    id: summary.adSetName,
    name: summary.adSetName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    revenue: summary.totalRevenue,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
    resultByGoal: buildResultByGoal(summary.resultType, summary.totalResultCount, summary.cpa),
    campaignNames: summary.campaignNames,
  };
}

export function creativeSummaryToRow(summary: CreativeSummary): ExplorationRow {
  return {
    id: summary.creativeName,
    name: summary.creativeName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    revenue: summary.totalRevenue,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
    resultByGoal: buildResultByGoal(summary.resultType, summary.totalResultCount, summary.cpa),
    previewImageUrl: summary.previewImageUrl,
    campaignNames: summary.campaignNames,
  };
}

export type StaticExplorationColumnId =
  | "name"
  | "spend"
  | "impressions"
  | "clicks"
  | "linkClicks"
  | "ctr"
  | "linkCtr"
  | "cpc"
  | "linkCpc"
  | "cpm"
  | "revenue"
  | "roas";

/** Coluna de Resultado/Custo por resultado de UM objetivo específico —
 * pedido explícito do usuário: "não quero apenas uma coluna genérica
 * 'Resultado' que muda conforme o objetivo principal... quero selecionar
 * colunas específicas pra cada resultado (Leads, CPL, Conversas, Custo por
 * conversa, Vendas, CPA)". Uma por objetivo REALMENTE presente nos dados
 * deste cliente (`goalsPresent`, calculado por quem chama) — nunca os 5
 * objetivos do catálogo inteiro de uma vez. */
export type GoalResultColumnId = `result:${PerformanceGoal}`;
export type GoalCostColumnId = `cost:${PerformanceGoal}`;
export type ExplorationColumnId = StaticExplorationColumnId | GoalResultColumnId | GoalCostColumnId;

export interface ExplorationColumnDef {
  id: ExplorationColumnId;
  label: string;
  align: "left" | "right";
  defaultVisible: boolean;
}

function goalResultColumnId(goal: PerformanceGoal): GoalResultColumnId {
  return `result:${goal}`;
}
function goalCostColumnId(goal: PerformanceGoal): GoalCostColumnId {
  return `cost:${goal}`;
}

/** `null` quando `id` não é uma coluna de objetivo (coluna estática) —
 * quem chama cai pro acessor estático nesse caso. */
function parseGoalColumnId(id: ExplorationColumnId): { kind: "result" | "cost"; goal: PerformanceGoal } | null {
  if (id.startsWith("result:")) return { kind: "result", goal: id.slice("result:".length) as PerformanceGoal };
  if (id.startsWith("cost:")) return { kind: "cost", goal: id.slice("cost:".length) as PerformanceGoal };
  return null;
}

/** Ordem canônica das colunas + seleção inicial — "Nome" nunca é removível
 * (identidade da linha, sempre presente e sempre fixa à esquerda).
 *
 * `goalsPresent`: os objetivos que REALMENTE aparecem nos dados deste
 * cliente no período (campanhas de Leads E de Vendas, por exemplo, geram
 * `["leads", "sales"]`) — cada um vira um PAR de colunas próprio (Resultado
 * + Custo), rotulado com o nome do PRÓPRIO objetivo (`PERFORMANCE_GOALS`,
 * mesma fonte de sempre), nunca uma coluna genérica que muda de sentido
 * conforme o objetivo principal do cliente.
 *
 * Compatibilidade (pedido explícito): cliente com UM objetivo só continua
 * vendo exatamente o par Resultado/Custo visível por padrão, idêntico a
 * antes desta mudança (só o rótulo passou a ser específico em vez de
 * genérico — o número nunca muda). Cliente com MAIS de um objetivo vê TODOS
 * os pares visíveis por padrão (o pedido era justamente poder ver Leads +
 * Conversas + Vendas ao mesmo tempo) — ainda assim, cada par continua
 * escondível individualmente no seletor de colunas, pra nunca forçar uma
 * tabela excessivamente larga.
 */
export function buildExplorationColumns(goalsPresent: readonly PerformanceGoal[]): ExplorationColumnDef[] {
  const orderedGoals = PERFORMANCE_GOAL_OPTIONS.map((o) => o.value).filter((goal) => goalsPresent.includes(goal));

  // Todo objetivo REALMENTE presente nos dados vem visível por padrão — com
  // 1 objetivo só, idêntico a antes desta mudança; com mais de 1, exatamente
  // o pedido do usuário (ver Leads + Conversas + Vendas simultaneamente,
  // nunca escondido sozinho atrás de um clique a mais).
  const goalColumns: ExplorationColumnDef[] = orderedGoals.flatMap((goal) => [
    { id: goalResultColumnId(goal), label: PERFORMANCE_GOALS[goal].resultMetricLabel, align: "right" as const, defaultVisible: true },
    { id: goalCostColumnId(goal), label: PERFORMANCE_GOALS[goal].costMetricShortLabel, align: "right" as const, defaultVisible: true },
  ]);

  return [
    { id: "name", label: "Nome", align: "left", defaultVisible: true },
    { id: "spend", label: "Investimento", align: "right", defaultVisible: true },
    { id: "impressions", label: "Impressões", align: "right", defaultVisible: true },
    { id: "clicks", label: "Cliques totais", align: "right", defaultVisible: true },
    { id: "linkClicks", label: "Cliques no link", align: "right", defaultVisible: false },
    { id: "ctr", label: "CTR geral", align: "right", defaultVisible: false },
    { id: "linkCtr", label: "CTR do link", align: "right", defaultVisible: false },
    { id: "cpc", label: "CPC geral", align: "right", defaultVisible: false },
    { id: "linkCpc", label: "CPC do link", align: "right", defaultVisible: false },
    { id: "cpm", label: "CPM", align: "right", defaultVisible: false },
    ...goalColumns,
    { id: "revenue", label: "Receita", align: "right", defaultVisible: false },
    { id: "roas", label: "ROAS", align: "right", defaultVisible: false },
  ];
}

const NUMERIC_ACCESSOR: Record<Exclude<StaticExplorationColumnId, "name">, (row: ExplorationRow) => number | null> = {
  spend: (row) => row.spend,
  impressions: (row) => row.impressions,
  clicks: (row) => row.clicks,
  linkClicks: (row) => row.linkClicks,
  ctr: (row) => row.ctr,
  linkCtr: (row) => row.linkCtr,
  cpc: (row) => row.cpc,
  linkCpc: (row) => row.linkCpc,
  cpm: (row) => row.cpm,
  revenue: (row) => row.revenue,
  roas: (row) => row.roas,
};

/** Valor numérico de UMA coluna de objetivo — `undefined` quando a linha
 * NÃO é desse objetivo (ex.: coluna "Vendas" numa linha de Leads — nunca
 * `0` fabricado nem o número de outro objetivo vazando aqui, mesma garantia
 * de `resultByGoal`). */
function goalColumnValue(parsed: { kind: "result" | "cost"; goal: PerformanceGoal }, row: ExplorationRow): number | null {
  const entry = row.resultByGoal[parsed.goal];
  if (!entry) return null;
  return parsed.kind === "result" ? entry.count : entry.cost;
}

/** Valor numérico de UMA coluna, pra ordenação — `null`/linha de outro
 * objetivo vira `-1` (mesma convenção já usada em `report-table-section.tsx`:
 * "sem dado" ordena sempre antes de qualquer valor real, nunca no meio). */
export function explorationSortValue(id: ExplorationColumnId, row: ExplorationRow): number {
  if (id === "name") return 0;
  const goalColumn = parseGoalColumnId(id);
  if (goalColumn) return goalColumnValue(goalColumn, row) ?? -1;
  return NUMERIC_ACCESSOR[id as Exclude<StaticExplorationColumnId, "name">](row) ?? -1;
}

const PERCENT_COLUMNS = new Set<StaticExplorationColumnId>(["ctr", "linkCtr"]);
const CURRENCY_COLUMNS = new Set<StaticExplorationColumnId>(["spend", "cpc", "linkCpc", "cpm", "revenue"]);
const COUNT_COLUMNS = new Set<StaticExplorationColumnId>(["impressions", "clicks", "linkClicks"]);

/** Texto formatado de UMA célula — moeda/percentual/contagem corretos por
 * coluna (pedido do usuário: "valores e unidades formatados corretamente"),
 * `"—"` quando o valor é `null` OU a linha não é deste objetivo (nunca `0`
 * fabricado, nunca o número de um objetivo aparecendo na coluna de outro). */
export function formatExplorationCell(id: ExplorationColumnId, row: ExplorationRow): string {
  if (id === "name") return row.name;

  const goalColumn = parseGoalColumnId(id);
  if (goalColumn) {
    const value = goalColumnValue(goalColumn, row);
    if (value === null) return "—";
    return goalColumn.kind === "cost" ? formatCurrency(value) : formatCount(value);
  }

  if (id === "roas") return row.roas !== null ? `${row.roas.toFixed(2)}x` : "—";

  const staticId = id as Exclude<StaticExplorationColumnId, "name" | "roas">;
  const value = NUMERIC_ACCESSOR[staticId](row);
  if (value === null) return "—";
  if (PERCENT_COLUMNS.has(staticId)) return formatPercent(value * 100);
  if (CURRENCY_COLUMNS.has(staticId)) return formatCurrency(value);
  if (COUNT_COLUMNS.has(staticId)) return formatCount(value);
  return String(value);
}
