import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { MetricDeviation } from "@/components/workspace/metric-deviation";
import { StatusDot, emphasizeDeviationText, type StatusTone } from "@/components/workspace/status-dot";
import { formatCurrency, formatRelativeShortDateTime } from "@/lib/format";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { getLatestPerformanceUpdateText } from "@/lib/performance";
import { formatAtividadeLabel } from "@/lib/metric-diagnostics";
import { resolveOperationPriorityGroup, type OperationPriorityGroup } from "@/lib/operation-triage";
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

/** "Crítico"/"Atenção"/"Saudável"/"Sem dados" + o tom visual de cada balde
 * (Etapa "Central de Decisão Diária") — `emphasize` só nos dois primeiros
 * (o pedido explícito era hierarquia clara: motivo principal evidente pra
 * quem precisa de atenção). Saudável usa o mesmo `StatusDot` discreto do
 * resto do produto (ponto pequeno + texto neutro) — nunca um verde grande
 * competindo com os alertas acima dele na fila; Sem dados fica neutro de
 * propósito: não é "performou mal", é "não pôde ser avaliada" (ver
 * `resolveOperationPriorityGroup`, lib/operation-triage.ts). */
const PRIORITY_GROUP_LABEL: Record<OperationPriorityGroup, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  saudavel: "Saudável",
  sem_dados: "Sem dados",
};

const PRIORITY_GROUP_TONE: Record<OperationPriorityGroup, StatusTone> = {
  critico: "danger",
  atencao: "warning",
  saudavel: "success",
  sem_dados: "neutral",
};

const PRIORITY_GROUP_EMPHASIZE: Record<OperationPriorityGroup, boolean> = {
  critico: true,
  atencao: true,
  saudavel: false,
  sem_dados: false,
};

/**
 * Card da Operação (Etapa "Central de Decisão Diária") — a linha de motivo
 * deixou de ser um rótulo solto (planejamento OU atividade, o que existisse)
 * e passa a ser o `primaryReason` do Motor de Saúde da Conta
 * (`evaluation`, `lib/account-health-engine.ts`), prefixado pelo balde de
 * prioridade (`resolveOperationPriorityGroup`) — a MESMA fonte que já
 * decide a ordem da fila (`groupClientsByOperationPriority`), nunca um
 * segundo vocabulário. Hierarquia pedida explicitamente: 1) cliente, 2)
 * motivo principal (evidente, colorido só quando crítico/atenção), 3)
 * contexto secundário (atividade/atualização de performance, sempre menor
 * e mais discreto — nunca outro aviso vermelho competindo com o principal).
 *
 * Etapa "Auditoria da Operação": `managerName` entra na mesma linha do
 * nome do cliente, texto pequeno e neutro (nunca badge, nunca avatar
 * próprio) — achado da auditoria: "quem é responsável por essa conta?"
 * não tinha resposta nenhuma no card antes disso, só via filtro/busca de
 * gestor. "Sem gestor" quando `null` (nunca omitido) — uma conta sem
 * responsável é, ela mesma, um fato operacional relevante.
 *
 * As métricas continuam vindo do Motor de Diagnóstico Único
 * (`diagnostics`, `lib/metric-diagnostics.ts` — mesma régua de magnitude de
 * sempre, 10/20%) para Investimento e Custo; Resultado continua um valor de
 * referência simples (o motor não define desvio pra contagem bruta). A
 * coluna "Meta" separada foi removida: a meta de custo agora é a linha de
 * referência do próprio bloco de Custo (`MetricDeviation.referenceLabel`,
 * "Meta R$ 10,00 · ↑ 58%"), o mesmo número, só mais perto do valor que ele
 * explica — nunca um cálculo novo, só reposicionado.
 *
 * ⚠️ PARCIALMENTE PROVISÓRIO: `diagnostics.atividade` combina duas
 * fontes — `client_last_operational_activity` (tarefa criada/editada/
 * concluída/comentada, comentário de sprint: infraestrutura real, Etapa
 * 15) e `account_reviews` (a fonte de "revisão de conta"/otimização que já
 * existia). Só a segunda é placeholder: quando a estrutura real de
 * Otimizações existir (congelada pra uma etapa futura), ela substitui
 * `account_reviews` como o insumo de "otimização" — a parte de tarefas não
 * muda. Essa troca acontece inteira em `client-operational-state-data.ts`;
 * este componente e o motor (`metric-diagnostics.ts`) não mudam.
 */
export function OperationClientCard({ card }: { card: ClientOperationalState }) {
  const { diagnostics, evaluation } = card;
  const goalConfig = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal] : null;
  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const targetCostPerResult = evaluation.dimensions.cost.planned;

  const priorityGroup = resolveOperationPriorityGroup(evaluation);
  const reasonText = evaluation.primaryDimension ? evaluation.primaryReason : null;

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

  // Atividade continua a mesma conta de sempre (48h/3 dias/N dias,
  // `metric-diagnostics.ts`) — nunca um novo limiar. Deixou só de ser o
  // ÚNICO motivo visível: agora é contexto secundário, atrás do
  // `primaryReason` do motor. Planejamento incompleto não aparece mais
  // aqui separadamente porque, nesse caso, ele já É o motivo principal
  // (toda lacuna de configuração vira `primaryDimension === "dataQuality"`
  // no motor — mesmo fato, uma vez só, sem repetir o texto duas vezes).
  const atividadeLabel = formatAtividadeLabel(diagnostics.atividade);

  // Etapa "Data de atualização da performance por cliente": de quando são
  // os números de Resultado/Custo deste card especificamente — nunca a
  // hora em que a página foi carregada (isso não diz nada sobre os dados
  // em si). Reaproveita `getLatestPerformanceUpdateText`, a mesma função já
  // usada no card fechado da Sprint/cabeçalho da página do cliente ("Manual
  // · Atualizado em..."/"Meta · Sincronizado em..."/"Sem atualização
  // registrada") — nenhum cálculo novo, só exibida aqui também. Só
  // relevante quando o cliente tem objetivo de performance configurado
  // (sem isso, o motivo principal já explica "Objetivo não configurado").
  //
  // Etapa "Ajuste hoje/ontem": aqui (só aqui — Sprint/página do cliente
  // continuam com `formatShortDateTime`, sem "Hoje"/"Ontem") o formatter
  // passado é `formatRelativeShortDateTime`: hoje fala "Hoje", ontem fala
  // "Ontem", depois disso mostra a data real — sempre com o horário.
  // Bug real encontrado em produção: `formatRelativeShortDateTime` espera um
  // INSTANTE real ("agora"), nunca `todayUTC()` (meia-noite civil truncada
  // pro fuso) — passar `todayUTC()` fazia a comparação de dia reconverter
  // esse valor pelo fuso de novo, empurrando a referência um dia pra trás e
  // rotulando a sincronização de ONTEM como "Hoje" (ver `lib/format.ts`,
  // `diffCalendarDaysInAppTimezone`). `new Date()` é o único valor correto.
  const performanceUpdateText = goalConfig
    ? getLatestPerformanceUpdateText(card.performanceLatestSource, card.performanceLastUpdatedAt, (value) =>
        formatRelativeShortDateTime(value, new Date()),
      )
    : null;

  // Contexto secundário: só UM sinal por vez (nunca dois avisos
  // competindo) — atividade parada tem prioridade por ser um fato mais
  // acionável ("ninguém mexeu nisso"); sem isso, cai pra "quando os
  // números foram atualizados pela última vez".
  const secondaryText = atividadeLabel ?? (performanceUpdateText ? `Performance: ${performanceUpdateText}` : null);
  const secondaryClass = atividadeLabel ? "text-overview-danger" : "text-overview-text-muted";

  const priorityTone = PRIORITY_GROUP_TONE[priorityGroup];
  const priorityLabel = PRIORITY_GROUP_LABEL[priorityGroup];

  const metrics = (
    <>
      <MetricDeviation
        label="Investimento"
        value={investmentValue}
        diagnostic={investment.hasSyncedData ? diagnostics.investment : null}
        title={investmentTitle}
      />
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
              <span className="truncate text-[11px] text-overview-text-muted">{card.managerName ?? "Sem gestor"}</span>
              <StatusDot tone={priorityTone} label={priorityLabel} emphasize={PRIORITY_GROUP_EMPHASIZE[priorityGroup]} />
            </div>
            {reasonText && (
              <p className="mt-0.5 truncate text-xs text-overview-text-secondary" title={reasonText}>
                {emphasizeDeviationText(reasonText, priorityTone)}
              </p>
            )}
            {secondaryText && <p className={`mt-0.5 truncate text-[11px] ${secondaryClass}`}>{secondaryText}</p>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-3">{metrics}</div>
      </div>

      <div className="hidden items-center gap-4 sm:flex">
        <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

        <div className="flex w-72 min-w-0 shrink-0 flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
            <span className="truncate text-[11px] text-overview-text-muted">{card.managerName ?? "Sem gestor"}</span>
            <StatusDot tone={priorityTone} label={priorityLabel} emphasize={PRIORITY_GROUP_EMPHASIZE[priorityGroup]} />
          </div>
          {reasonText && (
            <p className="mt-0.5 truncate text-xs text-overview-text-secondary" title={reasonText}>
              {emphasizeDeviationText(reasonText, priorityTone)}
            </p>
          )}
          {secondaryText && (
            <p className={`mt-0.5 truncate text-[11px] ${secondaryClass}`} title={secondaryText}>
              {secondaryText}
            </p>
          )}
        </div>

        <div className="grid flex-1 grid-cols-3 gap-6">{metrics}</div>
      </div>
    </Link>
  );
}
