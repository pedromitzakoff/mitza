import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { MetricDeviation } from "@/components/workspace/metric-deviation";
import { emphasizeDeviationText, type StatusTone } from "@/components/workspace/status-dot";
import { formatCurrency, formatRelativeShortDateTime } from "@/lib/format";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { resolveOperationCpaPriorityGroup, describeOperationCpaReason, type OperationPriorityGroup } from "@/lib/operation-triage";
import type { ClientOperationalState } from "@/lib/client-operational-state";

const countFormatter = new Intl.NumberFormat("pt-BR");

/** Moeda inteira ("R$ 2.413") — investimento é sempre exibido arredondado
 * pro real mais próximo (a precisão de centavos não ajuda a leitura rápida
 * do painel). Custo por resultado e Meta usam `formatCurrency` (2 casas),
 * porque ali a diferença de centavos costuma ser o próprio ponto de
 * atenção — e é o mesmo número que o gestor compara lado a lado. */
function formatWholeCurrency(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/** Exportado (Etapa "Motivo da Operação no Cliente") pra página individual
 * do cliente colorir a mesma frase de motivo com o mesmo tom — nenhuma
 * segunda tabela crítico/atenção/saudável→cor, a mesma fonte única. Etapa
 * "Operação — Redução de Ruído Visual": este mapeamento continua existindo
 * (ainda usado por `clients/[id]/page.tsx` e pra colorir `reasonText` aqui
 * dentro), mesmo depois do badge visual (`StatusDot`) ter saído do card —
 * a seção (Críticas/Atenção/Saudáveis/Sem dados) já comunica o balde; só o
 * TOM de cor do motivo continua reaproveitando esta fonte única. */
export const PRIORITY_GROUP_TONE: Record<OperationPriorityGroup, StatusTone> = {
  critico: "danger",
  atencao: "warning",
  saudavel: "success",
  sem_dados: "neutral",
};

/**
 * Card da Operação (Etapa "Operação — CPA como régua única", sucede a
 * "Central de Decisão Diária") — a Operação responde uma pergunta só: "como
 * está esta conta olhando pra custo por resultado?". A linha de motivo
 * (`reasonText`) vem de `describeOperationCpaReason` (`lib/operation-triage.ts`)
 * — sempre explica o CPA ou a impossibilidade de avaliá-lo (amostra
 * insuficiente, escopo não comparável, meta ausente), nunca investimento ou
 * resultado. O balde de prioridade (`resolveOperationCpaPriorityGroup`,
 * mesmo arquivo) é a MESMA fonte que decide a ordem/contadores/agrupamento
 * da fila — nenhum segundo vocabulário.
 *
 * Etapa "Operação — Redução de Ruído Visual" (corrige redundância das duas
 * etapas anteriores): o card já vive DENTRO de uma seção que já diz "Crítico"/
 * "Atenção"/"Saudável"/"Sem dados" (`PRIORITY_GROUP_SECTION_LABEL`,
 * `operation-triage-view.tsx`) — repetir isso de novo em badge (`StatusDot`)
 * dentro de cada card era a mesma informação duas vezes. Saiu o badge; o
 * TOM de cor do balde continua existindo só na cor do próprio `reasonText`
 * (`PRIORITY_GROUP_TONE`/`emphasizeDeviationText`), nunca um texto/selo
 * próprio. Gestor também saiu do card: o filtro "Gestor" da própria tela já
 * decide se a lista é da agência inteira ou de alguém específico — mostrar
 * o nome em cada card era redundante com esse filtro (dado de gestor em si
 * não muda em nenhuma outra tela).
 *
 * Hierarquia final do card: 1) cliente, 2) motivo do CPA (colorido só
 * quando crítico/atenção), 3) frescor dos dados de performance — ÚNICA
 * informação operacional secundária que sobra aqui (atividade, revisão
 * atrasada e a origem/verbo de sincronização saíram: continuam existindo
 * no motor e nas telas onde já faziam sentido — Sprint, página do cliente —
 * só pararam de aparecer NESTE card). `card.performanceLastUpdatedAt` é a
 * mesma fonte que já alimentava a antiga linha "Performance: ...", só sem
 * o prefixo de origem ("Manual"/"Meta"/"Google") nem o verbo
 * ("Atualizado"/"Sincronizado") — o motivo do CPA já deixa claro que o
 * assunto é performance, repetir a palavra na linha de baixo era ruído.
 * `formatRelativeShortDateTime` é o MESMO formatter de sempre (Hoje/Ontem/
 * data — nenhum formato novo inventado aqui).
 *
 * `evaluation.dimensions.investment`/`.results`/`.review` (Motor de Saúde,
 * `lib/account-health-engine.ts`, intocado por todas as etapas da Operação)
 * continuam calculados — só nunca influenciam prioridade/badge/motivo/linha
 * secundária da Operação. As 3 métricas (Investimento, Resultado, Custo) têm
 * o MESMO peso visual (mesmo `size`, mesma ordem: Investimento → Resultado
 * → Custo) — só o bloco de Custo recebe `diagnostic`/`referenceLabel`
 * (seta, cor, % e comparação com a meta); Investimento e Resultado são
 * sempre neutros — valor puro, sem seta, sem cor de desvio.
 *
 * A meta de custo é a linha de referência do próprio bloco de Custo
 * (`MetricDeviation.referenceLabel`, "Meta R$ 10,00 · ↑ 58%"), o mesmo
 * número que já existia, só mais perto do valor que ele explica — nunca um
 * cálculo novo, só reposicionado.
 */
export function OperationClientCard({ card }: { card: ClientOperationalState }) {
  const { diagnostics, evaluation } = card;
  const goalConfig = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal] : null;
  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const targetCostPerResult = evaluation.dimensions.cost.planned;

  const priorityGroup = resolveOperationCpaPriorityGroup(evaluation);
  // Etapa "Operação — CPA como régua única": sempre o CPA ou a
  // impossibilidade de avaliá-lo (ver doc de `describeOperationCpaReason`,
  // lib/operation-triage.ts) — nunca mais investimento/resultado/revisão.
  const reasonText = describeOperationCpaReason(evaluation);

  const investmentValue = investment.hasSyncedData ? formatWholeCurrency(investment.actual) : "—";
  const investmentTitle = investment.hasSyncedData ? undefined : "Sem dados de investimento";

  const resultValue = !goalConfig || !results.hasPerformanceData ? "—" : countFormatter.format(results.actual);
  const resultTitle = !goalConfig
    ? "Objetivo não configurado"
    : !results.hasPerformanceData
      ? "Sem resultados registrados"
      : undefined;

  const costValue = diagnostics.cpa === null ? "—" : formatCurrency(diagnostics.cpa.value);
  const costTitle =
    diagnostics.cpa === null
      ? results.hasPerformanceData
        ? `Aguardando amostra suficiente — mínimo de ${MIN_RELIABLE_RESULT_COUNT} resultados`
        : "Sem dados de custo"
      : undefined;
  const costReferenceLabel = targetCostPerResult === null ? undefined : `Meta ${formatCurrency(targetCostPerResult)}`;

  // Etapa "Operação — Redução de Ruído Visual": única linha operacional
  // secundária do card — frescor dos DADOS DE PERFORMANCE (nunca atividade,
  // nunca revisão, nunca sincronização de investimento; ver doc da função
  // acima). Sempre visível, mesma convenção pra todo card — inclusive
  // quando nunca houve registro, pra nunca dar a impressão de que o dado é
  // "de agora" por omissão.
  const dataFreshnessText = card.performanceLastUpdatedAt
    ? `Última atualização: ${formatRelativeShortDateTime(card.performanceLastUpdatedAt, new Date())}`
    : "Sem atualização registrada";

  const priorityTone = PRIORITY_GROUP_TONE[priorityGroup];

  // Etapa "Operação — Hierarquia Visual Neutra": ordem de sempre
  // (Investimento → Resultado → Custo), mesmo `size` (padrão do
  // componente) nas 3 — nenhuma delas "parece maior". Investimento nunca
  // recebe `diagnostic` aqui (valor neutro, sem seta/cor/% de desvio) —
  // diferente da Visão Geral do cliente/Dashboard, que continuam usando
  // `diagnostics.investment` normalmente em outras telas. Resultado já era
  // neutro (o motor não define desvio pra contagem bruta). Só Custo recebe
  // `diagnostic`/`referenceLabel` — é a única métrica com estado de alerta.
  const metrics = (
    <>
      <MetricDeviation label="Investimento" value={investmentValue} diagnostic={null} title={investmentTitle} />
      <MetricDeviation
        label={goalConfig?.resultMetricLabel ?? "Resultado"}
        value={resultValue}
        diagnostic={null}
        title={resultTitle}
      />
      <MetricDeviation
        label={goalConfig?.costMetricShortLabel ?? "Custo"}
        value={costValue}
        diagnostic={diagnostics.cpa}
        title={costTitle}
        referenceLabel={costReferenceLabel}
      />
    </>
  );

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group block rounded-lg border border-border px-3.5 py-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      {/* Mobile (abaixo de `sm`): avatar+nome+motivo no topo, métricas num
          grid de 3 colunas numa linha só (nunca mais de 2×2 desalinhado —
          3 métricas cabem lado a lado mesmo em telas estreitas, mesmo
          princípio já aplicado em Fechamento do mês/Sprint). Desktop
          (`sm:` e acima) continua a linha única, agora com 3 blocos de
          métrica em vez de 4 (a Meta virou referência dentro do bloco de
          Custo). */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center gap-3">
          <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
            {reasonText && (
              <p className="mt-0.5 truncate text-xs text-overview-text-secondary" title={reasonText}>
                {emphasizeDeviationText(reasonText, priorityTone)}
              </p>
            )}
            <p className="mt-0.5 truncate text-[11px] text-overview-text-muted">{dataFreshnessText}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-3">{metrics}</div>
      </div>

      <div className="hidden items-center gap-4 sm:flex">
        <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

        <div className="flex w-72 min-w-0 shrink-0 flex-col">
          <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
          {reasonText && (
            <p className="mt-0.5 truncate text-xs text-overview-text-secondary" title={reasonText}>
              {emphasizeDeviationText(reasonText, priorityTone)}
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-overview-text-muted">{dataFreshnessText}</p>
        </div>

        <div className="grid flex-1 grid-cols-3 gap-6">{metrics}</div>
      </div>
    </Link>
  );
}
