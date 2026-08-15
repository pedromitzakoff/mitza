import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { RestoreClientButton } from "./restore-client-button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateFromInstant } from "@/lib/format";
import { SettingsPageShell } from "../settings-shell";

export default async function DeletedClientsPage() {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return (
    <SettingsPageShell
      title="Clientes excluídos"
      description="Sprints, tarefas e comentários desses clientes continuam preservados. Restaurar faz o cliente voltar a aparecer nas listagens normais."
      backHref="/settings"
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        {clients && clients.length > 0 ? (
          clients.map((client) => (
            <li
              key={client.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-foreground">{client.name}</p>
                <p className="text-xs text-muted-foreground">
                  {client.meta_ad_account_id} · excluído em{" "}
                  {formatDateFromInstant(client.deleted_at!)}
                </p>
              </div>
              <RestoreClientButton clientId={client.id} clientName={client.name} />
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-center">
            <EmptyState>Nenhum cliente excluído.</EmptyState>
          </li>
        )}
      </ul>
    </SettingsPageShell>
  );
}
