/**
 * KOFF Analytics — Redesign definitivo do Cockpit: o bloco visual
 * "META ADS"/"GOOGLE ADS" (um card por canal, com moldura própria) saiu —
 * virou a quebra compacta dentro da Visão executiva
 * (`cockpit-channel-breakdown.tsx`, só renderizada com mais de um canal;
 * repetir o número de um canal só seria a mesma duplicação que o redesign
 * pediu pra eliminar). Este arquivo fica só com o tipo de "atenção de
 * dados" (`DashboardChannelDataIssue`) — ainda usado por
 * `[id]/page.tsx`/`cockpit-channel-breakdown.tsx`, mesma fonte de sempre
 * (`loadDadosPageData`/`lib/data-trust.ts`).
 */
export interface DashboardChannelDataIssue {
  severity: "error" | "warning";
  label: string;
}
