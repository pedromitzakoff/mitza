import { EmptyState } from "@/components/ui/empty-state";
import { NO_LEARNINGS_MESSAGE } from "@/lib/analytics-messages";

/**
 * Narrativa do Capítulo III ("O que aprendemos?") — as mesmas frases
 * determinísticas (`buildLearningsNarrative`, sem IA) lidas como UM
 * parágrafo corrido de prosa de verdade — serifa reta (não itálica: isto é
 * o corpo do relatório, não uma citação de destaque), leading generoso,
 * mesma família tipográfica da manchete/lide do Capítulo I. Sem base
 * suficiente pra nenhuma frase, mostra só o estado vazio — o capítulo
 * continua existindo, só sem conteúdo ainda.
 */
export function AnalyticsExecutiveSummary({ sentences }: { sentences: string[] }) {
  if (sentences.length === 0) {
    return <EmptyState>{NO_LEARNINGS_MESSAGE}</EmptyState>;
  }

  return <p className="max-w-2xl font-serif text-[1.0625rem] leading-[1.75] text-foreground">{sentences.join(" ")}</p>;
}
