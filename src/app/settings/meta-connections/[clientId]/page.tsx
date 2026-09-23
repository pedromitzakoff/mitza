import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatRelativeDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { updateImportSourceAction } from "@/app/clients/stract-sync-actions";
import { SubmitButton } from "@/app/submit-button";
import { SettingsPageShell } from "../../settings-shell";

const INPUT_CLASSES =
  "min-h-9 w-full rounded-md border border-border bg-transparent px-2.5 text-sm text-foreground placeholder:text-muted-foreground";
const LABEL_CLASSES = "text-xs font-medium text-muted-foreground";
const SAVE_BUTTON_CLASSES =
  "mitza-pressable inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

interface StractImportSourceRow {
  id: string;
  channel: string;
  table_name: string;
  external_account_id: string;
  account_id_column: string;
  date_column: string;
  spend_column: string;
  campaign_name_column: string | null;
  campaign_name_filter: string | null;
  campaign_name_exclude: string | null;
  campaign_id_column: string | null;
  ad_set_name_column: string | null;
  ad_name_column: string | null;
  creative_permalink_column: string | null;
  preview_image_column: string | null;
  preview_image_fallback_column: string | null;
  impressions_column: string | null;
  reach_column: string | null;
  clicks_column: string | null;
  platform_position_column: string | null;
  enabled: boolean;
  status: string;
  last_success_at: string | null;
}

function Field({ name, label, defaultValue, required, placeholder }: { name: string; label: string; defaultValue: string | null; required?: boolean; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASSES}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input type="text" name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} className={INPUT_CLASSES} />
    </label>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * Editor completo de integração Stract (Etapa "Editor de Integração
 * Stract") — pedido explícito do usuário: 17 de 26 clientes Meta ativos têm
 * pelo menos uma conexão faltando (ver `/settings/meta-connections`), e
 * reconfigurar isso pelo SQL Editor toda vez que a extração do Stract muda
 * "vai dar o triplo de trabalho". Esta tela edita TODOS os campos de
 * `import_sources` de uma fonte Stract (nome bruto de coluna/tabela da
 * origem só existe aqui e em `lib/stract-sync.ts` — nunca em outro lugar da
 * MITZA), sem SQL.
 *
 * Só EDITA fontes já existentes (escopo combinado com o usuário) — conectar
 * um cliente do zero continua manual (mesmo processo de sempre: achar a
 * tabela, confirmar conta, `import_sources`+`metric_mappings` iniciais).
 * Admin-only, mesmo critério de toda a área de Configurações.
 */
export default async function EditImportSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { clientId } = await params;
  const { error, saved } = await searchParams;

  const supabase = await createSupabaseClient();

  const [clientRows, importSources] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:edit-import-source"),
    requireQuery(
      supabase
        .from("import_sources")
        .select(
          "id, channel, table_name, external_account_id, account_id_column, date_column, spend_column, campaign_name_column, campaign_name_filter, campaign_name_exclude, campaign_id_column, ad_set_name_column, ad_name_column, creative_permalink_column, preview_image_column, preview_image_fallback_column, impressions_column, reach_column, clicks_column, platform_position_column, enabled, status, last_success_at",
        )
        .eq("client_id", clientId)
        .eq("provider", "stract")
        .order("channel"),
      "import_sources:edit",
    ),
  ]);

  const client = clientRows[0];
  if (!client) notFound();

  const sources = (importSources ?? []) as StractImportSourceRow[];

  return (
    <SettingsPageShell title={`Integração Stract — ${client.name}`} description="Editar diretamente a configuração da fonte, sem SQL." backHref="/settings/meta-connections">
      <p className="mb-4 text-sm">
        <Link href={`/clients/${client.id}`} className="font-medium text-brand hover:underline">
          Ver página do cliente →
        </Link>
      </p>

      {saved && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">Configuração salva.</p>}
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {sources.length === 0 ? (
        <EmptyState>Este cliente não tem nenhuma fonte Stract configurada — conexão nova continua feita manualmente (SQL).</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {sources.map((source) => (
            <form
              key={source.id}
              action={updateImportSourceAction.bind(null, source.id, client.id)}
              className="flex flex-col gap-4 rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Canal: {source.channel}</p>
                <p className="text-xs text-muted-foreground">
                  Status: {source.status} · Última sincronização: {source.last_success_at ? formatRelativeDateTime(source.last_success_at, new Date()) : "Nunca"}
                </p>
              </div>

              <FieldGroup title="Identidade da fonte">
                <Field name="table_name" label="Tabela (Stract)" defaultValue={source.table_name} required />
                <Field name="external_account_id" label="Conta de anúncio (act_...)" defaultValue={source.external_account_id} required />
              </FieldGroup>

              <FieldGroup title="Colunas comuns">
                <Field name="account_id_column" label="Coluna de conta" defaultValue={source.account_id_column} required />
                <Field name="date_column" label="Coluna de data" defaultValue={source.date_column} required />
                <Field name="spend_column" label="Coluna de investimento" defaultValue={source.spend_column} required />
              </FieldGroup>

              <FieldGroup title="Campanha">
                <Field name="campaign_name_column" label="Coluna de nome" defaultValue={source.campaign_name_column} />
                <Field name="campaign_id_column" label="Coluna de ID (opcional)" defaultValue={source.campaign_id_column} />
                <Field name="campaign_name_filter" label="Incluir só campanhas com (opcional)" defaultValue={source.campaign_name_filter} />
                <Field name="campaign_name_exclude" label="Excluir campanhas com (opcional)" defaultValue={source.campaign_name_exclude} />
              </FieldGroup>

              <FieldGroup title="Público">
                <Field name="ad_set_name_column" label="Coluna de nome do público" defaultValue={source.ad_set_name_column} />
              </FieldGroup>

              <FieldGroup title="Anúncio / Criativo">
                <Field name="ad_name_column" label="Coluna de nome do anúncio" defaultValue={source.ad_name_column} />
                <Field name="creative_permalink_column" label="Coluna de link do criativo" defaultValue={source.creative_permalink_column} />
                <Field name="preview_image_column" label="Coluna de imagem de prévia" defaultValue={source.preview_image_column} />
                <Field name="preview_image_fallback_column" label="Coluna de imagem (fallback)" defaultValue={source.preview_image_fallback_column} />
              </FieldGroup>

              <FieldGroup title="Métricas extras">
                <Field name="impressions_column" label="Coluna de impressões" defaultValue={source.impressions_column} />
                <Field name="reach_column" label="Coluna de alcance" defaultValue={source.reach_column} />
                <Field name="clicks_column" label="Coluna de cliques" defaultValue={source.clicks_column} />
              </FieldGroup>

              <FieldGroup title="Posicionamentos">
                <Field
                  name="platform_position_column"
                  label="Coluna de posicionamento"
                  defaultValue={source.platform_position_column}
                  placeholder="ex.: breakdowns_platform_position"
                />
              </FieldGroup>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" name="enabled" defaultChecked={source.enabled} className="h-4 w-4" />
                  Fonte ativa (lida pela Sprint/Dashboard/Relatórios)
                </label>
                <SubmitButton pendingChildren="Salvando..." className={SAVE_BUTTON_CLASSES}>
                  Salvar
                </SubmitButton>
              </div>
            </form>
          ))}
        </div>
      )}
    </SettingsPageShell>
  );
}
