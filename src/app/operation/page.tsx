import { formatAgencyDateTime } from "@/lib/format";
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
 *
 * Etapa "Novo Conceito de Monitoramento Operacional": o filtro "Relatório
 * pendente" (Fase G) saiu da barra rápida — os únicos quatro filtros agora
 * são Todos/CPA/Investimento/Pendências, todos resolvidos pelo Motor de
 * Diagnóstico Único a partir de `clients`, sem precisar de uma consulta
 * própria a `monthly_reports` aqui.
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

  // Etapa "Auditoria da Operação": era rotulado "Atualizado {hora}", mas é
  // só a hora em que a PÁGINA carregou (`new Date()` no render), nunca uma
  // data de sincronização real — "Atualizado" dava a entender que os
  // números abaixo eram daquele instante. Vira só um relógio neutro, sem
  // verbo nenhum implicando frescor de dado (mesmo espírito do relógio da
  // Sidebar) — nenhuma lógica nova, só a palavra errada removida.
  const { weekdayShort, dateShort, time } = formatAgencyDateTime(new Date());

  return (
    <OperationTriageView
      clients={clients}
      monthParam={monthParam}
      currentDateTimeLabel={`${weekdayShort} · ${dateShort} · ${time}`}
      summary={summary}
    />
  );
}
