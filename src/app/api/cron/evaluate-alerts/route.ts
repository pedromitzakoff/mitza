import { NextResponse } from "next/server";
import { evaluateSpendPaceAlerts } from "@/lib/alerts/evaluate-spend-pace";
import { evaluateBalanceDepletionAlerts } from "@/lib/alerts/evaluate-balance-depletion";
import { guardCronRequest } from "@/lib/cron-auth";

/**
 * Aba "Alertas" (pedido do usuário, seção 6: "Faça as avaliações no
 * backend, integradas à rotina de sincronização ou a uma rotina agendada,
 * para que o acompanhamento continue mesmo quando ninguém estiver com a
 * aba aberta"). Cron em `vercel.json` ("/api/cron/evaluate-alerts").
 *
 * Reavalia TUDO (full_day + in_progress) a cada execução — idempotente por
 * natureza (mesma chave única `client_id+channel+alert_type+period_kind`
 * de sempre, nunca duplica linha); rodar mais vezes que o estritamente
 * necessário pro "dia completo" é inofensivo, e é exatamente o que o
 * monitor "hoje em andamento" (seção 4 do pedido) precisa pra refletir o
 * gasto acumulado em tempo quase real.
 *
 * Entrega incremental (decisão do usuário): "spend_pace" e
 * "balance_depletion" (pedido explícito: "saldo esgotando") são avaliados
 * por enquanto — os demais tipos do pedido original entram aqui conforme
 * forem implementados, cada um sua própria função `evaluateXAlerts`.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "evaluate-alerts");
  if (rejection) return rejection;

  const spendPace = await evaluateSpendPaceAlerts();
  const balanceDepletion = await evaluateBalanceDepletionAlerts();
  return NextResponse.json({ spendPace, balanceDepletion });
}
