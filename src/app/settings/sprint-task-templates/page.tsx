import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { CLIENT_CONTRACT_STATUS_REGISTRY } from "@/lib/status-registry";
import { SprintTaskTemplatesList, type GlobalTemplateItem } from "../sprint-task-templates-list";
import { BackfillButton } from "./backfill-button";
import { SettingsPageShell } from "../settings-shell";

export default async function SprintTaskTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ templateError?: string }>;
}) {
  await requireAdmin();
  const { templateError } = await searchParams;

  const supabase = await createSupabaseClient();

  const [templates, templateClients, clients, managers, taskLinks] = await Promise.all([
    requireQuery(
      supabase
        .from("sprint_task_templates")
        .select("id, title, type, weekday, is_active, applies_to_all, default_assignee_id")
        .order("weekday"),
      "sprint_task_templates",
    ),
    requireQuery(
      supabase.from("sprint_task_template_clients").select("template_id, client_id"),
      "sprint_task_template_clients",
    ),
    requireQuery(
      supabase.from("clients").select("id, name, status").is("deleted_at", null).order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(supabase.from("tasks").select("template_id").not("template_id", "is", null), "tasks:template_id"),
  ]);

  // Área administrativa: continua mostrando clientes pausados/encerrados
  // (nunca trata este vínculo de template como parte da operação
  // corrente), mas prioriza ativos na ordenação — badge de status entra
  // em `sprint-task-templates-list.tsx`.
  const sortedClients = [...clients].sort((a, b) => {
    const rankDiff =
      CLIENT_CONTRACT_STATUS_REGISTRY[`client_contract.${a.status}`].order -
      CLIENT_CONTRACT_STATUS_REGISTRY[`client_contract.${b.status}`].order;
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });

  const clientIdsByTemplate = new Map<string, string[]>();
  for (const row of templateClients) {
    const list = clientIdsByTemplate.get(row.template_id) ?? [];
    list.push(row.client_id);
    clientIdsByTemplate.set(row.template_id, list);
  }

  const templatesWithGeneratedTasks = new Set(taskLinks.map((row) => row.template_id));

  const templateItems: GlobalTemplateItem[] = templates.map((template) => ({
    ...template,
    selectedClientIds: clientIdsByTemplate.get(template.id) ?? [],
    hasGeneratedTasks: templatesWithGeneratedTasks.has(template.id),
  }));

  return (
    <SettingsPageShell
      title="Tarefas padrão de sprint"
      description={
        <>
          Essas tarefas são geradas automaticamente em cada sprint nova, no dia da semana configurado. Editar um template não altera
          tarefas já geradas — só as futuras (ou as sprints existentes, se você clicar em &quot;Aplicar às sprints já
          existentes&quot;).
        </>
      }
      actions={<BackfillButton />}
      backHref="/settings"
    >
      {templateError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {templateError}
        </p>
      )}

      <SprintTaskTemplatesList
        templates={templateItems}
        managers={managers ?? []}
        clients={sortedClients}
      />
    </SettingsPageShell>
  );
}
