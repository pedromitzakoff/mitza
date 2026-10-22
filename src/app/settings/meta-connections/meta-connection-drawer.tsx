import Link from "next/link";
import { formatRelativeDateTime } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { ImportSourceStatusDb } from "@/lib/supabase/database.types";
import { SubmitButton } from "@/app/submit-button";
import { ToastActionButton } from "@/app/toast-action-button";
import {
  connectMetaApiAccountAction,
  deactivateMetricMappingAction,
  runMetaApiBackfillAction,
  saveMetricMappingAction,
  syncMetaConnectionAction,
} from "./actions";
import { ActionTypePicker } from "./action-type-picker";

const inputClasses = "rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500";
const labelClasses = "flex flex-col gap-1 text-sm text-foreground";

const IMPORT_SOURCE_STATUS_LABEL: Record<ImportSourceStatusDb, string> = {
  active: "Ativa",
  pending: "Pendente (aguardando 1ª sincronização)",
  error: "Erro",
  disabled: "Desativada",
  no_data: "Sem dado",
};

function DrawerShell({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-overview-surface-hover"
          >
            Fechar
          </Link>
        </div>
        {children}
      </div>
    </>
  );
}

export interface MetaConnectionImportSource {
  id: string;
  externalAccountId: string;
  status: ImportSourceStatusDb;
  enabled: boolean;
  lastSuccessAt: string | null;
}

export interface MetaConnectionMapping {
  id: string;
  goal: PerformanceGoal;
  resultColumn: string;
  valueColumn: string | null;
}

/**
 * Evolução de `/settings/meta-connections` (ponto 1 do pedido de migração):
 * conectar/reconectar uma conta Meta, ver status, sincronizar manualmente e
 * mapear resultados — tudo nesta tela, sem SQL manual pro uso cotidiano.
 * Cadastro inicial (SQL) continua documentado em
 * `docs/N8N_META_INGESTION_GUIDE.md` só como referência histórica — esta
 * tela é o caminho real a partir de agora.
 */
export function MetaConnectionDrawer({
  clientId,
  clientName,
  closeHref,
  error,
  saved,
  importSource,
  mappings,
  legacyStractSource,
}: {
  clientId: string;
  clientName: string;
  closeHref: string;
  error?: string;
  saved?: string;
  importSource: MetaConnectionImportSource | null;
  mappings: MetaConnectionMapping[];
  legacyStractSource: { externalAccountId: string; enabled: boolean } | null;
}) {
  return (
    <DrawerShell title={`Conexão Meta — ${clientName}`} closeHref={closeHref}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {saved && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{saved}</p>
      )}

      {legacyStractSource && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-muted-foreground dark:bg-zinc-900">
          Fonte Stract antiga encontrada ({legacyStractSource.externalAccountId}
          {legacyStractSource.enabled ? ", ainda habilitada no cadastro — sem efeito, o motor Stract foi removido do código" : ", desativada"}).
          Histórico preservado, nenhuma ação necessária.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Conta Meta (busca direta)</h3>
        <form action={connectMetaApiAccountAction.bind(null, clientId)} className="flex flex-col gap-3">
          <label className={labelClasses}>
            ID da conta de anúncio
            <input
              name="account_id"
              required
              defaultValue={importSource?.externalAccountId ?? ""}
              placeholder="act_123456789"
              className={inputClasses}
            />
          </label>
          <SubmitButton
            className="self-start rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
            pendingChildren="Validando na Meta…"
          >
            {importSource ? "Atualizar conexão" : "Conectar"}
          </SubmitButton>
        </form>

        {importSource && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium text-foreground">
                {importSource.enabled ? IMPORT_SOURCE_STATUS_LABEL[importSource.status] : "Desativada"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Última sincronização</span>
              <span className="font-medium text-foreground">
                {importSource.lastSuccessAt ? formatRelativeDateTime(importSource.lastSuccessAt, new Date()) : "Nunca"}
              </span>
            </div>
            <ToastActionButton
              action={syncMetaConnectionAction.bind(null, importSource.externalAccountId)}
              pendingLabel="Sincronizando…"
              className="mt-1 self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-overview-surface-hover"
            >
              Sincronizar agora
            </ToastActionButton>
          </div>
        )}
      </section>

      {importSource && (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Mapeamento de resultados</h3>
          {mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum mapeamento ativo — investimento/campanhas continuam sendo gravados normalmente, mas leads/vendas/seguidores não
              aparecem até existir pelo menos um mapeamento.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {mappings.map((mapping) => (
                <li key={mapping.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{PERFORMANCE_GOALS[mapping.goal].label}</span>
                    <span className="text-muted-foreground"> — {mapping.resultColumn}</span>
                    {mapping.valueColumn && <span className="text-muted-foreground"> + {mapping.valueColumn}</span>}
                  </div>
                  <ToastActionButton
                    action={deactivateMetricMappingAction.bind(null, mapping.id)}
                    pendingLabel="Desativando…"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-overview-surface-hover"
                  >
                    Desativar
                  </ToastActionButton>
                </li>
              ))}
            </ul>
          )}

          <ActionTypePicker
            accountId={importSource.externalAccountId}
            saveMappingAction={saveMetricMappingAction.bind(null, importSource.id, clientId)}
          />
        </section>
      )}

      {importSource && (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Backfill histórico</h3>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            A sincronização normal (cron de 5 min) só busca os últimos 3 dias — isto aqui busca um período passado inteiro, em lotes.
            Idempotente (pode rodar de novo sem duplicar), mas é uma operação pesada: confirme o intervalo antes de clicar.
          </p>
          <form action={runMetaApiBackfillAction.bind(null, importSource.externalAccountId, clientId)} className="flex flex-col gap-3">
            <div className="flex gap-3">
              <label className={`${labelClasses} flex-1`}>
                De
                <input type="date" name="since" required className={inputClasses} />
              </label>
              <label className={`${labelClasses} flex-1`}>
                Até
                <input type="date" name="until" required className={inputClasses} />
              </label>
            </div>
            <SubmitButton
              className="self-start rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950"
              pendingChildren="Rodando backfill… pode levar alguns minutos"
            >
              Iniciar backfill histórico real
            </SubmitButton>
          </form>
        </section>
      )}
    </DrawerShell>
  );
}
