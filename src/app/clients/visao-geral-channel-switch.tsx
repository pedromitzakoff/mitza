import { TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";
import { ClientContextSelect } from "./client-context-select";

/** Etapa "Arquitetura Multicanal Unificada": alias de `ChannelScope`
 * (lib/traffic-channels.ts) — nenhuma tela deveria mais reinventar este
 * union por conta própria (era duplicado com `PerformanceChannelScope`).
 * Mantido como alias aqui pra não quebrar nenhum import existente. */
export type VisaoGeralMetricsChannel = ChannelScope;

const CHANNEL_SCOPE_LABEL: Record<VisaoGeralMetricsChannel, string> = {
  consolidated: "Consolidado",
  meta: TRAFFIC_CHANNELS.meta.label,
  google: TRAFFIC_CHANNELS.google.label,
  tiktok: TRAFFIC_CHANNELS.tiktok.label,
  linkedin: TRAFFIC_CHANNELS.linkedin.label,
  instagram: TRAFFIC_CHANNELS.instagram.label,
  other: TRAFFIC_CHANNELS.other.label,
};

/**
 * Seletor "Meta Ads | Google Ads | Consolidado" da aba Visão Geral — pedido
 * explícito do usuário: "eu quero que na visão do cliente eu tenha um botão
 * tipo google ou meta e quando eu clico em cada um, toda página seja
 * atualizada para as métricas do canal". Escopo: só a aba Visão Geral, e só
 * as métricas que de fato existem por canal
 * (Investido/Resultados/Custo por resultado) — nunca Planejado/ritmo/status
 * do orçamento, que não têm uma meta separada por canal no modelo de dados
 * (ver `MonthInvestmentSummary`, que continua sempre consolidado).
 *
 * Etapa "Canais Ativos por Cliente": `options` já vem pronto e ordenado de
 * `resolveClientChannelScopeOptions` (`lib/traffic-channels.ts`, a fonte
 * única de verdade) — este componente nunca decide sozinho quais canais
 * mostrar nem em que ordem, só renderiza o que recebe. Consolidado só
 * aparece quando `options` já o inclui (>1 canal ativo pro cliente); com
 * apenas 1 opção, não existe nada pra "trocar" — vira um rótulo estático,
 * mesmo critério de sempre.
 *
 * Etapa "Primeira Rodada Visual — Contexto + Performance" (seção 14 do
 * pedido): virou dropdown (`ClientContextSelect`, mesmo controle de
 * Mês/Meta-Planejamento, "hierarquia semelhante entre si") no lugar do
 * grupo de pílulas — zero mudança na REGRA (mesmas `options`, mesma
 * disponibilidade por cliente, mesmo param `metricsChannel`, ainda
 * navegação por `Link`/querystring, nunca estado de cliente).
 * `buildHref` substitui a antiga concatenação `${baseHref}&metricsChannel=`
 * — quem chama decide a URL completa (preserva mês/objetivo também
 * selecionados, nunca um dos três dropdowns reseta os outros dois).
 */
export function VisaoGeralChannelSwitch({
  buildHref,
  active,
  options,
}: {
  buildHref: (channel: VisaoGeralMetricsChannel) => string;
  active: VisaoGeralMetricsChannel;
  options: VisaoGeralMetricsChannel[];
}) {
  if (options.length <= 1) {
    return <span className="text-sm font-medium text-overview-text-primary">{CHANNEL_SCOPE_LABEL[options[0] ?? active]}</span>;
  }

  const selectOptions = options.map((option) => ({
    value: option,
    label: CHANNEL_SCOPE_LABEL[option],
    href: buildHref(option),
    active: option === active,
  }));

  return <ClientContextSelect label={CHANNEL_SCOPE_LABEL[active]} options={selectOptions} ariaLabel="Canal" />;
}
