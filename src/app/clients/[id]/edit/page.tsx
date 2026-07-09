import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";
import { TaskTemplatesList } from "../../task-templates-list";
import { Section } from "../../section";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; templateError?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error, templateError } = await searchParams;

  const supabase = await createSupabaseClient();
  const [{ data: client }, { data: allManagers }, { data: assigned }, { data: templates }] =
    await Promise.all([
      supabase.from("clients").select("id, name, meta_ad_account_id").eq("id", id).single(),
      supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
      supabase.from("client_managers").select("user_id, profiles(id, name)").eq("client_id", id),
      supabase
        .from("client_task_templates")
        .select("id, title, type, weekday, is_active, default_assignee_id")
        .eq("client_id", id)
        .order("weekday"),
    ]);

  if (!client) notFound();

  const assignedManagers = (assigned ?? []).flatMap((a) => (a.profiles ? [a.profiles] : []));

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

      <Section title="Plano operacional padrão">
        <p className="mb-3 text-xs text-zinc-500">
          Essas tarefas são geradas automaticamente em cada sprint nova, no dia da semana
          configurado. Mudar um template aqui não altera tarefas já geradas — só as futuras.
        </p>

        {templateError && (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {templateError}
          </p>
        )}

        <TaskTemplatesList
          templates={templates ?? []}
          managers={assignedManagers}
          clientId={id}
        />
      </Section>
    </div>
  );
}
