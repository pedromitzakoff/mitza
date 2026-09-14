import { formatAgencyDateTime } from "@/lib/format";
import { summarizeOperationTriage } from "@/lib/operation-triage";
import { loadOperationTriageClients } from "./operation-triage-data";
import { OperationTriageView } from "./operation-triage-view";
import type { TrafficChannel } from "@/lib/traffic-channels";

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Etapa "Operação por Canal": só Meta/Google existem como contexto
 * (nenhum "Consolidado" — decisão explícita) — qualquer valor de `channel`
 * na URL que não seja `"google"` cai em `"meta"`, o padrão da tela (mesma
 * ordem de prioridade já usada em `CHANNEL_SWITCH_ORDER`,
 * lib/traffic-channels.ts). Nunca uma segunda regra de "canal padrão":
 * diferente do seletor da Visão Geral do cliente (`resolveDefaultClientChannelScope`,
 * que decide por CLIENTE), aqui é uma pergunta de página só — sempre Meta
 * até o usuário trocar. */
export function resolveOperationChannel(paramValue: string | undefined): TrafficChannel {
  return paramValue === "google" ? "google" : "meta";
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
 *
 * Etapa "Operação por Canal": a saúde operacional (CPA/CPL/Custo por
 * Resultado — ver Etapa "Operação — CPA como régua única") deixou de ser
 * avaliada consolidada e passa a ser sempre de UM canal (`?channel=meta`/
 * `?channel=google`, nunca "Consolidado" — Meta e Google podem ter saúde
 * completamente diferente, e consolidar mascararia isso). `loadOperationTriageClients`
 * já devolve a população/métricas/meta/frescor recortados pro canal
 * (`lib/operation-channel-state-data.ts`) — esta página só lê o parâmetro e
 * repassa.
 */
export default async function OperationPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; channel?: string }>;
}) {
  const params = await searchParams;
  const monthParam = params.month ?? currentMonthParam();
  const channel = resolveOperationChannel(params.channel);

  const clients = await loadOperationTriageClients(monthParam, channel);
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
      channel={channel}
      currentDateTimeLabel={`${weekdayShort} · ${dateShort} · ${time}`}
      summary={summary}
    />
  );
}
