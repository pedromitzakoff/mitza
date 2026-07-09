import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";

export default async function Home() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
        <p className="text-zinc-600 dark:text-zinc-400">
          Nenhum perfil encontrado para este usuário.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseClient();
  // RLS filtra automaticamente: admin vê todos os clientes, gestor só os
  // que aparecem em client_managers para o seu usuário.
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .order("name");

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Mitza
          </h1>
          <p className="text-sm text-zinc-500">
            {profile.name} · {profile.role}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profile.role === "admin" && (
            <Link href="/painel-mensal" className="text-sm text-zinc-500 hover:underline">
              Painel geral do mês
            </Link>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Sair
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-lg font-medium text-black dark:text-zinc-50">Clientes</h2>
        {profile.role === "admin" && (
          <Link
            href="/clients/new"
            className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            + Novo cliente
          </Link>
        )}
      </div>

      <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {clients && clients.length > 0 ? (
          clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0 truncate text-black dark:text-zinc-50">
                  {client.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {client.meta_ad_account_id}
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-center text-sm text-zinc-500">
            Nenhum cliente ainda.
          </li>
        )}
      </ul>
    </div>
  );
}
