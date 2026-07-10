import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Configurações</h1>

      <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <li>
          <Link
            href="/settings/clients"
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <div>
              <p className="text-black dark:text-zinc-50">Clientes</p>
              <p className="text-xs text-zinc-500">
                Cadastro e dados estruturais: contrato, contatos, comercial e contexto estratégico.
              </p>
            </div>
            <span className="text-zinc-400">&rarr;</span>
          </Link>
        </li>
        <li>
          <Link
            href="/settings/sprint-task-templates"
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <div>
              <p className="text-black dark:text-zinc-50">Tarefas padrão de sprint</p>
              <p className="text-xs text-zinc-500">
                Plano operacional aplicado a todos os clientes ou a clientes selecionados.
              </p>
            </div>
            <span className="text-zinc-400">&rarr;</span>
          </Link>
        </li>
        <li>
          <Link
            href="/settings/deleted-clients"
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <div>
              <p className="text-black dark:text-zinc-50">Clientes excluídos</p>
              <p className="text-xs text-zinc-500">Ver e restaurar clientes excluídos.</p>
            </div>
            <span className="text-zinc-400">&rarr;</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
