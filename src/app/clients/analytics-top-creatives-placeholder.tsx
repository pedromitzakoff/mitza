/**
 * "Top Criativos" — placeholder puro (Etapa "Analytics Instagramável"). A
 * MITZA não persiste nome/thumbnail/resultado por criativo em nenhuma
 * tabela hoje (o Import Service descarta identidade de campanha/criativo ao
 * gravar em `daily_spend`/`daily_performance`) — nunca um card com número
 * fabricado. Skeleton em vez de só um texto "Em breve" (pedido explícito do
 * usuário): a estrutura visual já fica pronta pra receber thumbnail/nome/
 * resultado reais no dia em que essa integração existir.
 */
export function AnalyticsTopCreativesPlaceholder() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-3">
            <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Em breve — assim que a integração de criativos estiver disponível.</p>
    </div>
  );
}
