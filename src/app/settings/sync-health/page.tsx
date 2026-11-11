import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { findCampaignDataGaps } from "@/lib/meta-api-gap-detection";
import { runMetaApiBackfillAction } from "../meta-connections/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsPageShell, SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings-shell";
import { SubmitButton } from "@/app/submit-button";

/**
 * Configurações > Integrações > Diagnóstico de sincronização — Etapa
 * "Diagnóstico de sincronização", criada a partir de um achado real
 * (11/2026): um bug de schema (coluna `link_clicks` ausente em
 * `campaign_daily_metrics`/`ad_set_daily_metrics`/`ad_creative_daily_metrics`,
 * corrigido em `supabase/meta-ads-link-clicks.sql`) bloqueava toda gravação
 * de campanha/conjunto/criativo sem impedir a gravação de investimento
 * agregado — sintoma: conta com investimento real registrado num dia, mas
 * nenhuma campanha gravada no mesmo dia. `findCampaignDataGaps`
 * (`lib/meta-api-gap-detection.ts`) aponta esse padrão pra QUALQUER causa
 * futura (não só este incidente) — ferramenta permanente, não um script de
 * uso único.
 *
 * Corrigir um gap reaproveita INTEGRALMENTE o backfill histórico já
 * existente e já aprovado (`runMetaApiBackfillAction`,
 * `settings/meta-connections/actions.ts`) — esta tela nunca grava nada
 * sozinha, só encontra o intervalo certo e pré-preenche o mesmo formulário
 * que já existia. `return_to` traz de volta pra esta lista depois de
 * corrigir, pra descer pelos gaps um a um sem perder o lugar.
 */
export default async function SyncHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { error, saved } = await searchParams;

  const supabase = await createSupabaseClient();
  const gaps = await findCampaignDataGaps(supabase);

  return (
    <SettingsPageShell
      title="Diagnóstico de sincronização"
      description="Contas com investimento registrado num dia, mas sem campanha/conjunto/criativo gravado no mesmo dia — sinal de falha de gravação, nunca de ausência real de investimento."
      backHref="/settings"
    >
      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      {saved && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">{saved}</p>
      )}

      {gaps.length === 0 ? (
        <EmptyState>Nenhum gap encontrado nos últimos 60 dias — toda conta Meta API direta tem campanha gravada em todo dia com investimento.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-overview-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-overview-surface-subtle">
              <tr>
                <th className="px-3.5 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-overview-text-muted">Cliente</th>
                <th className="px-3.5 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-overview-text-muted">Período sem campanha</th>
                <th className="px-3.5 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-overview-text-muted">Dias faltando</th>
                <th className="px-3.5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap) => (
                <tr key={gap.clientId} className="border-t border-overview-border/60">
                  <td className="px-3.5 py-2.5 font-medium text-overview-text-primary">{gap.clientName}</td>
                  <td className="px-3.5 py-2.5 text-overview-text-secondary tabular-nums">
                    {gap.since} a {gap.until}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{gap.missingDayCount}</td>
                  <td className="px-3.5 py-2.5 text-right">
                    <form action={runMetaApiBackfillAction.bind(null, gap.accountId, gap.clientId)}>
                      <input type="hidden" name="since" value={gap.since} />
                      <input type="hidden" name="until" value={gap.until} />
                      <input type="hidden" name="return_to" value="/settings/sync-health" />
                      <SubmitButton pendingChildren="Corrigindo..." className={`${SETTINGS_SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs`}>
                        Corrigir
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsPageShell>
  );
}
