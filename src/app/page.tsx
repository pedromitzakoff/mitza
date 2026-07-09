import { getCurrentProfile } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export default async function Home() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Mitza
      </h1>
      {profile ? (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            Logado como <strong>{profile.name}</strong> ({profile.role})
          </p>
          <p className="max-w-md text-sm text-zinc-500">
            Autenticação e proteção de rotas concluídas (Etapa 2). A lista de
            clientes chega na próxima etapa.
          </p>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Sair
            </button>
          </form>
        </>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nenhum perfil encontrado para este usuário.
        </p>
      )}
    </div>
  );
}
