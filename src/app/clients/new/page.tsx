import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const supabase = await createSupabaseClient();
  const { data: managers } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("status", "ativo")
    .order("name");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-foreground">
        Novo cliente
      </h1>

      <ClientForm
        action={createClientAction}
        managers={managers ?? []}
        assignedIds={[]}
        error={error}
        submitLabel="Criar cliente"
        cancelHref="/clients"
      />
    </div>
  );
}
