/** Rótulo do filtro de plataforma da Visão Geral — reaproveitado por
 * `src/app/page.tsx` ("Investimento em mídia dos clientes") pra nunca
 * duplicar este mapa em dois arquivos.
 *
 * Etapa "MITZA 2.0 — Fase E": as tabelas por objetivo (Leads/Vendas/Sem
 * objetivo) que este arquivo renderizava foram removidas do Painel Geral —
 * essa listagem cliente a cliente pertence à Operação/Árvore Viva, não a um
 * painel que só agrega (ver constituição do produto). `PLATFORM_LABEL` é o
 * único export deste arquivo que sobrevive, ainda usado fora dele. */
export const PLATFORM_LABEL: Record<"consolidado" | "meta" | "google", string> = {
  consolidado: "Consolidado",
  meta: "Meta",
  google: "Google",
};
