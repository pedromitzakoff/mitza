import { NextResponse } from "next/server";
import { evaluateSpendPaceAlerts } from "@/lib/alerts/evaluate-spend-pace";
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
 * Entrega incremental (decisão do usuário): só o tipo "spend_pace" é
 * avaliado por enquanto — os demais 5 tipos do pedido entram aqui conforme
 * forem implementados, cada um sua própria função `evaluateXAlerts`.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "evaluate-alerts");
  if (rejection) return rejection;

  const spendPace = await evaluateSpendPaceAlerts();
  return NextResponse.json({ spendPace });
}
