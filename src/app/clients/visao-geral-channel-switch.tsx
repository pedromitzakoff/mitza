import Link from "next/link";
import { TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";

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
 * sem pill/borda, pra não sugerir um controle interativo que não faz nada.
 *
 * Server Component puro (Link + querystring) — sem `sessionStorage`/JS de
 * cliente aqui, já que este seletor não precisa lembrar a escolha entre
 * sessões.
 */
export function VisaoGeralChannelSwitch({
  baseHref,
  active,
  options,
}: {
  baseHref: string;
  active: VisaoGeralMetricsChannel;
  options: VisaoGeralMetricsChannel[];
}) {
  if (options.length <= 1) {
    return <span className="text-sm font-medium text-overview-text-primary">{CHANNEL_SCOPE_LABEL[options[0] ?? active]}</span>;
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-overview-border bg-overview-surface p-0.5">
      {options.map((option) => (
        <Link
          key={option}
          href={`${baseHref}&metricsChannel=${option}`}
          scroll={false}
          aria-pressed={option === active}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            option === active ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"
          }`}
        >
          {CHANNEL_SCOPE_LABEL[option]}
        </Link>
      ))}
    </div>
  );
}
