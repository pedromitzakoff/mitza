import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatRelativeDateTime } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { resolveClientMediaChannels } from "@/lib/traffic-channels";
import type { ImportSourceStatusDb } from "@/lib/supabase/database.types";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsPageShell } from "../settings-shell";
import { MetaConnectionDrawer } from "./meta-connection-drawer";
import { TestAllConnectionsButton } from "./test-all-connections-button";

const IMPORT_SOURCE_STATUS_LABEL: Record<ImportSourceStatusDb, string> = {
  active: "Ativa",
  pending: "Pendente",
  error: "Erro",
  disabled: "Desativada",
  no_data: "Sem dado",
};

interface MetaImportSourceRow {
  id: string;
  client_id: string;
  external_account_id: string;
  status: ImportSourceStatusDb;
  enabled: boolean;
  last_success_at: string | null;
}

interface MetaConnectionAudit {
  clientId: string;
  clientName: string;
  metaAdAccountId: string | null;
  hasAdAccount: boolean;
  importSource: MetaImportSourceRow | null;
  hasProblem: boolean;
}

function hasColumn(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Configurações > Integrações > Conexões Meta — auditoria pedida pra
 * responder "quais clientes ainda não estão com anúncio/campanha/público
 * conectados no Meta", sem precisar abrir o Supabase direto. Só audita
 * clientes ATIVOS (Workspace) com Meta em `media_channels` — a mesma
 * população que `syncAllClientsMetaSpend`/o cron da busca direta Meta API
 * realmente tentam sincronizar; cliente pausado ou sem Meta configurado no
 * cadastro não é "problema de conexão", é esperado não ter nada aqui.
 *
 * Duas camadas independentes, nunca confundidas:
 * 1. `clients.meta_ad_account_id` — a conta de anúncio em si (alimenta o
 *    investimento nativo, `lib/meta-sync.ts`, e também serve de sugestão
 *    pré-preenchida ao conectar a fonte `meta_api` pela primeira vez — ver
 *    `ManagedMetaConnection` abaixo).
 * 2. `import_sources` — conexão direta com a Meta API para a conta.
 *
 * "Gerenciar" (ponto 1 da migração — interface de conexão) abre
 * `MetaConnectionDrawer` pra conectar/reconectar a conta, sincronizar
 * manualmente e mapear resultados, sem precisar de SQL manual.
 */
export default async function MetaConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ manage?: string; error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { manage: manageClientId, error: drawerError, saved: drawerSaved } = await searchParams;

  const supabase = await createSupabaseClient();
  const [clients, importSources] = await Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select("id, name, meta_ad_account_id, media_channels")
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("name"),
      "clients",
    ),
    requireQuery(
      supabase
        .from("import_sources")
        .select("id, client_id, external_account_id, status, enabled, last_success_at")
        .eq("channel", "meta")
        .eq("provider", "meta_api")
        .order("enabled", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id"),
      "import_sources",
    ),
  ]);

  const importSourceByClientId = new Map<string, MetaImportSourceRow>();
  for (const row of importSources) {
    if (!importSourceByClientId.has(row.client_id)) importSourceByClientId.set(row.client_id, row);
  }

  const audits: MetaConnectionAudit[] = (clients ?? [])
    .filter((client) => resolveClientMediaChannels(client.media_channels).includes("meta"))
    .map((client) => {
      const importSource = importSourceByClientId.get(client.id) ?? null;
      const sourceHealthy = importSource !== null && importSource.enabled && importSource.status === "active";
      const hasAdAccount = hasColumn(client.meta_ad_account_id);

      return {
        clientId: client.id,
        clientName: client.name,
        metaAdAccountId: client.meta_ad_account_id,
        hasAdAccount,
        importSource,
        hasProblem: !hasAdAccount || !sourceHealthy,
      };
    })
    .sort((a, b) => {
      if (a.hasProblem !== b.hasProblem) return a.hasProblem ? -1 : 1;
      return a.clientName.localeCompare(b.clientName);
    });

  const problemCount = audits.filter((audit) => audit.hasProblem).length;

  return (
    <SettingsPageShell
      title="Conexões Meta"
      description="Conta de anúncio e integração (busca direta Meta API) por cliente ativo com Meta configurado — pra saber quem ainda falta conectar antes de fechar um relatório."
      backHref="/settings"
    >
      {audits.length === 0 ? (
        <EmptyState>Nenhum cliente ativo com Meta configurado em Canais de mídia.</EmptyState>
      ) : (
        <>
          <TestAllConnectionsButton />
          <p className="mb-4 text-sm text-muted-foreground">
            {problemCount === 0
              ? `Todos os ${audits.length} clientes Meta ativos estão com conta e integração conectadas.`
              : `${problemCount} de ${audits.length} clientes Meta ativos têm pelo menos uma conexão faltando.`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
                  <th className="px-4 py-2.5">Cliente</th>
                  <th className="px-4 py-2.5">Conta de anúncio</th>
                  <th className="px-4 py-2.5">Integração</th>
                  <th className="px-4 py-2.5">Última sincronização</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audits.map((audit) => (
                  <tr key={audit.clientId}>
                    <td className="px-4 py-2.5">
                      <Link href={`/clients/${audit.clientId}`} className="font-medium text-foreground hover:underline">
                        {audit.clientName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {audit.hasAdAccount ? (
                        <span className="text-muted-foreground">Configurada</span>
                      ) : (
                        <Link href={`/clients/${audit.clientId}/edit`} className="font-medium text-red-700 hover:underline dark:text-red-300">
                          Não configurada
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {audit.importSource === null ? (
                        <span className="font-medium text-red-700 dark:text-red-300">Sem integração</span>
                      ) : audit.importSource.enabled && audit.importSource.status === "active" ? (
                        <span className="text-muted-foreground">Ativa</span>
                      ) : (
                        <span className="font-medium text-red-700 dark:text-red-300">
                          {audit.importSource.enabled ? IMPORT_SOURCE_STATUS_LABEL[audit.importSource.status] : "Desativada"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {audit.importSource?.last_success_at ? formatRelativeDateTime(audit.importSource.last_success_at, new Date()) : "Nunca"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/settings/meta-connections?manage=${audit.clientId}`}
                        scroll={false}
                        className="font-medium text-brand hover:underline"
                      >
                        Gerenciar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {manageClientId &&
        (() => {
          const client = (clients ?? []).find((c) => c.id === manageClientId);
          if (!client) return null;
          const importSource = importSourceByClientId.get(manageClientId) ?? null;
          return (
            <ManagedMetaConnection
              clientId={manageClientId}
              clientName={client.name}
              importSource={importSource}
              suggestedAccountId={client.meta_ad_account_id}
              error={drawerError}
              saved={drawerSaved}
            />
          );
        })()}
    </SettingsPageShell>
  );
}

/** Busca os mapeamentos ativos só do cliente ABERTO no drawer — nunca pra
 * todos os clientes da lista (custo desnecessário; a tabela principal já
 * não depende de `metric_mappings`). */
async function ManagedMetaConnection({
  clientId,
  clientName,
  importSource,
  suggestedAccountId,
  error,
  saved,
}: {
  clientId: string;
  clientName: string;
  importSource: MetaImportSourceRow | null;
  /** `clients.meta_ad_account_id` — pré-preenche o campo de conexão quando
   * ainda não existe fonte `meta_api` pra este cliente. Achado real: todo
   * cliente já tem esse campo preenchido desde o cadastro, então conectar
   * vira só confirmar/clicar em vez de ir buscar o `act_...` em outro
   * lugar. Só sugestão — o admin confere/edita antes de salvar, nunca é
   * gravado sem confirmação explícita no formulário. */
  suggestedAccountId: string | null;
  error?: string;
  saved?: string;
}) {
  const supabase = await createSupabaseClient();
  const mappings = importSource
    ? await requireQuery(
        supabase
          .from("metric_mappings")
          .select("id, goal, result_column, value_column")
          .eq("import_source_id", importSource.id)
          .eq("active", true)
          .order("created_at", { ascending: true }),
        "metric_mappings:meta-connections-drawer",
      )
    : [];

  return (
    <MetaConnectionDrawer
      clientId={clientId}
      clientName={clientName}
      closeHref="/settings/meta-connections"
      error={error}
      saved={saved}
      importSource={
        importSource
          ? {
              id: importSource.id,
              externalAccountId: importSource.external_account_id,
              status: importSource.status,
              enabled: importSource.enabled,
              lastSuccessAt: importSource.last_success_at,
            }
          : null
      }
      mappings={mappings.map((m) => ({ id: m.id, goal: m.goal as PerformanceGoal, resultColumn: m.result_column, valueColumn: m.value_column }))}
      suggestedAccountId={suggestedAccountId}
    />
  );
}
