import type { TrafficChannel } from "@/lib/traffic-channels";
import type { PerformanceGoal } from "@/lib/performance-goals";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Meta & Ritmo"
 * (pedido, seção 9: "Multicanal no topo — CRÍTICO: não somar resultados
 * incompatíveis"). Núcleo puro: agrupa os canais do cliente pelo PRÓPRIO
 * objetivo de cada um (já resolvido por `resolveChannelGoal`,
 * `lib/client-goals.ts` — nenhuma resolução nova aqui, só o agrupamento).
 *
 * Canal com `resultType: null` (nenhum objetivo configurado reivindica o
 * canal) nunca entra em nenhum grupo — ele aparece normalmente na seção
 * Canais (com "Configurar objetivo"), mas não fabrica um card de
 * Resultado/Custo sem meta nenhuma por trás.
 *
 * Caso comum (todo canal pertence ao mesmo objetivo): um grupo só, com
 * todos os canais — numericamente idêntico ao que a página já fazia antes
 * desta fase (resolver só o objetivo principal). A generalização só muda o
 * resultado quando canais pertencem a objetivos DIFERENTES — nunca no
 * caminho comum.
 */
export interface CockpitChannelGoalRef {
  channel: TrafficChannel;
  resultType: PerformanceGoal | null;
}

export interface CockpitResultGroup {
  resultType: PerformanceGoal;
  channels: TrafficChannel[];
  isPrimary: boolean;
}

/** Ordem: o objetivo PRINCIPAL primeiro (mesma convenção de exibição de
 * `listClientGoals`), depois os demais na ordem em que aparecem entre os
 * canais do cliente — nunca uma ordem alfabética/arbitrária que faria o
 * card principal "saltar" de posição conforme o canal. */
export function groupChannelsByResultType(
  channels: CockpitChannelGoalRef[],
  primaryResultType: PerformanceGoal | null,
): CockpitResultGroup[] {
  const order: PerformanceGoal[] = [];
  const channelsByType = new Map<PerformanceGoal, TrafficChannel[]>();

  for (const { channel, resultType } of channels) {
    if (!resultType) continue;
    if (!channelsByType.has(resultType)) {
      order.push(resultType);
      channelsByType.set(resultType, []);
    }
    channelsByType.get(resultType)!.push(channel);
  }

  order.sort((a, b) => {
    if (a === primaryResultType) return -1;
    if (b === primaryResultType) return 1;
    return 0;
  });

  return order.map((resultType) => ({
    resultType,
    channels: channelsByType.get(resultType) ?? [],
    isPrimary: resultType === primaryResultType,
  }));
}
