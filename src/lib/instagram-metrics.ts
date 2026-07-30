import { computePerformanceSummary, safeDivide, type PerformanceRecordRow, type PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Lógica pura da Etapa "Integração Instagram" — cruzamento de investimento
 * Meta Ads com novos seguidores do Instagram, ligados só por `client_id` +
 * `date` (nunca por relacionamento direto entre fontes — princípio
 * explícito do usuário: "não afirmar que todos os seguidores foram
 * necessariamente atribuídos ao Meta Ads"). Reaproveita 100% do núcleo já
 * existente (`computePerformanceSummary`, `safeDivide`) — nenhuma segunda
 * fórmula de custo por resultado.
 */

/**
 * Custo por novo seguidor — deliberadamente sem saber de qual plataforma
 * vem o investimento (pedido explícito do usuário: "o cálculo não deve
 * depender diretamente do nome da plataforma"). `spend` é sempre resolvido
 * por quem chama (hoje, investimento Meta Ads no período).
 *
 * `newFollowers <= 0` retorna `null` SEMPRE, não só quando é exatamente
 * zero: seguidores líquidos zero ou negativos no período não têm "custo por
 * seguidor" — nunca um número negativo, nunca "custo por perder seguidor"
 * (que não é uma métrica que faz sentido).
 */
export function calculateCostPerFollower(input: { spend: number | null; newFollowers: number }): number | null {
  if (input.newFollowers <= 0) return null;
  return safeDivide(input.spend, input.newFollowers);
}

export interface FollowersTotalPoint {
  date: string;
  followersTotal: number;
}

export interface NetFollowersPoint {
  date: string;
  newFollowers: number;
}

/**
 * Deriva seguidores líquidos por dia a partir do total acumulado — usada só
 * quando a fonte (Stract) não entrega novos seguidores diretamente, só o
 * acumulado (`followers_total`). Nunca presumir isso sem antes confirmar o
 * schema real da Stract (ver `instagram_daily_metrics.followers_total`).
 *
 * O PRIMEIRO dia da série NUNCA vira "novos seguidores" (pedido explícito
 * do usuário: não existe uma base anterior confiável pra comparar) — ele só
 * serve de base técnica pro cálculo do segundo dia em diante. Um gap entre
 * dois dias com dado (a fonte pulou um dia) calcula a diferença contra o
 * último dia DISPONÍVEL na série, nunca contra "ontem" civil — por isso a
 * série de entrada é sempre ordenada por data antes de qualquer cálculo.
 * Correção retroativa da fonte (um dia já persistido muda de valor) é
 * suportada de graça: a função é pura e determinística — reprocessar a
 * mesma janela sempre produz o mesmo resultado, nunca acumula erro.
 */
export function deriveNetFollowersFromCumulativeTotals(points: FollowersTotalPoint[]): NetFollowersPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const result: NetFollowersPoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    result.push({ date: sorted[i].date, newFollowers: sorted[i].followersTotal - sorted[i - 1].followersTotal });
  }
  return result;
}

/**
 * Resumo de performance de UM objetivo, escolhendo o escopo de investimento
 * certo — a MESMA função consumida por Reports e Analytics (pedido
 * explícito do usuário: "não calcular uma versão diferente em cada
 * módulo"). "followers" é o único objetivo hoje alimentado por uma fonte de
 * RESULTADO (Instagram) diferente da fonte de INVESTIMENTO (Meta Ads) — por
 * isso usa `scope: "meta"` com `channelActualSpend`, reaproveitando o
 * parâmetro que `lib/performance.ts` já previa desde a Etapa 2/3 (canal de
 * investimento diferente do canal de resultado). Qualquer outro objetivo
 * (leads/vendas) continua com `scope: "consolidated"`, exatamente como
 * antes — nenhum comportamento existente muda.
 *
 * No MVP, o investimento de "followers" é sempre só Meta Ads (pedido
 * explícito do usuário) — `spendByChannel` já vem calculado por quem chama
 * (soma de `daily_spend` por canal no período), nunca uma segunda consulta
 * aqui.
 */
export function resolvePerformanceSummaryForGoal(input: {
  goal: PerformanceGoal;
  records: PerformanceRecordRow[];
  totalActualSpend: number;
  spendByChannel: Partial<Record<TrafficChannel, number>>;
  targetCostPerResult: number | null;
}): PerformanceSummary {
  if (input.goal === "followers") {
    return computePerformanceSummary({
      scope: "meta",
      records: input.records,
      resultType: "followers",
      consolidatedActualSpend: input.totalActualSpend,
      targetCostPerResult: input.targetCostPerResult,
      channelActualSpend: input.spendByChannel,
    });
  }

  return computePerformanceSummary({
    scope: "consolidated",
    records: input.records,
    resultType: input.goal,
    consolidatedActualSpend: input.totalActualSpend,
    targetCostPerResult: input.targetCostPerResult,
  });
}
