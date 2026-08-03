"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";

const STORAGE_KEY = "mitza:analytics-platform";

/**
 * Seletor de plataforma "Meta Ads | Google Ads" — Integração Google Ads.
 * Controla TODA a aba de Analytics (Resumo, gráfico, Campanhas, PDF), nunca
 * só a tabela de campanhas. Reaproveita `AVAILABLE_TRAFFIC_CHANNELS`
 * (já `["meta", "google"]`) — nenhuma lista nova de plataformas.
 *
 * Navegação por querystring (`analyticsPlatform`), mesmo padrão de
 * `AnalyticsHubNav`/`AnalyticsPeriodMenu` — App Router faz soft nav (nunca
 * um reload de página inteira). Pedido explícito do usuário: "manter
 * preferencialmente a última plataforma selecionada durante a sessão" — a
 * escolha é lembrada em `sessionStorage`; se o usuário chegar numa URL SEM
 * `analyticsPlatform` explícito (ex.: veio de outro lugar da plataforma) e
 * tiver uma escolha diferente do padrão (Meta) lembrada, redireciona uma
 * vez (client-side, sem reload) pra essa escolha.
 */
export function AnalyticsPlatformSwitch({ baseHref, activePlatform }: { baseHref: string; activePlatform: TrafficChannel }) {
  const router = useRouter();

  useEffect(() => {
    const hasExplicitParam = new URLSearchParams(window.location.search).has("analyticsPlatform");
    if (hasExplicitParam) return;

    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (remembered === "google" && activePlatform !== "google") {
      router.replace(`${baseHref}&analyticsPlatform=google`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function remember(platform: TrafficChannel) {
    try {
      sessionStorage.setItem(STORAGE_KEY, platform);
    } catch {
      // sessionStorage indisponível (modo privado etc.) — sem lembrança entre navegações, nunca quebra o clique.
    }
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {AVAILABLE_TRAFFIC_CHANNELS.map((platform) => (
        <Link
          key={platform}
          href={`${baseHref}&analyticsPlatform=${platform}`}
          scroll={false}
          onClick={() => remember(platform)}
          aria-pressed={platform === activePlatform}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            platform === activePlatform ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {TRAFFIC_CHANNELS[platform].label}
        </Link>
      ))}
    </div>
  );
}
