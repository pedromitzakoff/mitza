import { EmptyState } from "@/components/ui/empty-state";

/**
 * Resumo Executivo — Etapa "Analytics Instagramável" (facelift): as mesmas
 * frases determinísticas (`buildExecutiveSummaryNarrative`, sem IA) agora
 * lidas como UM parágrafo corrido, não uma lista de linhas separadas —
 * pedido explícito: "mais parecido com um relatório executivo do que com um
 * textarea". Tratamento editorial (borda de destaque à esquerda, tipografia
 * maior, leading generoso) em vez do card genérico anterior. Sem base
 * suficiente pra nenhuma frase, mostra só o estado vazio — a seção continua
 * existindo (nunca some da tela), só sem conteúdo ainda.
 */
export function AnalyticsExecutiveSummary({ sentences }: { sentences: string[] }) {
  if (sentences.length === 0) {
    return <EmptyState>Ainda não há dados suficientes para um resumo executivo neste período.</EmptyState>;
  }

  return (
    <p className="border-l-2 border-brand/40 pl-4 text-base leading-relaxed text-foreground sm:text-lg">{sentences.join(" ")}</p>
  );
}
