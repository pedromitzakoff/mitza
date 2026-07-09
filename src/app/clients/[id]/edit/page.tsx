import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createSupabaseClient();
  const [{ data: client }, { data: allManagers }, { data: assigned }] = await Promise.all([
    supabase.from("clients").select("id, name, meta_ad_account_id").eq("id", id).single(),
    supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
    supabase.from("client_managers").select("user_id, profiles(id, name)").eq("client_id", id),
  ]);

  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/clients/${id}`} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Editar cliente
      </h1>

      <ClientForm
        action={updateClientAction.bind(null, id)}
        managers={allManagers ?? []}
        assignedIds={assigned?.map((a) => a.user_id) ?? []}
        error={error}
        defaultName={client.name}
        defaultMetaAdAccountId={client.meta_ad_account_id}
        submitLabel="Salvar"
      />
    </div>
  );
}
