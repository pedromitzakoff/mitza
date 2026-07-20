import { formatAgencyDateTime } from "@/lib/format";
import { todayDateString } from "@/lib/today";
import { summarizeOperationTriage } from "@/lib/operation-triage";
import { loadOperationTriageClients } from "./operation-triage-data";
import { OperationTriageView } from "./operation-triage-view";

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * `/operation` — Etapa "Operação 1.0": deixa de ser um redirect pra Sprints
 * e passa a ser a tela nova de triagem (ver `lib/operation-triage.ts` pro
 * porquê ela não reaproveita nada da Sprint). `/sprints` continua existindo
 * intacta, só não tem mais link na sidebar.
 */
export default async function OperationPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const monthParam = params.month ?? currentMonthParam();

  const clients = await loadOperationTriageClients(monthParam);
  const summary = summarizeOperationTriage(clients);

  const { weekdayShort, dateShort, time } = formatAgencyDateTime(new Date());

  return (
    <OperationTriageView
      clients={clients}
      monthParam={monthParam}
      monthLastUpdatedLabel={`Atualizado ${weekdayShort} · ${dateShort} · ${time}`}
      summary={summary}
      todayStr={todayDateString()}
    />
  );
}
