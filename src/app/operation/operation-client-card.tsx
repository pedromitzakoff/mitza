import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { MetricDeviation } from "@/components/workspace/metric-deviation";
import { formatCurrency, formatRelativeShortDateTime } from "@/lib/format";
import { todayUTC } from "@/lib/today";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { getLatestPerformanceUpdateText } from "@/lib/performance";
import { formatAtividadeLabel } from "@/lib/metric-diagnostics";
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

/**
 * Card da Operação (Etapa "Novo Conceito de Monitoramento Operacional") —
 * o diagnóstico deixou de ser uma frase abaixo do nome
 * (`evaluation.primaryReason`) e passa a acontecer diretamente em cada
 * métrica, através do componente único de desvio (`MetricDeviation`):
 * valor + desvio % + seta + cor, sempre pela MESMA régua de magnitude
 * (até 10% normal, 10–20% atenção/amarelo, acima de 20% crítico/vermelho —
 * Motor de Diagnóstico Único, `lib/metric-diagnostics.ts`). Resultado e
 * Meta são valores de referência, não desvios — aparecem como valor
 * simples, sem seta/cor. Pendências saiu do corpo do card (continua
 * existindo como eixo/filtro da Operação — ver
 * `metric-diagnostics.ts`/`operation-filter-bar.tsx` — só deixou de ser
 * uma métrica principal aqui). O rodapé (antes "Última atualização",
 * baseado em sincronização de dados; depois "Acompanhamento") mostra
 * Atividade — só aparece quando a conta está sem qualquer atividade há
 * 48h ou mais, em vermelho; abaixo disso o card fica limpo de propósito,
 * porque só a exceção deve chamar atenção.
 *
 * Planejamento tem prioridade sobre Atividade nesse mesmo rodapé: se a
 * conta ainda não tem meta de CPA/CPL ou plano mensal configurado, o
 * motivo aparece ali em amarelo ("Meta de CPA/CPL não configurada" /
 * "Planejamento mensal de investimento não configurado") — o gestor não
 * precisa adivinhar por que o cliente está no filtro Planejamento. Isso
 * nunca é um estado manual: `evaluatePlanejamento` recalcula a cada
 * carregamento a partir dos dados atuais, então assim que a meta/plano é
 * preenchido o cliente sai do filtro e volta a mostrar Atividade sozinho,
 * sem nenhuma ação de "concluir planejamento".
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

  const metaLabel = goalConfig ? `Meta ${goalConfig.costMetricShortLabel}` : "Meta";
  const metaValue = targetCostPerResult === null ? "—" : formatCurrency(targetCostPerResult);
  const metaTitle = !goalConfig
    ? "Objetivo não configurado"
    : targetCostPerResult === null
      ? "Meta de custo não configurada"
      : undefined;

  const planejamentoLabel = diagnostics.planejamento.items.map((item) => item.label).join(" · ") || null;
  const atividadeLabel = formatAtividadeLabel(diagnostics.atividade);
  const footerLabel = planejamentoLabel ?? atividadeLabel;
  const footerClass = planejamentoLabel ? "text-overview-warning" : "text-overview-danger";

  // Etapa "Data de atualização da performance por cliente": de quando são
  // os números de Resultado/Custo deste card especificamente — nunca a
  // hora em que a página foi carregada (isso não diz nada sobre os dados
  // em si). Reaproveita `getLatestPerformanceUpdateText`, a mesma função já
  // usada no card fechado da Sprint/cabeçalho da página do cliente ("Manual
  // · Atualizado em..."/"Meta · Sincronizado em..."/"Sem atualização
  // registrada") — nenhum cálculo novo, só exibida aqui também. Só
  // relevante quando o cliente tem objetivo de performance configurado
  // (sem isso, o rodapé já explica "Objetivo não configurado").
  //
  // Etapa "Ajuste hoje/ontem": aqui (só aqui — Sprint/página do cliente
  // continuam com `formatShortDateTime`, sem "Hoje"/"Ontem") o formatter
  // passado é `formatRelativeShortDateTime`: hoje fala "Hoje", ontem fala
  // "Ontem", depois disso mostra a data real — sempre com o horário.
  const performanceUpdateText = goalConfig
    ? getLatestPerformanceUpdateText(card.performanceLatestSource, card.performanceLastUpdatedAt, (value) =>
        formatRelativeShortDateTime(value, todayUTC()),
      )
    : null;

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group block rounded-lg border border-border px-4 py-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      {/* Facelift "Operação no mobile": o layout de desktop (nome com largura
          fixa de 256px + grid de 4 colunas com gap de 40px) nunca foi pensado
          pra caber numa tela estreita — abaixo de `sm` as 4 colunas do grid
          colapsavam a quase zero de largura e os rótulos das métricas
          ficavam sobrepostos uns aos outros (o "Investimeleatdas" ilegível
          reportado). Mobile ganha uma segunda apresentação: avatar+nome no
          topo, métricas num grid 2×2 (nunca mais de 2 por linha, mesmo
          princípio já aplicado em Fechamento do mês/Sprint). Mesmos dados,
          mesmo `MetricDeviation`, nenhum cálculo novo. Desktop (`sm:` e
          acima) continua exatamente a linha única de sempre. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="flex items-center gap-3">
          <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
            <p className={`text-[11px] ${footerClass}`}>{footerLabel ?? ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
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
          />
          <MetricDeviation label={metaLabel} value={metaValue} diagnostic={null} title={metaTitle} />
        </div>

        {performanceUpdateText && <p className="text-[11px] text-muted-foreground">Performance: {performanceUpdateText}</p>}
      </div>

      <div className="hidden items-center gap-4 sm:flex">
        <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

        <div className="flex w-64 min-w-0 shrink-0 flex-col">
          <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
          <p className={`text-[11px] ${footerClass}`}>{footerLabel ?? ""}</p>
          {/* Etapa "Data de atualização por cliente no desktop": mesma
              regra/mesmo texto já usado no mobile (goalConfig +
              performanceUpdateText, calculados uma vez só acima — nenhuma
              lógica nova aqui, só a mesma informação também nesta
              apresentação). */}
          {performanceUpdateText && (
            <p className="truncate text-[11px] text-muted-foreground" title={`Performance: ${performanceUpdateText}`}>
              Performance: {performanceUpdateText}
            </p>
          )}
        </div>

        <div className="grid flex-1 grid-cols-4 gap-10">
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
          />
          <MetricDeviation label={metaLabel} value={metaValue} diagnostic={null} title={metaTitle} />
        </div>
      </div>
    </Link>
  );
}
