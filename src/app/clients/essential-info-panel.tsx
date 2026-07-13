import Link from "next/link";
import { CLIENT_MAIN_OBJECTIVE_LABEL } from "@/lib/client-fields";
import type { ClientMainObjective } from "@/lib/supabase/database.types";

/**
 * Bloco 8 do pedido de reorganização — "Informações essenciais": dados
 * estruturais cadastrados em Configurações > Clientes (Etapa 27) que até
 * então só apareciam lá, nunca na própria página do cliente. Recolhível por
 * padrão (`<details>`, sem JS) — é referência de contexto, não algo que
 * ajuda a decidir/executar no dia a dia, então não compete por atenção com
 * o financeiro/sprint/operacional acima. Se nenhum campo estiver
 * preenchido, mostra um estado neutro em vez de esconder a seção inteira
 * (evita a impressão de que a informação nunca existiu).
 */
export function EssentialInfoPanel({
  mainObjective,
  mainProductOrService,
  operationRegion,
  primaryAudience,
  clientDifferentials,
  clientRestrictions,
  importantSeasonalDates,
  operationalSummary,
  importantNotes,
  isAdmin,
  editHref,
}: {
  mainObjective: ClientMainObjective | null;
  mainProductOrService: string | null;
  operationRegion: string | null;
  primaryAudience: string | null;
  clientDifferentials: string | null;
  clientRestrictions: string | null;
  importantSeasonalDates: string | null;
  operationalSummary: string | null;
  importantNotes: string | null;
  isAdmin: boolean;
  editHref: string;
}) {
  const fields = [
    { label: "Objetivo principal", value: mainObjective ? CLIENT_MAIN_OBJECTIVE_LABEL[mainObjective] : null },
    { label: "Produto ou serviço principal", value: mainProductOrService },
    { label: "Região de operação", value: operationRegion },
    { label: "Público-alvo", value: primaryAudience },
    { label: "Diferenciais do cliente", value: clientDifferentials },
    { label: "Restrições", value: clientRestrictions },
    { label: "Datas sazonais importantes", value: importantSeasonalDates },
    { label: "Resumo operacional", value: operationalSummary },
    { label: "Observações importantes", value: importantNotes },
  ];

  return (
    <details className="rounded-lg border border-border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">Informações essenciais</summary>
      <div className="mt-3 flex flex-col gap-2">
        {fields.map((field) => (
          <div key={field.label}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{field.label}</p>
            <p className="text-sm text-foreground">{field.value || "—"}</p>
          </div>
        ))}
        {isAdmin && (
          <Link href={editHref} className="mt-1 self-start text-xs font-medium text-brand hover:underline">
            Editar informações do cliente
          </Link>
        )}
      </div>
    </details>
  );
}
