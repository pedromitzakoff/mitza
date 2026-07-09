import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseClient();

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("id", id)
    .single();

  if (!client) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            {client.name}
          </h1>
          <p className="font-mono text-sm text-zinc-500">{client.meta_ad_account_id}</p>
        </div>

        {profile?.role === "admin" && (
          <Link
            href={`/clients/${client.id}/edit`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Editar
          </Link>
        )}
      </div>

      <p className="mt-8 text-sm text-zinc-500">
        Financeiro por sprint e tarefas chegam nas próximas etapas.
      </p>
    </div>
  );
}
