import Link from "next/link";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { ClientPriority } from "@/lib/client-priority";

const SEVERITY_LABEL: Record<AccountHealth, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  saudavel: "Normal",
};

const SEVERITY_BADGE_CLASSES: Record<AccountHealth, string> = {
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

function ageLabel(days: number | null): string {
  if (days === null) return "—";
  return `${days} dia${days !== 1 ? "s" : ""} úteis`;
}

function PriorityRow({
  priority,
  managerName,
}: {
  priority: ClientPriority;
  managerName: string | null;
}) {
  const issue = priority.primaryIssue!;
  return (
    <li className="-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link href={`/clients/${priority.clientId}`} className="truncate text-sm font-semibold text-foreground hover:underline">
            {priority.clientName}
          </Link>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE_CLASSES[priority.severity]}`}>
            {SEVERITY_LABEL[priority.severity]}
          </span>
          {priority.secondaryCount > 0 && (
            <span
              className="shrink-0 text-[11px] text-muted-foreground"
              title={priority.secondaryIssues.map((i) => i.title).join(" · ")}
            >
              +{priority.secondaryCount} outro{priority.secondaryCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground">{issue.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {ageLabel(priority.issueAgeBusinessDays)}
          {managerName ? ` · ${managerName}` : ""}
        </p>
      </div>
      <Link
        href={issue.actionHref}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {issue.actionLabel}
      </Link>
    </li>
  );
}

/**
 * "Prioridades de hoje" (Etapa 46) — substitui a antiga Central de Atenção:
 * uma linha por CLIENTE (nunca por problema — um cliente com 7 alertas
 * ainda é uma linha só), já ordenada por `sortClientPriorities`. Fila de
 * trabalho, não lista de alertas: no máximo 6 aqui, "Ver todas" abre o
 * resto num drawer.
 */
export function PrioritiesPanel({
  priorities,
  managerNameByClient,
  totalCount,
  viewAllHref,
}: {
  priorities: ClientPriority[];
  managerNameByClient: Map<string, string | null>;
  totalCount: number;
  viewAllHref: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prioridades de hoje</h2>
        {totalCount > priorities.length && (
          <Link
            href={viewAllHref}
            className="rounded-md text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Ver todas ({totalCount})
          </Link>
        )}
      </div>

      {priorities.length > 0 ? (
        <ul className="mt-1 divide-y divide-border">
          {priorities.map((priority) => (
            <PriorityRow key={priority.clientId} priority={priority} managerName={managerNameByClient.get(priority.clientId) ?? null} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhuma prioridade crítica hoje. Todas as contas monitoradas estão dentro das condições operacionais esperadas.
        </p>
      )}
    </div>
  );
}

const SEVERITY_FILTER_OPTIONS: { value: AccountHealth | "todos"; label: string }[] = [
  { value: "todos", label: "Todas" },
  { value: "critico", label: "Críticas" },
  { value: "atencao", label: "Atenção" },
];

/** "Ver todas" — mesmo padrão de drawer já usado no sistema (link
 * fixed-overlay + painel fixo, aberto/fechado via query param). */
export function PrioritiesDrawer({
  priorities,
  managerNameByClient,
  severity,
  closeHref,
  buildSeverityHref,
}: {
  priorities: ClientPriority[];
  managerNameByClient: Map<string, string | null>;
  severity: AccountHealth | "todos";
  closeHref: string;
  buildSeverityHref: (severity: AccountHealth | "todos") => string;
}) {
  const filtered = severity === "todos" ? priorities : priorities.filter((p) => p.severity === severity);

  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-[var(--shadow-float)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy">Prioridades de hoje</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SEVERITY_FILTER_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={buildSeverityHref(option.value)}
              scroll={false}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                severity === option.value
                  ? "bg-brand text-white"
                  : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {filtered.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {filtered.map((priority) => (
              <PriorityRow key={priority.clientId} priority={priority} managerName={managerNameByClient.get(priority.clientId) ?? null} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma prioridade nesta severidade.</p>
        )}
      </div>
    </>
  );
}
