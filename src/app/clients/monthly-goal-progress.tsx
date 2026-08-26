import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";

/** "883"/"1.000"/"839" — contagem de resultado sempre arredondada pra
 * inteiro nesta tela (Etapa "Visão Geral: decisão em 5 segundos", 2ª
 * rodada: "838,7" vira "839" — precisão de casa decimal é detalhe de
 * investigação, não de decisão rápida). Nenhum valor real muda, só a
 * apresentação: `expectedToDate` continua a mesma conta de sempre
 * (`computeMonthlyExpectedToDateByCalendar`), só arredondada aqui. */
function formatCount(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

/** Cor do texto/bolinha de ritmo — pra INVESTIMENTO "acima" é ruim (gastou
 * mais que o planejado, ver `MonthInvestmentSummary`), mas pra RESULTADO
 * "acima" é bom (mais resultado que o esperado): por isso este mapa é o
 * inverso daquele, nunca a mesma constante reaproveitada às cegas. */
const RITMO_TONE_CLASSES: Partial<Record<SpendStatus, string>> = {
  acima: "text-green-600 dark:text-green-400",
  dentro: "text-green-600 dark:text-green-400",
  abaixo: "text-amber-600 dark:text-amber-400",
};

/** Texto de ritmo — pedido explícito do usuário nesta forma exata ("Dentro
 * do ritmo esperado"/"Abaixo do ritmo esperado"), sem os pontos percentuais
 * que `formatRitmoDiffText` (financial-period.ts) usa pro card de
 * Investimento. A CLASSIFICAÇÃO continua a mesma de sempre
 * (`classifySpendStatus`, central) — só o texto pra cada resultado é
 * diferente aqui, nunca uma segunda régua de tolerância. `sem_meta`/
 * `nao_iniciado`/`em_andamento` nunca aparecem na prática (só existem pra
 * sprint ou pra `expected <= 0`), mas ficam de fora do mapa de propósito —
 * sem texto é melhor que um texto inventado sem base real. */
const RITMO_STATUS_TEXT: Partial<Record<SpendStatus, string>> = {
  acima: "Acima do ritmo esperado",
  dentro: "Dentro do ritmo esperado",
  abaixo: "Abaixo do ritmo esperado",
};

/**
 * "Performance" — Etapa "Visão Geral: decisão em 5 segundos". Substitui a
 * antiga "Evolução diária de resultados" (gráfico de 7 barras) nesta tela:
 * aquela granularidade dia a dia é informação de INVESTIGAÇÃO e continua
 * disponível, com mais profundidade (hover, tendência), no Analytics
 * (`AnalyticsTrendChart`) — nunca removida do produto, só reposicionada.
 * Aqui a pergunta é outra, de DECISÃO: quanto já foi feito, qual a meta, que
 * % isso representa e se o ritmo está adequado pra bater a meta do mês.
 *
 * 2ª rodada de simplificação: a linha "Média 7d" (que exigia a série diária
 * inteira só pra um número) saiu daqui — mesma lógica de sempre
 * (`computeDailyResultStats`) continua disponível pra quem precisar dela,
 * só não é mais lida por este componente. Mesma linguagem visual do card
 * "Investimento" (`MonthInvestmentSummary`): realizado/meta + % no topo,
 * barra, e status de ritmo (bolinha colorida) ao lado do "Esperado hoje".
 *
 * A CLASSIFICAÇÃO de ritmo reaproveita 100% a régua central já usada pro
 * investimento (`classifySpendStatus`, de `spend-status.ts`, mesma margem de
 * ±20%) — nenhuma segunda fórmula de "está no ritmo" inventada aqui só
 * porque a unidade agora é "resultado" em vez de "R$". Só o TEXTO é próprio
 * deste card (`RITMO_STATUS_TEXT` acima) — pedido explícito do usuário
 * nessa forma exata, diferente da frase com pontos percentuais que o card
 * de Investimento usa.
 */
export function MonthlyGoalProgress({
  goal,
  monthResultCount,
  targetResultCount,
  expectedToDate,
}: {
  goal: PerformanceGoal;
  monthResultCount: number;
  /** Sempre > 0 — quem chama só renderiza este componente com meta de
   * quantidade configurada pro mês (nunca "0/0" ou "X/undefined"). */
  targetResultCount: number;
  expectedToDate: number;
}) {
  const config = PERFORMANCE_GOALS[goal];
  const pct = Math.round((monthResultCount / targetResultCount) * 100);
  const barPct = Math.min(100, Math.max(0, pct));

  const status = classifySpendStatus(monthResultCount, expectedToDate, targetResultCount);
  const ritmoText = RITMO_STATUS_TEXT[status] ?? null;

  return (
    <div className="mt-3 border-t border-overview-border pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Performance</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm text-overview-text-secondary">
          <span className="font-semibold text-overview-text-primary">
            {formatCount(monthResultCount)}/{formatCount(targetResultCount)}
          </span>{" "}
          {config.pluralLabel.toLowerCase()}
        </p>
        <p className="text-sm font-semibold text-overview-text-primary">{pct}%</p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-overview-brand-subtle">
        <div className="h-full rounded-full bg-brand" style={{ width: `${barPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {ritmoText && (
          <p className={`flex items-center gap-1.5 text-xs font-medium ${RITMO_TONE_CLASSES[status] ?? ""}`}>
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
            {ritmoText}
          </p>
        )}
        <p className="text-xs text-overview-text-secondary">Esperado hoje: {formatCount(expectedToDate)}</p>
      </div>
    </div>
  );
}
