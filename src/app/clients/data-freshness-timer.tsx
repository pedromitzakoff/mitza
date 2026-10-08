"use client";

import { useEffect, useState } from "react";
import { formatMinuteRelativeTime } from "@/lib/format";

/**
 * MITZA ONE — pedido do usuário (junto da busca direta na Meta a cada 5
 * minutos): "quero que tenha um timer na tela do cliente mostrando de
 * quando foi a última atualização de dados". Reaproveita o MESMO instante
 * que já alimentava `latestSuccessAtLabel` em `dados-data.ts`
 * (`import_sources.last_success_at`, o mais recente entre as fontes
 * habilitadas) — nenhuma segunda fonte/cálculo de frescor.
 *
 * Client Component porque precisa recalcular sozinho (sem reload da
 * página) — uma fonte sincronizando a cada 5 minutos precisa de um rótulo
 * que realmente mude a cada minuto, não um texto congelado no momento do
 * render do servidor. Começa em `null` (mesmo valor no servidor e na
 * hidratação do cliente) e só calcula o rótulo de verdade dentro do
 * `useEffect` — evita qualquer divergência de hidratação por causa de um
 * instante que muda entre o render do servidor e o momento em que o
 * navegador termina de montar a página.
 */
export function DataFreshnessTimer({ lastSuccessAt }: { lastSuccessAt: string | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!lastSuccessAt) return;

    function update() {
      setLabel(formatMinuteRelativeTime(lastSuccessAt as string, new Date()));
    }

    update();
    const intervalId = setInterval(update, 30_000);
    return () => clearInterval(intervalId);
  }, [lastSuccessAt]);

  if (!lastSuccessAt) {
    return <p className="text-xs text-overview-text-muted">Sem sincronização registrada ainda.</p>;
  }

  if (!label) return null;

  return <p className="text-xs text-overview-text-muted">Dados atualizados {label}</p>;
}
