import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { restoreClientAction } from "@/app/clients/actions";

export default async function DeletedClientsPage() {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Clientes excluídos
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Sprints, tarefas e comentários desses clientes continuam preservados. Restaurar faz o
        cliente voltar a aparecer nas listagens normais.
      </p>

      <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {clients && clients.length > 0 ? (
          clients.map((client) => (
            <li
              key={client.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-black dark:text-zinc-50">{client.name}</p>
                <p className="text-xs text-zinc-500">
                  {client.meta_ad_account_id} · excluído em{" "}
                  {new Date(client.deleted_at!).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <form action={restoreClientAction.bind(null, client.id)}>
                <button
                  type="submit"
                  className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
                >
                  Restaurar
                </button>
              </form>
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-center text-sm text-zinc-500">
            Nenhum cliente excluído.
          </li>
        )}
      </ul>
    </div>
  );
}
