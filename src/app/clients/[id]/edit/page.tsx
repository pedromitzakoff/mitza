import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { deleteClientAction, updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";
import { DeleteClientButton } from "../../delete-client-button";
import { Section } from "../../section";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error, return_to } = await searchParams;
  const returnTo = return_to && return_to.startsWith("/") ? return_to : `/clients/${id}`;

  const supabase = await createSupabaseClient();
  const [{ data: client }, { data: allManagers }, { data: assigned }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).single(),
    supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
    supabase.from("client_managers").select("user_id, profiles(id, name)").eq("client_id", id),
  ]);

  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={returnTo} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Editar cliente
      </h1>

      <ClientForm
        action={updateClientAction.bind(null, id, returnTo)}
        managers={allManagers ?? []}
        assignedIds={assigned?.map((a) => a.user_id) ?? []}
        error={error}
        defaultName={client.name}
        defaultMetaAdAccountId={client.meta_ad_account_id}
        defaults={client}
        submitLabel="Salvar"
        cancelHref={returnTo}
      />

      <Section title="Excluir cliente">
        <p className="mb-3 text-xs text-zinc-500">
          O cliente some das listagens e para de sincronizar com o Meta, mas sprints, tarefas e
          comentários ficam preservados. Dá pra restaurar depois em Configurações &gt; Clientes
          excluídos.
        </p>
        <DeleteClientButton action={deleteClientAction.bind(null, id)} clientName={client.name} />
      </Section>
    </div>
  );
}
