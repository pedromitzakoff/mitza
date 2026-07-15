import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { SprintTaskTemplatesList, type GlobalTemplateItem } from "../sprint-task-templates-list";
import { runBackfillAction } from "../sprint-task-templates-actions";
import { SubmitButton } from "@/app/submit-button";

export default async function SprintTaskTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ templateError?: string; backfilled?: string }>;
}) {
  await requireAdmin();
  const { templateError, backfilled } = await searchParams;

  const supabase = await createSupabaseClient();

  const [{ data: templates }, { data: templateClients }, { data: clients }, { data: managers }, { data: taskLinks }] =
    await Promise.all([
      supabase
        .from("sprint_task_templates")
        .select("id, title, type, weekday, is_active, applies_to_all, default_assignee_id")
        .order("weekday"),
      supabase.from("sprint_task_template_clients").select("template_id, client_id"),
      supabase.from("clients").select("id, name").is("deleted_at", null).order("name"),
      supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
      supabase.from("tasks").select("template_id").not("template_id", "is", null),
    ]);

  const clientIdsByTemplate = new Map<string, string[]>();
  for (const row of templateClients ?? []) {
    const list = clientIdsByTemplate.get(row.template_id) ?? [];
    list.push(row.client_id);
    clientIdsByTemplate.set(row.template_id, list);
  }

  const templatesWithGeneratedTasks = new Set((taskLinks ?? []).map((row) => row.template_id));

  const templateItems: GlobalTemplateItem[] = (templates ?? []).map((template) => ({
    ...template,
    selectedClientIds: clientIdsByTemplate.get(template.id) ?? [],
    hasGeneratedTasks: templatesWithGeneratedTasks.has(template.id),
  }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Tarefas padrão de sprint
        </h1>
        <form action={runBackfillAction}>
          <SubmitButton
            pendingChildren="Aplicando..."
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Aplicar às sprints já existentes
          </SubmitButton>
        </form>
      </div>

      <p className="mt-2 text-sm text-zinc-500">
        Essas tarefas são geradas automaticamente em cada sprint nova, no dia da semana
        configurado. Editar um template não altera tarefas já geradas — só as futuras (ou as
        sprints existentes, se você clicar em &quot;Aplicar às sprints já existentes&quot;).
      </p>

      {templateError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {templateError}
        </p>
      )}

      {backfilled && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Geração aplicada às sprints existentes.
        </p>
      )}

      <div className="mt-6">
        <SprintTaskTemplatesList
          templates={templateItems}
          managers={managers ?? []}
          clients={clients ?? []}
        />
      </div>
    </div>
  );
}
