import { formatAgencyDateTime } from "@/lib/format";
import { todayDateString } from "@/lib/today";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
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

  // Etapa "MITZA 2.0 — Fase G": status do relatório mensal é dado próprio
  // de `monthly_reports`, nunca uma dimensão do Motor de Saúde — busca
  // independente, só pra alimentar o filtro rápido "Relatório pendente".
  // "Pendente" = qualquer coisa que não seja "finalizado" (inclusive nenhum
  // registro ainda, mesma regra que a antiga lista de Relatórios usava).
  const supabase = await createSupabaseClient();
  const { data: reports } = await supabase.from("monthly_reports").select("client_id, status").eq("month_start", monthParam);
  const finalizedClientIds = new Set((reports ?? []).filter((r) => r.status === "finalizado").map((r) => r.client_id));
  const pendingReportClientIds = clients.map((c) => c.clientId).filter((clientId) => !finalizedClientIds.has(clientId));

  const summary = summarizeOperationTriage(clients, new Set(pendingReportClientIds));

  const { weekdayShort, dateShort, time } = formatAgencyDateTime(new Date());

  return (
    <OperationTriageView
      clients={clients}
      monthParam={monthParam}
      monthLastUpdatedLabel={`Atualizado ${weekdayShort} · ${dateShort} · ${time}`}
      summary={summary}
      todayStr={todayDateString()}
      pendingReportClientIds={pendingReportClientIds}
    />
  );
}
