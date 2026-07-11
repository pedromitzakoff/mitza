import Link from "next/link";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import { SprintCard } from "@/app/clients/sprint-card";

/**
 * Bloco por cliente na visão "Sprint atual" da tela Sprints (Etapa 42) —
 * cabeçalho de identidade do cliente (nome + gestor principal, sem toggle
 * próprio) seguido do mesmo `SprintCard` usado na página individual do
 * cliente. Como só existe uma sprint por cliente aqui, não há um segundo
 * nível de accordion em volta do card: o próprio `<details>` do SprintCard
 * (sempre recolhido nesta tela, via `defaultOpen={false}`) é o único
 * controle de expandir/recolher — um clique, uma seta, não dois.
 */
export function SprintCurrentClientGroup({
  card,
  returnTo,
  primaryManagerName,
  isAdmin,
  comments,
}: {
  card: OperationClientCardData;
  returnTo: string;
  primaryManagerName: string | null;
  isAdmin: boolean;
  comments: CommentItem[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-0.5">
        <Link href={`/clients/${card.clientId}`} className="font-bold text-foreground hover:underline">
          {card.clientName}
        </Link>
        {primaryManagerName && <span className="shrink-0 text-xs text-muted-foreground">{primaryManagerName}</span>}
      </div>

      {card.sprint ? (
        <SprintCard
          sprint={card.sprint}
          sprintNumber={card.sprintNumber ?? 1}
          comments={comments}
          clientId={card.clientId}
          isAdmin={isAdmin}
          tasks={card.sprintTasks}
          executionLabel={card.sprintExecutionLabel}
          executionSeverity={card.sprintExecutionInfo?.severity ?? null}
          defaultOpen={false}
          alerts={card.alerts}
          openClientHref={`/clients/${card.clientId}`}
          buildTaskHref={(taskId) => `${returnTo}&task=${taskId}`}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Sem sprint em andamento.
        </p>
      )}
    </div>
  );
}
