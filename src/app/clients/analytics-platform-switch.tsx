"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";

const STORAGE_KEY = "mitza:analytics-platform";

/**
 * Seletor de plataforma "Consolidado | Meta Ads | Google Ads" — Etapa
 * "Migração Multicanal dos Consumidores": mesma regra de escopo de
 * `VisaoGeralChannelSwitch` (Visão Geral) — "Consolidado" nunca filtra
 * (`fetchClientAnalyticsData` recebe `channel: undefined`, que já significava
 * consolidado desde sempre), "Meta"/"Google" escopam ao canal. Controla TODA
 * a aba de Analytics (Resumo, gráfico, Campanhas, PDF), nunca só a tabela de
 * campanhas.
 *
 * Navegação por querystring (`analyticsPlatform`), mesmo padrão de
 * `AnalyticsHubNav`/`AnalyticsPeriodMenu` — App Router faz soft nav (nunca
 * um reload de página inteira). Pedido explícito do usuário: "manter
 * preferencialmente a última plataforma selecionada durante a sessão" — a
 * escolha é lembrada em `sessionStorage`; se o usuário chegar numa URL SEM
 * `analyticsPlatform` explícito (ex.: veio de outro lugar da plataforma) e
 * tiver uma escolha diferente do padrão (Meta) lembrada, redireciona uma
 * vez (client-side, sem reload) pra essa escolha. Lembrança generalizada
 * pras 3 opções (antes só reconhecia "google") — Consolidado/Meta também
 * passam a ser lembrados entre navegações.
 */
export function AnalyticsPlatformSwitch({ baseHref, activePlatform }: { baseHref: string; activePlatform: ChannelScope }) {
  const router = useRouter();
  const options: { key: ChannelScope; label: string }[] = [
    { key: "consolidated", label: "Consolidado" },
    ...AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({ key: channel, label: TRAFFIC_CHANNELS[channel].label })),
  ];

  useEffect(() => {
    const hasExplicitParam = new URLSearchParams(window.location.search).has("analyticsPlatform");
    if (hasExplicitParam) return;

    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (remembered && remembered !== activePlatform && options.some((o) => o.key === remembered)) {
      router.replace(`${baseHref}&analyticsPlatform=${remembered}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function remember(platform: ChannelScope) {
    try {
      sessionStorage.setItem(STORAGE_KEY, platform);
    } catch {
      // sessionStorage indisponível (modo privado etc.) — sem lembrança entre navegações, nunca quebra o clique.
    }
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {options.map((option) => (
        <Link
          key={option.key}
          href={`${baseHref}&analyticsPlatform=${option.key}`}
          scroll={false}
          onClick={() => remember(option.key)}
          aria-pressed={option.key === activePlatform}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            option.key === activePlatform ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
