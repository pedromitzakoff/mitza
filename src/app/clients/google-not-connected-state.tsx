import { EmptyState } from "@/components/ui/empty-state";
import { GOOGLE_NOT_CONNECTED_HINT, GOOGLE_NOT_CONNECTED_MESSAGE } from "@/lib/analytics-messages";

/**
 * Estado exibido no lugar de TODO o conteúdo do Analytics (Resumo, gráfico,
 * Campanhas) quando `analyticsPlatform=google` e o cliente não tem nenhuma
 * `import_sources` ativa com `channel='google'` — Integração Google Ads
 * (seletor de plataforma). Nunca renderizar KPIs/gráfico zerados como se
 * fossem resultado real nesse caso; este componente substitui o conteúdo
 * inteiro, não só um card.
 */
export function GoogleNotConnectedState() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState>{GOOGLE_NOT_CONNECTED_MESSAGE}</EmptyState>
      <p className="mt-2 text-xs text-muted-foreground">{GOOGLE_NOT_CONNECTED_HINT}</p>
    </div>
  );
}
