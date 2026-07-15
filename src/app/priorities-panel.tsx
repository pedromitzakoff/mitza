import Link from "next/link";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { ClientPriorityItem } from "@/lib/client-priority";
import { Button } from "@/components/workspace/button";
import { SectionHeader } from "@/components/workspace/section-header";
import { EmptyState } from "@/components/workspace/empty-state";
import { StatusDot, type StatusTone } from "@/components/workspace/status-dot";

const SEVERITY_LABEL: Record<AccountHealth, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  saudavel: "Normal",
};

const SEVERITY_TONE: Record<AccountHealth, StatusTone> = {
  critico: "danger",
  atencao: "warning",
  saudavel: "success",
};

function PriorityRow({
  priority,
  managerName,
}: {
  priority: ClientPriorityItem;
  managerName: string | null;
}) {
  return (
    <li className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2 transition-colors duration-150 hover:bg-overview-surface-hover">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link href={`/clients/${priority.clientId}`} className="truncate text-sm font-semibold text-overview-text-primary hover:underline">
            {priority.clientName}
          </Link>
          <StatusDot tone={SEVERITY_TONE[priority.severity]} label={SEVERITY_LABEL[priority.severity]} emphasize />
        </div>
        <p className="mt-0.5 truncate text-xs text-overview-text-secondary">
          {priority.title}
          <span className="text-overview-text-muted"> · {priority.description}</span>
          {managerName ? <span className="text-overview-text-muted"> · {managerName}</span> : null}
        </p>
      </div>
      <Button href={priority.actionHref} variant="secondary" size="sm">
        {priority.actionLabel}
      </Button>
    </li>
  );
}

/**
 * "Prioridades de hoje" — MVP "Reformular Prioridades na Visão Geral": lista
 * plana de itens acionáveis (custo acima da meta / ritmo fora do esperado),
 * um cliente pode aparecer mais de uma vez (uma linha por problema, nunca
 * "escondendo" um atrás do outro). Já ordenada por `sortClientPriorityItems`
 * (severidade → desvio → nome).
 */
export function PrioritiesPanel({
  priorities,
  managerNameByClient,
  totalCount,
  viewAllHref,
}: {
  priorities: ClientPriorityItem[];
  managerNameByClient: Map<string, string | null>;
  totalCount: number;
  viewAllHref: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <SectionHeader title="Prioridades de hoje" />
        {totalCount > priorities.length && (
          <Button href={viewAllHref} variant="ghost" size="sm">
            Ver todas ({totalCount})
          </Button>
        )}
      </div>

      {priorities.length > 0 ? (
        <ul className="divide-y divide-overview-border border-t border-overview-border">
          {priorities.map((priority) => (
            <PriorityRow
              key={`${priority.clientId}-${priority.kind}`}
              priority={priority}
              managerName={managerNameByClient.get(priority.clientId) ?? null}
            />
          ))}
        </ul>
      ) : (
        <div className="border-t border-overview-border">
          <EmptyState
            title="Nenhuma prioridade hoje."
            description="Nenhuma conta com custo por resultado acima da meta ou ritmo financeiro fora do esperado."
          />
        </div>
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
  priorities: ClientPriorityItem[];
  managerNameByClient: Map<string, string | null>;
  severity: AccountHealth | "todos";
  closeHref: string;
  buildSeverityHref: (severity: AccountHealth | "todos") => string;
}) {
  const filtered = severity === "todos" ? priorities : priorities.filter((p) => p.severity === severity);

  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-[var(--shadow-float)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy">Prioridades de hoje</h2>
          <Button href={closeHref} variant="secondary" size="sm" autoFocus>
            Fechar
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SEVERITY_FILTER_OPTIONS.map((option) => (
            <Button key={option.value} href={buildSeverityHref(option.value)} variant={severity === option.value ? "primary" : "secondary"} size="sm" className="rounded-full">
              {option.label}
            </Button>
          ))}
        </div>

        {filtered.length > 0 ? (
          <ul className="mt-3 divide-y divide-overview-border">
            {filtered.map((priority) => (
              <PriorityRow
                key={`${priority.clientId}-${priority.kind}`}
                priority={priority}
                managerName={managerNameByClient.get(priority.clientId) ?? null}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-overview-text-secondary">Nenhuma prioridade nesta severidade.</p>
        )}
      </div>
    </>
  );
}
