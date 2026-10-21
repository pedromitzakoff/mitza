import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SettingsPageShell } from "./settings-shell";

interface SettingsLink {
  href: string;
  title: string;
  description: string;
}

const SETTINGS_GROUPS: { label: string; items: SettingsLink[] }[] = [
  {
    label: "Equipe",
    items: [
      {
        href: "/settings/team",
        title: "Equipe",
        description: "Convidar, editar cargo/papel e desativar membros da equipe.",
      },
    ],
  },
  {
    label: "Clientes",
    items: [
      {
        href: "/settings/clients",
        title: "Clientes",
        description:
          "Cadastro, responsáveis, dados operacionais e configurações completas de cada cliente — inclusive integrações, metas e cadência de revisão.",
      },
      {
        href: "/settings/deleted-clients",
        title: "Clientes excluídos",
        description: "Ver e restaurar clientes excluídos.",
      },
    ],
  },
  {
    label: "Integrações",
    items: [
      {
        href: "/settings/meta-connections",
        title: "Conexões Meta",
        description: "Quais clientes ainda estão sem conta de anúncio, campanha, público ou anúncio conectados no Meta.",
      },
    ],
  },
];

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <SettingsPageShell title="Configurações">
      <div className="flex flex-col gap-6">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label}>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-overview-surface-hover"
                  >
                    <div>
                      <p className="text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <span className="text-zinc-400">&rarr;</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SettingsPageShell>
  );
}
