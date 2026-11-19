import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { shiftDays } from "@/lib/date-range";
import { fetchAccountBalanceSnapshot } from "@/lib/meta-ads-dashboard/dashboard-data";
import { detectBalanceDepletionAlert } from "@/lib/alerts/balance-depletion-detection";
import { persistAlertEvaluation } from "@/lib/alerts/persist-alert-evaluation";

type AdminSupabase = SupabaseClient<Database>;

/**
 * Orquestração (impura) do alerta "Saldo esgotando" (pedido explícito do
 * usuário: "coloque como alerta quando estivermos 3 dias antes do saldo
 * esgotar se manter o mesmo investimento do dia anterior"). Mesmo formato
 * de `evaluateSpendPaceAlerts` — nunca para no primeiro erro de UM
 * cliente, cada falha fica isolada.
 *
 * Só avalia contas Meta PRÉ-PAGAS com saldo disponível (`isPrepay: true`,
 * mesmo critério do indicador do cabeçalho) — conta pós-paga nunca tem
 * saldo pra projetar (achado real: `is_prepay_account` vem da própria
 * Meta, não é algo que a MITZA configura — ver comentário de
 * `fetchAccountBalanceSnapshot`).
 *
 * Diferente de `evaluateSpendPaceAlerts` (que só lê `daily_spend`, já
 * sincronizado, sem custo de API por avaliação), este avaliador faz UMA
 * chamada à Graph API por cliente (saldo não é persistido em nenhuma
 * tabela — é sempre "fundos disponíveis agora"). O cron roda a cada 30min
 * (`vercel.json`); reconsultar o saldo a cada execução multiplicaria as
 * chamadas por ~48x/dia/cliente à toa, já que o saldo só precisa ser
 * reavaliado 1x/dia (mesma cadência de "ontem" usada pelo ritmo de gasto).
 * Por isso pula clientes já avaliados HOJE (`last_evaluated_at` na mesma
 * data) — trade-off explícito: se o saldo for reforçado no mesmo dia em
 * que o alerta disparou, a resolução automática só aparece na checagem do
 * dia seguinte (a ação manual "Marcar como resolvido" continua disponível
 * a qualquer momento nesse meio-tempo).
 */
export interface BalanceDepletionEvaluationSummary {
  evaluated: number;
  created: number;
  updated: number;
  resolved: number;
  ignored: number;
  skippedAlreadyEvaluatedToday: number;
  skippedNoAccount: number;
  skippedNotPrepayOrUnavailable: number;
  skippedNoYesterdaySpend: number;
  errors: { clientId: string; message: string }[];
}

export async function evaluateBalanceDepletionAlerts(
  now: Date = new Date(),
  supabase: AdminSupabase = createAdminClient(),
): Promise<BalanceDepletionEvaluationSummary> {
  const today = todayDateString(now);
  const yesterday = shiftDays(today, -1);
  const nowIso = now.toISOString();

  const summary: BalanceDepletionEvaluationSummary = {
    evaluated: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    ignored: 0,
    skippedAlreadyEvaluatedToday: 0,
    skippedNoAccount: 0,
    skippedNotPrepayOrUnavailable: 0,
    skippedNoYesterdaySpend: 0,
    errors: [],
  };

  const [accounts, existingAlerts, yesterdaySpendRows] = await Promise.all([
    requireQuery(
      supabase.from("import_sources").select("client_id, external_account_id").eq("provider", "meta_api").eq("channel", "meta").eq("enabled", true),
      "import_sources:alerts-balance-depletion",
    ),
    requireQuery(
      supabase.from("alerts").select("client_id, last_evaluated_at").eq("alert_type", "balance_depletion").eq("channel", "meta").eq("period_kind", "full_day"),
      "alerts:balance-depletion-existing",
    ),
    requireQuery(
      supabase.from("daily_spend").select("client_id, spend").eq("channel", "meta").eq("date", yesterday),
      "daily_spend:alerts-balance-depletion",
    ),
  ]);

  const lastEvaluatedTodayByClientId = new Set(
    existingAlerts.filter((row) => todayDateString(new Date(row.last_evaluated_at)) === today).map((row) => row.client_id),
  );
  const yesterdaySpendByClientId = new Map(yesterdaySpendRows.map((row) => [row.client_id, row.spend]));

  for (const account of accounts) {
    const { client_id: clientId, external_account_id: accountId } = account;
    if (!accountId) {
      summary.skippedNoAccount++;
      continue;
    }
    if (lastEvaluatedTodayByClientId.has(clientId)) {
      summary.skippedAlreadyEvaluatedToday++;
      continue;
    }

    const dailySpendYesterday = yesterdaySpendByClientId.get(clientId) ?? null;
    if (dailySpendYesterday === null || dailySpendYesterday <= 0) {
      summary.skippedNoYesterdaySpend++;
      continue;
    }

    try {
      const snapshot = await fetchAccountBalanceSnapshot(accountId);
      if (snapshot.status !== "ok" || !snapshot.isPrepay) {
        summary.skippedNotPrepayOrUnavailable++;
        continue;
      }

      const candidate = detectBalanceDepletionAlert({
        balance: snapshot.balance,
        currency: snapshot.currency,
        dailySpendYesterday,
        periodStart: today,
        periodEnd: today,
      });

      const outcome = await persistAlertEvaluation(supabase, { clientId, channel: "meta", alertType: "balance_depletion", periodKind: "full_day" }, candidate, nowIso);
      summary.evaluated++;
      summary[outcome]++;
    } catch (err) {
      summary.errors.push({ clientId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
