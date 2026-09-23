import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatRelativeDateTime } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { resolveClientMediaChannels } from "@/lib/traffic-channels";
import type { ImportSourceStatusDb } from "@/lib/supabase/database.types";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsPageShell } from "../settings-shell";

const IMPORT_SOURCE_STATUS_LABEL: Record<ImportSourceStatusDb, string> = {
  active: "Ativa",
  pending: "Pendente",
  error: "Erro",
  disabled: "Desativada",
  no_data: "Sem dado",
};

/** Coluna preenchida = nível populado por `runImportForSource`
 * (`lib/stract-sync.ts`) — nunca reimplementa a regra, só lê a mesma
 * configuração que decide se `campaign_daily_metrics`/`ad_set_daily_metrics`/
 * `ad_creative_daily_metrics` recebem linha pra este cliente. */
interface MetaImportSourceRow {
  client_id: string;
  status: ImportSourceStatusDb;
  enabled: boolean;
  campaign_name_column: string | null;
  ad_set_name_column: string | null;
  ad_name_column: string | null;
  creative_permalink_column: string | null;
  last_success_at: string | null;
}

interface MetaConnectionAudit {
  clientId: string;
  clientName: string;
  hasAdAccount: boolean;
  importSource: MetaImportSourceRow | null;
  hasCampaign: boolean;
  hasAudience: boolean;
  hasCreative: boolean;
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
 * população que `syncAllClientsMetaSpend`/o cron do Stract realmente
 * tentam sincronizar; cliente pausado ou sem Meta configurado no cadastro
 * não é "problema de conexão", é esperado não ter nada aqui.
 *
 * Duas camadas independentes, nunca confundidas:
 * 1. `clients.meta_ad_account_id` — a conta de anúncio em si (alimenta o
 *    investimento nativo, `lib/meta-sync.ts`).
 * 2. `import_sources` (canal "meta", sempre provider "stract" nesta etapa)
 *    — de onde vêm Campanha/Público/Anúncio granulares. Sem uma fonte ativa
 *    aqui, o cliente pode ter investimento sincronizado e mesmo assim zero
 *    campanha/público/anúncio no relatório — daí as 3 colunas separadas em
 *    vez de um único "conectado sim/não".
 */
export default async function MetaConnectionsPage() {
  await requireAdmin();

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
        .select("client_id, status, enabled, campaign_name_column, ad_set_name_column, ad_name_column, creative_permalink_column, last_success_at")
        .eq("channel", "meta"),
      "import_sources",
    ),
  ]);

  const importSourceByClientId = new Map<string, MetaImportSourceRow>((importSources ?? []).map((row) => [row.client_id, row]));

  const audits: MetaConnectionAudit[] = (clients ?? [])
    .filter((client) => resolveClientMediaChannels(client.media_channels).includes("meta"))
    .map((client) => {
      const importSource = importSourceByClientId.get(client.id) ?? null;
      const sourceHealthy = importSource !== null && importSource.enabled && importSource.status === "active";
      const hasCampaign = sourceHealthy && hasColumn(importSource.campaign_name_column);
      const hasAudience = sourceHealthy && hasColumn(importSource.ad_set_name_column);
      const hasCreative = sourceHealthy && (hasColumn(importSource.ad_name_column) || hasColumn(importSource.creative_permalink_column));
      const hasAdAccount = hasColumn(client.meta_ad_account_id);

      return {
        clientId: client.id,
        clientName: client.name,
        hasAdAccount,
        importSource,
        hasCampaign,
        hasAudience,
        hasCreative,
        hasProblem: !hasAdAccount || !sourceHealthy || !hasCampaign || !hasAudience || !hasCreative,
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
      description="Conta de anúncio, campanha, público e anúncio (criativo) sincronizados por cliente ativo com Meta configurado — pra saber onde corrigir a integração antes de fechar um relatório."
      backHref="/settings"
    >
      {audits.length === 0 ? (
        <EmptyState>Nenhum cliente ativo com Meta configurado em Canais de mídia.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {problemCount === 0
              ? `Todos os ${audits.length} clientes Meta ativos estão com conta, campanha, público e anúncio conectados.`
              : `${problemCount} de ${audits.length} clientes Meta ativos têm pelo menos uma conexão faltando.`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
                  <th className="px-4 py-2.5">Cliente</th>
                  <th className="px-4 py-2.5">Conta de anúncio</th>
                  <th className="px-4 py-2.5">Integração</th>
                  <th className="px-4 py-2.5">Campanha</th>
                  <th className="px-4 py-2.5">Público</th>
                  <th className="px-4 py-2.5">Anúncio</th>
                  <th className="px-4 py-2.5">Última sincronização</th>
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
                    <td className="px-4 py-2.5">
                      {audit.importSource === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : audit.hasCampaign ? (
                        <span className="text-muted-foreground">Conectada</span>
                      ) : (
                        <span className="font-medium text-red-700 dark:text-red-300">Não mapeada</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {audit.importSource === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : audit.hasAudience ? (
                        <span className="text-muted-foreground">Conectado</span>
                      ) : (
                        <span className="font-medium text-red-700 dark:text-red-300">Não mapeado</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {audit.importSource === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : audit.hasCreative ? (
                        <span className="text-muted-foreground">Conectado</span>
                      ) : (
                        <span className="font-medium text-red-700 dark:text-red-300">Não mapeado</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {audit.importSource?.last_success_at ? formatRelativeDateTime(audit.importSource.last_success_at, new Date()) : "Nunca"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SettingsPageShell>
  );
}
