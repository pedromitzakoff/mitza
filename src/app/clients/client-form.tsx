type Manager = { id: string; name: string };

export function ClientForm({
  action,
  managers,
  assignedIds,
  error,
  defaultName,
  defaultMetaAdAccountId,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  managers: Manager[];
  assignedIds: string[];
  error?: string;
  defaultName?: string;
  defaultMetaAdAccountId?: string;
  submitLabel: string;
}) {
  const assigned = new Set(assignedIds);

  return (
    <form
      action={action}
      className="mt-6 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Nome
        <input
          name="name"
          required
          defaultValue={defaultName}
          className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Conta de anúncios (Meta)
        <input
          name="meta_ad_account_id"
          required
          placeholder="act_1234567890"
          pattern="act_[0-9]+"
          title="Formato: act_ seguido de números"
          defaultValue={defaultMetaAdAccountId}
          className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-zinc-700 dark:text-zinc-300">Gestores</legend>
        {managers.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nenhum gestor cadastrado ainda (crie usuários no Supabase Auth primeiro).
          </p>
        )}
        {managers.map((manager) => (
          <label
            key={manager.id}
            className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
          >
            <input
              type="checkbox"
              name="manager_ids"
              value={manager.id}
              defaultChecked={assigned.has(manager.id)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            {manager.name}
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
      >
        {submitLabel}
      </button>
    </form>
  );
}
