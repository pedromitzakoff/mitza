import { resolveEffectiveSpend } from "@/lib/effective-spend";
import type { SpendSource } from "@/lib/sprint-financials";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * MVP Etapa 2/3 — fonte de verdade de INVESTIMENTO por plataforma, resolvendo
 * o gasto real de UM canal por vez em vez do valor consolidado da sprint.
 * `resolveSprintChannelActualSpend` delega em `resolveEffectiveSpend`
 * (`lib/effective-spend.ts`) — mesma regra do consolidado (sincronizado
 * sempre que existir, manual só como fallback), nunca uma segunda cópia.
 *
 * Regra que nunca pode ser violada por quem consumir isto: o consolidado é
 * sempre a SOMA coerente dos canais (nunca um valor independente), e o
 * investimento de um canal nunca é usado pra calcular CPL/CPA de outro
 * canal — ver `resolveActualSpendForScope` em `lib/performance.ts`.
 */

/** Override manual de UM canal — carrega `sprintId` porque, ao contrário de
 * `sprints.manual_actual_spend` (uma coluna por sprint), o override por
 * canal vive numa tabela própria (`sprint_channel_spend`) com várias linhas
 * possíveis por sprint (uma por canal); quem monta a lista pro cliente
 * inteiro passa todas de uma vez (mesmo padrão batch de `dailySpend`/
 * `tasks`), e as funções abaixo filtram por sprint+canal internamente. */
export interface SprintChannelSpendOverrideRow {
  sprintId: string;
  channel: TrafficChannel;
  spend_source: SpendSource;
  manual_actual_spend: number | null;
}

/** Mesma decisão de `resolveEffectiveSpend` (`lib/effective-spend.ts`), mas
 * pro override de UM canal — `override` é `undefined` quando o canal nunca
 * teve um override salvo em `sprint_channel_spend` (equivale a "sempre
 * meta_api" pra esse canal). `metaSpendSum` precisa ser `null` quando não
 * existe NENHUMA linha de `daily_spend` pro canal/período (distinto de `0`,
 * que é "sincronizou e o gasto real é zero") — só assim o manual continua
 * servindo de fallback quando o canal genuinamente não tem sincronização
 * ainda, sem nunca mascarar um dado sincronizado real. */
export function resolveSprintChannelActualSpend(override: SprintChannelSpendOverrideRow | undefined, metaSpendSum: number | null): number {
  return resolveEffectiveSpend({
    spendSource: override?.spend_source ?? "meta_api",
    manualActualSpend: override?.manual_actual_spend ?? null,
    syncedSpend: metaSpendSum,
  }).actual;
}

/** Soma o `daily_spend` de UM canal dentro do período de uma sprint e
 * resolve sincronizado x manual pra esse canal — a versão "por canal" de
 * `computeSprintEffectiveSpend`. */
export function computeSprintChannelEffectiveSpend(
  sprint: { sprintId: string; start_date: string; end_date: string },
  channel: TrafficChannel,
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverrideRow[],
): number {
  const matching = dailySpend.filter((d) => d.channel === channel && d.date >= sprint.start_date && d.date <= sprint.end_date);
  const metaSpendSum = matching.length > 0 ? matching.reduce((sum, d) => sum + d.spend, 0) : null;
  const override = overrides.find((o) => o.sprintId === sprint.sprintId && o.channel === channel);
  return resolveSprintChannelActualSpend(override, metaSpendSum);
}

/** Soma o gasto real efetivo de UM canal em várias sprints — a versão "por
 * canal" de `sumEffectiveSpend`, usada pra consolidar o realizado do mês de
 * uma única plataforma. */
export function sumChannelEffectiveSpend(
  sprints: { sprintId: string; start_date: string; end_date: string }[],
  channel: TrafficChannel,
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverrideRow[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintChannelEffectiveSpend(sprint, channel, dailySpend, overrides), 0);
}

/**
 * Consolidado = soma coerente dos canais com dado (nunca inventa canal sem
 * `daily_spend`/override nenhum). Recebe a lista de canais que o cliente
 * de fato usa (inferida por quem tem `daily_spend` ou override registrado —
 * Etapa 2 não introduz nenhum campo de configuração "plataformas do
 * cliente"), nunca uma lista fixa de todos os canais possíveis.
 */
export function sumConsolidatedChannelEffectiveSpend(
  sprints: { sprintId: string; start_date: string; end_date: string }[],
  channels: TrafficChannel[],
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverrideRow[],
): number {
  return channels.reduce((sum, channel) => sum + sumChannelEffectiveSpend(sprints, channel, dailySpend, overrides), 0);
}

/** Agrupa os overrides por `sprintId` — todo ponto que precisa resolver o
 * investimento manual consolidado de várias sprints de uma vez (ver
 * `resolveManualActualSpend`, lib/effective-spend.ts) usa isto em vez de
 * filtrar a lista inteira a cada sprint (mesmo padrão de agrupamento batch
 * já usado pra `dailySpend`/`tasks` por cliente). */
export function groupChannelSpendBySprintId(
  overrides: SprintChannelSpendOverrideRow[],
): Map<string, SprintChannelSpendOverrideRow[]> {
  const map = new Map<string, SprintChannelSpendOverrideRow[]>();
  for (const row of overrides) {
    const list = map.get(row.sprintId);
    if (list) list.push(row);
    else map.set(row.sprintId, [row]);
  }
  return map;
}

/**
 * Valor manual ATUAL de UM canal específico, pra pré-popular o formulário de
 * "Atualizar performance" — não confundir com `resolveSprintChannelActualSpend`
 * (resolve sincronizado×manual pra EXIBIÇÃO). Regra: se já existe override
 * explícito (`manual_actual_spend` não-nulo) pra este canal, usa ele. Senão,
 * e SÓ pro canal "meta" quando a sprint ainda não tem NENHUM override
 * explícito em NENHUM canal, cai pro valor legado (`sprints.manual_actual_spend`)
 * — o legado sempre representou Meta (única plataforma manual antes desta
 * etapa), então o campo "Investimento · Meta Ads" nasce pré-preenchido com
 * ele. Isso é o que garante que o primeiro lançamento multicanal preserva o
 * Meta existente (nunca some silenciosamente quando o gestor só quis
 * adicionar Google): o campo Meta já vem com o valor certo, e ao salvar o
 * formulário grava esse valor como override explícito. Qualquer outro canal
 * sem override explícito nasce vazio (nunca "R$ 0,00" fabricado).
 */
export function resolveChannelManualActualSpendForEntry(
  channel: TrafficChannel,
  legacyManualActualSpend: number | null,
  channelSpendRows: SprintChannelSpendOverrideRow[],
): number | null {
  const explicitForChannel = channelSpendRows.find((r) => r.channel === channel && r.manual_actual_spend !== null);
  if (explicitForChannel) return explicitForChannel.manual_actual_spend;

  const hasAnyExplicitChannel = channelSpendRows.some((r) => r.manual_actual_spend !== null);
  if (!hasAnyExplicitChannel && channel === "meta") return legacyManualActualSpend;

  return null;
}

/** Versão em lote de `resolveChannelManualActualSpendForEntry` pros canais
 * selecionáveis de UMA sprint — pré-preenche cada campo "Investimento ·
 * <canal>" do formulário, sem repetir a busca canal a canal. */
export function buildEditableInvestmentValues(
  channels: TrafficChannel[],
  legacyManualActualSpend: number | null,
  channelSpendRows: SprintChannelSpendOverrideRow[],
): { channel: TrafficChannel; currentAmount: number | null }[] {
  return channels.map((channel) => ({
    channel,
    currentAmount: resolveChannelManualActualSpendForEntry(channel, legacyManualActualSpend, channelSpendRows),
  }));
}

/** Quais canais um cliente efetivamente usa, inferido pelos dados que já
 * existem (nunca por um campo de configuração) — `daily_spend` sincronizado
 * ou override manual em `sprint_channel_spend` contam como "usa este
 * canal". Usado pra nunca somar/exibir um canal vazio como se fosse "R$ 0
 * de investimento" (estado diferente de "canal não usado"). */
export function inferClientChannels(
  dailySpend: { channel: TrafficChannel }[],
  overrides: { channel: TrafficChannel }[],
): TrafficChannel[] {
  const set = new Set<TrafficChannel>();
  for (const d of dailySpend) set.add(d.channel);
  for (const o of overrides) set.add(o.channel);
  return Array.from(set);
}
