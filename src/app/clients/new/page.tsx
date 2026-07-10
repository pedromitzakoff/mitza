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
    .from("profiles")
    .select("id, name")
    .eq("role", "gestor")
    .order("name");

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Novo cliente
      </h1>

      <ClientForm
        action={createClientAction}
        managers={managers ?? []}
        assignedIds={[]}
        error={error}
        submitLabel="Criar cliente"
      />
    </div>
  );
}
