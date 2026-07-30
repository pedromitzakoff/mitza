/**
 * MITZA Score — placeholder puro (Etapa "Analytics Instagramável"). Pedido
 * explícito do usuário: nenhuma regra, nenhum cálculo, nenhum algoritmo
 * agora — só a estrutura visual reservando o espaço pro recurso futuro, com
 * destaque suficiente pra despertar curiosidade ("o que é esse Score?").
 * Borda tracejada é o mesmo sinal visual usado em `AnalyticsTopCreativesPlaceholder`
 * pra "isso ainda não é dado real" — nunca a mesma moldura sólida dos cards
 * com número de verdade.
 */
export function AnalyticsScorePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">MITZA Score</p>
      <p className="text-3xl font-semibold tracking-[0.3em] text-foreground/30">●●●○○</p>
      <p className="text-xs text-muted-foreground">Em breve</p>
    </div>
  );
}
