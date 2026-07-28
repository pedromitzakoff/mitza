import type { PerformanceGoal } from "@/lib/performance-goals";

/**
 * Nova aba "Reports" (histórico oficial da comunicação de resultados com o
 * cliente) — DIFERENTE da aba "Relatórios" já existente
 * (`lib/monthly-reports.ts`, relatório de gestão INTERNO, sem geração de
 * texto/cópia). Mesmo espírito de `lib/client-updates.ts` (texto por
 * template, nenhuma IA), mas por período arbitrário e com métricas
 * resolvidas pelo objetivo (`clients.performance_goal`) do cliente, editáveis
 * mesmo quando vêm automaticamente da integração.
 */

export interface ClientReportMetric {
  /** Identificador estável da linha — usado só pra reordenar/editar na UI
   * (React key), nunca lido de volta como um enum de métrica conhecida:
   * métricas customizadas (adicionadas manualmente, sem integração nenhuma)
   * têm `key` gerado (`custom-...`), tratado exatamente igual às pré-
   * preenchidas. */
  key: string;
  label: string;
  /** Sempre string — já formatado pra exibição (ex.: "R$ 373,02", "325",
   * "3,2x"), nunca um número bruto. Editável em qualquer estágio, mesmo
   * quando veio calculado — corrigir/completar é o ponto central do
   * "Revisão" (Etapa 3 do fluxo). */
  value: string;
}

/** Ciclo de vida de um report — "draft" até o gestor confirmar que o
 * conteúdo foi de fato enviado ao cliente (`markClientReportSentAction`).
 * Copiar o texto pro WhatsApp NUNCA marca como enviado sozinho: o gestor
 * pode copiar e ainda ajustar antes de mandar, decisão explícita do
 * usuário — só existe uma transição draft → sent, nunca o inverso. */
export type ClientReportStatus = "draft" | "sent";

export const CLIENT_REPORT_STATUS_LABEL: Record<ClientReportStatus, string> = {
  draft: "Rascunho",
  sent: "Enviado",
};

export interface ClientReportMetricDefinition {
  key: string;
  label: string;
  /** `true` = a MITZA não rastreia essa métrica em lugar nenhum hoje (nem
   * Meta nativo, nem Stract) — entra sempre em branco, só pra
   * preenchimento manual (ex.: Alcance/Engajamento). Nunca um estado de
   * erro: é só uma métrica sem fonte automática ainda. */
  manualOnly?: boolean;
}

/** Métrica universal — todo objetivo tem investimento, sempre a primeira
 * linha do report. */
export const CLIENT_REPORT_INVESTMENT_METRIC: ClientReportMetricDefinition = { key: "investment", label: "Investimento" };

/**
 * Catálogo de métricas por objetivo — nenhuma ramificação de código por
 * cliente, só configuração (mesmo espírito de `PERFORMANCE_GOALS`,
 * `lib/performance-goals.ts`). Cliente sem objetivo configurado
 * (`performance_goal === null`) só recebe Investimento — nunca "leads" como
 * padrão inventado.
 */
export const CLIENT_REPORT_METRICS_BY_GOAL: Record<PerformanceGoal, ClientReportMetricDefinition[]> = {
  leads: [
    { key: "leads", label: "Leads" },
    { key: "cpl", label: "Custo por lead" },
  ],
  sales: [
    { key: "sales", label: "Compras" },
    { key: "cpa", label: "Custo por venda" },
    { key: "roas", label: "ROAS" },
    { key: "revenue", label: "Faturamento" },
  ],
  followers: [
    { key: "followers", label: "Seguidores" },
    { key: "cost_per_follower", label: "Custo por seguidor" },
    { key: "reach", label: "Alcance", manualOnly: true },
    { key: "engagement", label: "Engajamento", manualOnly: true },
  ],
};

/** Nova linha de métrica em branco, adicionada manualmente pelo gestor na
 * Revisão — mesma estrutura de uma métrica pré-preenchida, só sem
 * definição/cálculo por trás (ex.: "Cliques Mercado Livre", específico de
 * um cliente, que nunca faria sentido no catálogo geral por objetivo). */
export function createCustomMetric(): ClientReportMetric {
  return { key: `custom-${crypto.randomUUID()}`, label: "", value: "" };
}

function formatShortDate(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
}

/** Período padrão sugerido pra um novo report quando o wizard é aberto sem
 * um período de referência (ex.: direto da aba Reports, não do drawer da
 * recorrência "Reportar cliente") — os últimos 7 dias corridos terminando
 * hoje. Aberto a partir da recorrência, o período sugerido é sempre o da
 * própria sprint (resolvido em `page.tsx`, nunca este fallback). */
export function defaultReportPeriod(today: string): { start: string; end: string } {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: today };
}

/**
 * Monta o "texto final" do report (Etapa 5 — Pré-visualização, e o que
 * efetivamente fica gravado em `client_reports.final_text`) — só com dados
 * já preenchidos nas métricas + observações, nunca inventa seção nenhuma.
 * Observações somem por completo quando vazias (mesmo princípio de
 * `buildClientUpdateText`: uma seção sem conteúdo estruturado não aparece
 * vazia/genérica, ela simplesmente não existe no texto).
 */
export function buildClientReportText(input: {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  metrics: ClientReportMetric[];
  observations: string | null;
}): string {
  const lines: string[] = [input.clientName, "", `Resultados de ${formatShortDate(input.periodStart)} até ${formatShortDate(input.periodEnd)}`];

  for (const metric of input.metrics) {
    if (!metric.label.trim()) continue;
    lines.push("", metric.label, metric.value || "—");
  }

  const observations = input.observations?.trim();
  if (observations) {
    lines.push("", "Observações", observations);
  }

  return lines.join("\n");
}
