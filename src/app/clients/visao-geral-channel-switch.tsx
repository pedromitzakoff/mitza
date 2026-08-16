import Link from "next/link";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";

/** Etapa "Arquitetura Multicanal Unificada": alias de `ChannelScope`
 * (lib/traffic-channels.ts) — nenhuma tela deveria mais reinventar este
 * union por conta própria (era duplicado com `PerformanceChannelScope`).
 * Mantido como alias aqui pra não quebrar nenhum import existente. */
export type VisaoGeralMetricsChannel = ChannelScope;

/**
 * Seletor "Consolidado | Meta Ads | Google Ads" da aba Visão Geral — pedido
 * explícito do usuário: "eu quero que na visão do cliente eu tenha um botão
 * tipo google ou meta e quando eu clico em cada um, toda página seja
 * atualizada para as métricas do canal". Escopo combinado: só a aba Visão
 * Geral (o Analytics já tem o seletor dele, `AnalyticsPlatformSwitch`,
 * independente deste), e só as métricas que de fato existem por canal
 * (Investido/Resultados/Custo por resultado) — nunca Planejado/ritmo/status
 * do orçamento, que não têm uma meta separada por canal no modelo de dados
 * (ver `MonthInvestmentSummary`, que continua sempre consolidado).
 *
 * Server Component puro (Link + querystring, mesmo padrão de navegação de
 * `AnalyticsPlatformSwitch`) — sem `sessionStorage`/JS de cliente aqui, já
 * que este seletor não precisa lembrar a escolha entre sessões (diferente
 * do Analytics, onde isso foi pedido explicitamente).
 */
export function VisaoGeralChannelSwitch({ baseHref, active }: { baseHref: string; active: VisaoGeralMetricsChannel }) {
  const options: { key: VisaoGeralMetricsChannel; label: string }[] = [
    { key: "consolidated", label: "Consolidado" },
    ...AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({ key: channel, label: TRAFFIC_CHANNELS[channel].label })),
  ];

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-overview-border bg-overview-surface p-0.5">
      {options.map((option) => (
        <Link
          key={option.key}
          href={`${baseHref}&metricsChannel=${option.key}`}
          scroll={false}
          aria-pressed={option.key === active}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            option.key === active ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
