import { EmptyState } from "@/components/ui/empty-state";

/**
 * Resumo Executivo — Etapa "Analytics Instagramável": frases corridas
 * (`buildExecutiveSummaryNarrative`, 100% determinístico, sem IA), pensadas
 * pra "parecer uma apresentação, não um dashboard técnico" (pedido explícito
 * do usuário). Sem base suficiente pra nenhuma frase, mostra só o estado
 * vazio — a seção continua existindo (nunca some da tela), só sem conteúdo
 * ainda.
 */
export function AnalyticsExecutiveSummary({ sentences }: { sentences: string[] }) {
  if (sentences.length === 0) {
    return <EmptyState>Ainda não há dados suficientes para um resumo executivo neste período.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-2">
      {sentences.map((sentence, index) => (
        <p key={index} className="text-sm leading-relaxed text-foreground">
          {sentence}
        </p>
      ))}
    </div>
  );
}
