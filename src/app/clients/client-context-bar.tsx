import Link from "next/link";
import { syncClientMetaAction } from "./meta-actions";
import { TOP_BAR_OFFSET_CLASS } from "@/app/app-shell-dimensions";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import { formatRelationshipDuration } from "@/lib/format";
import { todayUTC } from "@/lib/today";
import type { ClientContractStatus } from "@/lib/supabase/database.types";

/**
 * Subheader sticky do cliente — fica abaixo da Top Bar global em toda rota
 * /clients/[id]/**, pra o nome do cliente nunca sumir da tela ao rolar pras
 * sprints. Só CSS sticky (sem JS), então não interfere em scroll/âncoras.
 * Serve orientação + ações (nome, sprint, gestor, tempo ativo, status,
 * Editar, Ver relatório, Atualizar Meta) — sem selo de saúde OPERACIONAL da
 * conta, pra não competir com o bloco "Atenção" da página (o status aqui é
 * CONTRATUAL, ver client-fields.ts). Etapa 51: "Ver relatório" é a
 * navegação direta Cliente → Relatório do mesmo mês, sem passar pela lista
 * geral de clientes nem pela de relatórios.
 */
export function ClientContextBar({
  clientId,
  clientName,
  metaAdAccountId,
  managerNames,
  sprintPeriodLabel,
  sprint,
  isAdmin,
  contractStatus,
  contractStartDate,
  reportHref,
}: {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  sprintPeriodLabel: string | null;
  sprint: { startDate: string; endDate: string } | null;
  isAdmin: boolean;
  contractStatus: ClientContractStatus;
  contractStartDate: string | null;
  reportHref: string;
}) {
  const sprintLabel = sprint && sprintPeriodLabel ? `Semana atual · ${sprintPeriodLabel}` : "Sem semana atual";

  const gestorLabel = managerNames.length > 0 ? `Gestor: ${managerNames.join(", ")}` : "Sem gestor atribuído";
  const relationshipLabel = formatRelationshipDuration(contractStartDate, todayUTC());

  return (
    <div className={`sticky z-20 border-b border-border bg-card ${TOP_BAR_OFFSET_CLASS}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <p className="min-w-0 shrink truncate border-l-2 border-brand pl-2.5 text-sm font-semibold text-foreground">
            {clientName}
          </p>
          <span
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block ${CLIENT_STATUS_BADGE_CLASSES[contractStatus]}`}
          >
            {CLIENT_STATUS_LABEL[contractStatus]}
          </span>
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground lg:inline">
            {metaAdAccountId}
          </span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">{sprintLabel}</span>
          <span className="hidden shrink-0 truncate text-xs text-muted-foreground md:inline">{gestorLabel}</span>
          {contractStartDate && (
            <span className="hidden shrink-0 truncate text-xs text-muted-foreground lg:inline">
              {relationshipLabel}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={reportHref}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Ver relatório
          </Link>
          {isAdmin && (
            <Link
              href={`/clients/${clientId}/edit`}
              className="hidden rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 sm:inline-block"
            >
              Editar
            </Link>
          )}
          <form action={syncClientMetaAction.bind(null, clientId)}>
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Atualizar Meta
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
