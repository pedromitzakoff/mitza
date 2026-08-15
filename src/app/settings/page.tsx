import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SettingsPageShell } from "./settings-shell";

interface SettingsLink {
  href: string;
  title: string;
  description: string;
}

/** Agrupamento do índice (Etapa "Evolução da Settings") — a auditoria
 * mostrou só 2 famílias reais por trás das 4 telas, não os 5-6 grupos de
 * referência inicialmente cogitados: cadastro/arquivo de Clientes, e os
 * modelos operacionais aplicados a eles (Tarefas padrão de sprint +
 * Recorrências, hoje com implementação quase gêmea). "Rotina operacional"
 * (não "Planejamento") de propósito — "Planejamento" já é o termo fixo do
 * produto pra orçamento mensal (`resolveClientMonthlyPlan`,
 * MonthInvestmentSummary); reaproveitar a palavra aqui criaria uma
 * ambiguidade nova em vez de resolver uma. */
const SETTINGS_GROUPS: { label: string; items: SettingsLink[] }[] = [
  {
    label: "Clientes",
    items: [
      {
        href: "/settings/clients",
        title: "Clientes",
        description: "Cadastro e dados estruturais: contrato, contatos, comercial e contexto estratégico.",
      },
      {
        href: "/settings/deleted-clients",
        title: "Clientes excluídos",
        description: "Ver e restaurar clientes excluídos.",
      },
    ],
  },
  {
    label: "Rotina operacional",
    items: [
      {
        href: "/settings/sprint-task-templates",
        title: "Tarefas padrão de sprint",
        description: "Plano operacional aplicado a todos os clientes ou a clientes selecionados.",
      },
      {
        href: "/settings/recurring-tasks",
        title: "Recorrências",
        description:
          "Checar saldo, Reportar cliente, Otimização e outras tarefas permanentes — meta semanal e histórico, nunca uma tarefa nova por sprint.",
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
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
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
