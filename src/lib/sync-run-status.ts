import type { SyncRunSummary } from "@/lib/performance-queries";

/**
 * Rótulo/cor/formatação de `data_sync_runs.status` — extraído de
 * `account-info-actions.ts` (Etapa "MEGA FACELIFT — Fase 5: Dados") pra ser
 * reaproveitado também pela nova tela Dados, sem duplicar o mapeamento nem
 * arriscar os dois textos divergirem com o tempo. Comportamento idêntico ao
 * que já existia no drawer "Informações da conta" — nenhuma mudança visual
 * ali.
 */
export const SYNC_RUN_STATUS_LABEL: Record<SyncRunSummary["status"], string> = {
  running: "Em andamento",
  success: "Sucesso",
  partial: "Parcial",
  empty: "Vazio",
  failed: "Falha",
};

export const SYNC_RUN_STATUS_BADGE_CLASSES: Record<SyncRunSummary["status"], string> = {
  running: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  success: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  partial: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  empty: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function formatSyncRunCounts(run: SyncRunSummary): string {
  const parts: string[] = [];
  if (run.rowsRead !== null) parts.push(`${run.rowsRead} lidas`);
  if (run.spendRowsWritten !== null) parts.push(`${run.spendRowsWritten} investimento`);
  if (run.performanceRowsWritten !== null) parts.push(`${run.performanceRowsWritten} performance`);
  if (run.creativeRowsWritten !== null) parts.push(`${run.creativeRowsWritten} criativos`);
  if (run.campaignRowsWritten !== null) parts.push(`${run.campaignRowsWritten} campanhas`);
  if (run.adSetRowsWritten !== null) parts.push(`${run.adSetRowsWritten} públicos`);
  if (run.placementRowsWritten !== null) parts.push(`${run.placementRowsWritten} posicionamentos`);
  return parts.join(" · ");
}
