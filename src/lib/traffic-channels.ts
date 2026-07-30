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
