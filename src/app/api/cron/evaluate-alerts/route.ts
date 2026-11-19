import { NextResponse } from "next/server";
import { evaluateSpendPaceAlerts } from "@/lib/alerts/evaluate-spend-pace";
import { evaluateSyncIssueAlerts } from "@/lib/alerts/evaluate-sync-issues";
import { evaluateBalanceDepletionAlerts } from "@/lib/alerts/evaluate-balance-depletion";
import { guardCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "evaluate-alerts");
  if (rejection) return rejection;

  const [spendPace, syncIssues, balanceDepletion] = await Promise.allSettled([
    evaluateSpendPaceAlerts(),
    evaluateSyncIssueAlerts(),
    evaluateBalanceDepletionAlerts(),
  ]);
  for (const result of [spendPace, syncIssues, balanceDepletion]) {
    if (result.status === "rejected") console.error("[evaluate-alerts]", result.reason);
  }
  const failed = spendPace.status === "rejected" || syncIssues.status === "rejected" || balanceDepletion.status === "rejected";
  return NextResponse.json(
    {
      spendPace: spendPace.status === "fulfilled" ? spendPace.value : null,
      syncIssues: syncIssues.status === "fulfilled" ? syncIssues.value : null,
      balanceDepletion: balanceDepletion.status === "fulfilled" ? balanceDepletion.value : null,
    },
    { status: failed ? 500 : 200 },
  );
}
