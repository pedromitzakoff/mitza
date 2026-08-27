/**
 * Configuração central de canais de tráfego (Etapa 71) — a dimensão de
 * canal nasce em `performance_records` desde o início (mesmo com a entrada
 * de dados sendo 100% manual por enquanto), pra nunca precisar de uma
 * migration estrutural quando a integração de verdade existir. Meta e
 * Google são os únicos SELECIONÁVEIS nesta etapa; os demais já existem no
 * tipo/config pra a expansão futura não exigir alterar nenhum enum/coluna
 * existente, só adicionar a entrada correspondente aqui.
 */
/** `instagram` (Etapa Integração Instagram): fonte de RESULTADO orgânico
 * (novos seguidores), nunca um canal de investimento — sua própria linha em
 * `daily_spend` nunca existe/é sempre irrelevante, diferente de
 * meta/google/tiktok/linkedin, que são canais de mídia paga. Por isso nunca
 * entra em `AVAILABLE_TRAFFIC_CHANNELS` (lançamento manual) nem no
 * detalhamento por canal do Analytics (`buildAnalyticsChannelRows`) — só é
 * usado como `channel` de linhas em `daily_performance`
 * (result_type='followers'). */
export type TrafficChannel = "meta" | "google" | "tiktok" | "linkedin" | "instagram" | "other";

export interface TrafficChannelConfig {
  id: TrafficChannel;
  label: string;
  shortLabel: string;
}

export const TRAFFIC_CHANNELS: Record<TrafficChannel, TrafficChannelConfig> = {
  meta: { id: "meta", label: "Meta Ads", shortLabel: "Meta" },
  google: { id: "google", label: "Google Ads", shortLabel: "Google" },
  tiktok: { id: "tiktok", label: "TikTok Ads", shortLabel: "TikTok" },
  linkedin: { id: "linkedin", label: "LinkedIn Ads", shortLabel: "LinkedIn" },
  instagram: { id: "instagram", label: "Instagram", shortLabel: "Instagram" },
  other: { id: "other", label: "Outro canal", shortLabel: "Outro" },
};

/** Canais que o gestor pode de fato selecionar no formulário de entrada
 * manual nesta etapa — os demais já existem em `TRAFFIC_CHANNELS`/no banco
 * (constraint), prontos pra virar selecionáveis quando a integração chegar,
 * sem nenhuma migration nova. */
export const AVAILABLE_TRAFFIC_CHANNELS: TrafficChannel[] = ["meta", "google"];

export function getTrafficChannelConfig(channel: TrafficChannel): TrafficChannelConfig {
  return TRAFFIC_CHANNELS[channel];
}

/** Escopo canônico "consolidado ou um canal só" — Etapa "Arquitetura
 * Multicanal Unificada": único tipo pra essa distinção na plataforma inteira
 * (antes duplicado como `PerformanceChannelScope` em lib/performance.ts e
 * `VisaoGeralMetricsChannel` em visao-geral-channel-switch.tsx, cada um
 * reinventando o mesmo union — os dois viraram aliases deste). */
export type ChannelScope = "consolidated" | TrafficChannel;

/**
 * Etapa "Canais Ativos por Cliente" — `clients.media_channels` (`text[]`,
 * validado contra `AVAILABLE_TRAFFIC_CHANNELS`, sempre pelo menos 1 valor)
 * é a fonte única de verdade de "em quais plataformas este cliente
 * investe" — nunca confundida com `import_sources.enabled`
 * (`resolveClientActiveChannels`, achievement-metrics.ts: só diz se há
 * SINCRONIZAÇÃO automática configurada, um cliente manual pode não ter
 * nenhuma linha) nem com presença de dado num mês (`daily_spend`/
 * `daily_performance`: um canal configurado sem investimento neste mês
 * ainda é um canal configurado — ver `resolveSelectedChannelScope` abaixo).
 *
 * As 4 funções desta seção são as únicas que decidem "quais canais este
 * cliente pode ver"/"qual é o padrão"/"qual está selecionado agora" — nunca
 * espalhar essa decisão de novo pelos componentes que consomem
 * `ChannelScope` (Visão Geral do cliente é o único consumidor nesta etapa;
 * ver auditoria antes de estender a outros pontos que hoje usam
 * `AVAILABLE_TRAFFIC_CHANNELS` incondicionalmente).
 */

/** Ordem de exibição padrão do seletor de canal — Meta primeiro (plataforma
 * predominante na operação), Consolidado sempre por último quando existe. */
const CHANNEL_SWITCH_ORDER: ChannelScope[] = ["meta", "google", "consolidated"];

/** Normaliza `clients.media_channels` pra uma lista de canais REALMENTE
 * selecionáveis (`AVAILABLE_TRAFFIC_CHANNELS`) — filtra qualquer valor
 * inesperado (dado legado antes da migration, edição manual do banco) e
 * nunca devolve lista vazia: cai pra `["meta"]` como último recurso (nunca
 * uma tela sem opção nenhuma), mesmo que o dado esperado seja sempre
 * não-vazio (constraint no banco já garante isso — esta função é a segunda
 * camada de defesa, não a única). */
export function resolveClientMediaChannels(mediaChannels: string[] | null | undefined): TrafficChannel[] {
  const valid = (mediaChannels ?? []).filter((channel): channel is TrafficChannel =>
    AVAILABLE_TRAFFIC_CHANNELS.includes(channel as TrafficChannel),
  );
  return valid.length > 0 ? valid : ["meta"];
}

/** Opções do seletor de canal pra este cliente, já na ordem certa —
 * Consolidado só entra quando há MAIS DE UM canal ativo pra consolidar
 * (consolidar um canal só produziria essencialmente a mesma visão do canal
 * isolado, controle redundante). */
export function resolveClientChannelScopeOptions(mediaChannels: string[] | null | undefined): ChannelScope[] {
  const channels = resolveClientMediaChannels(mediaChannels);
  return CHANNEL_SWITCH_ORDER.filter((scope) => (scope === "consolidated" ? channels.length > 1 : channels.includes(scope as TrafficChannel)));
}

/** Canal inicial ao abrir a Visão Geral — Meta se ativo, senão Google,
 * Consolidado só como fallback final (na prática nunca acontece: um
 * cliente só chega em "Consolidado" aqui se `media_channels` não incluir
 * nem "meta" nem "google", o que `resolveClientMediaChannels` já impede). */
export function resolveDefaultClientChannelScope(mediaChannels: string[] | null | undefined): ChannelScope {
  const options = resolveClientChannelScopeOptions(mediaChannels);
  return options.find((scope) => scope === "meta") ?? options.find((scope) => scope === "google") ?? options[0] ?? "consolidated";
}

/** Único ponto que decide o canal EFETIVAMENTE exibido: honra a seleção
 * manual do usuário (querystring) sempre que ela for uma opção válida pra
 * este cliente especificamente — nunca reseta pro default a cada
 * navegação/troca de mês só porque o componente re-renderizou. Só cai pro
 * default quando não há parâmetro (primeira visita) OU quando o parâmetro
 * é inválido pra este cliente (ex.: link antigo pra "google" depois do
 * cliente ter sido reconfigurado só pra Meta) — nunca por ausência de dado
 * no mês selecionado, que não é responsabilidade desta função. */
export function resolveSelectedChannelScope(paramValue: string | null | undefined, mediaChannels: string[] | null | undefined): ChannelScope {
  const options = resolveClientChannelScopeOptions(mediaChannels);
  if (paramValue && (options as string[]).includes(paramValue)) return paramValue as ChannelScope;
  return resolveDefaultClientChannelScope(mediaChannels);
}
