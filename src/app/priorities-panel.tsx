import Link from "next/link";
import type { HealthStatus } from "@/lib/account-health-engine";
import { bandFromHealthStatus } from "@/lib/operation-triage";
import type { OverviewPriorityItem } from "./overview-client-view";
import { Button } from "@/components/workspace/button";
import { SectionHeader } from "@/components/workspace/section-header";
import { EmptyState } from "@/components/workspace/empty-state";
import { StatusDot, type StatusTone } from "@/components/workspace/status-dot";
import { OPERATION_TRIAGE_BAND_REGISTRY } from "@/lib/status-registry";

/** `StatusTone` do registry central inclui "info", que as bandas da
 * Operação nunca usam — mesmo mapeamento já usado em
 * `operation-client-card.tsx`. */
function toWorkspaceTone(tone: StatusTone | "info"): StatusTone {
  if (tone === "info") return "neutral";
  return tone;
}

/** Rótulo/tom do estado do cliente — reaproveita o MESMO registry que a
 * Operação já usa pra `healthStatus` (`OPERATION_TRIAGE_BAND_REGISTRY`, via
 * `bandFromHealthStatus`), nunca um vocabulário próprio inventado pra esta
 * tela (Etapa "Consolidação da Arquitetura — Fase B", Prioridade 1). */
function bandBadge(healthStatus: HealthStatus): { label: string; tone: StatusTone } {
  const entry = OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${bandFromHealthStatus(healthStatus)}`];
  return { label: entry.label, tone: toWorkspaceTone(entry.tone) };
}

const SEVERITY_TEXT_CLASSES: Record<StatusTone, string> = {
  danger: "text-overview-danger",
  warning: "text-overview-warning",
  neutral: "text-overview-text-muted",
  success: "text-overview-success",
  brand: "text-brand",
};

/** Destaca só o desvio percentual dentro do motivo ("CPL 42% acima da
 * meta"/"Investimento 38% acima do ritmo") — nunca a frase inteira. O resto
 * do texto continua com o mesmo peso de sempre. */
function emphasizeDeviation(reason: string, tone: StatusTone) {
  const match = reason.match(/\d+%/);
  if (!match || match.index === undefined) return reason;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {reason.slice(0, start)}
      <span className={`font-semibold ${SEVERITY_TEXT_CLASSES[tone]}`}>{match[0]}</span>
      {reason.slice(end)}
    </>
  );
}

function PriorityRow({
  priority,
  managerName,
}: {
  priority: OverviewPriorityItem;
  managerName: string | null;
}) {
  const badge = bandBadge(priority.healthStatus);
  return (
    <li className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-1.5 transition-colors duration-150 hover:bg-overview-surface-hover">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link href={`/clients/${priority.clientId}`} className="truncate text-sm font-semibold text-overview-text-primary hover:underline">
            {priority.clientName}
          </Link>
          <StatusDot tone={badge.tone} label={badge.label} emphasize />
        </div>
        <p className="mt-0.5 truncate text-xs text-overview-text-secondary">
          {emphasizeDeviation(priority.primaryReason, badge.tone)}
          {managerName ? <span className="text-overview-text-muted"> · {managerName}</span> : null}
        </p>
      </div>
      <Button href={priority.actionHref} variant="secondary" size="sm">
        Abrir cliente
      </Button>
    </li>
  );
}

/**
 * "Prioridades de hoje" (Etapa "Consolidação da Arquitetura — Fase B") —
 * lista de clientes com `healthStatus !== "saudavel"`, uma linha por
 * CLIENTE (não mais por problema — o Motor de Saúde já resume tudo num
 * único motivo principal por conta), ordenada pelo sorter canônico
 * (`sortClientOperationalStates`, aplicado por quem monta `priorities`
 * antes de passar pra este componente).
 */
export function PrioritiesPanel({
  priorities,
  managerNameByClient,
  totalCount,
  viewAllHref,
}: {
  priorities: OverviewPriorityItem[];
  managerNameByClient: Map<string, string | null>;
  totalCount: number;
  viewAllHref: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
      <div className="flex items-center justify-between px-3.5 py-2">
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
            <PriorityRow key={priority.clientId} priority={priority} managerName={managerNameByClient.get(priority.clientId) ?? null} />
          ))}
        </ul>
      ) : (
        <div className="border-t border-overview-border">
          <EmptyState
            title="Nenhuma prioridade hoje."
            description="Nenhuma conta com sinal de atenção no Motor de Saúde."
          />
        </div>
      )}
    </div>
  );
}

const SEVERITY_FILTER_OPTIONS: { value: HealthStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todas" },
  { value: "acao_necessaria", label: bandBadge("acao_necessaria").label },
  { value: "em_risco", label: bandBadge("em_risco").label },
  { value: "em_acompanhamento", label: bandBadge("em_acompanhamento").label },
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
  priorities: OverviewPriorityItem[];
  managerNameByClient: Map<string, string | null>;
  severity: HealthStatus | "todos";
  closeHref: string;
  buildSeverityHref: (severity: HealthStatus | "todos") => string;
}) {
  const filtered = severity === "todos" ? priorities : priorities.filter((p) => p.healthStatus === severity);

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
              <PriorityRow key={priority.clientId} priority={priority} managerName={managerNameByClient.get(priority.clientId) ?? null} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhuma prioridade nesta severidade." />
        )}
      </div>
    </>
  );
}
