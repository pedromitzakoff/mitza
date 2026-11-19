import { NextResponse } from "next/server";
import { evaluateSpendPaceAlerts } from "@/lib/alerts/evaluate-spend-pace";
import { evaluateSyncIssueAlerts } from "@/lib/alerts/evaluate-sync-issues";
import { guardCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "evaluate-alerts");
  if (rejection) return rejection;

  const [spendPace, syncIssues] = await Promise.allSettled([
    evaluateSpendPaceAlerts(),
    evaluateSyncIssueAlerts(),
  ]);
  for (const result of [spendPace, syncIssues]) {
    if (result.status === "rejected") console.error("[evaluate-alerts]", result.reason);
  }
  const failed = spendPace.status === "rejected" || syncIssues.status === "rejected";
  return NextResponse.json({
    spendPace: spendPace.status === "fulfilled" ? spendPace.value : null,
    syncIssues: syncIssues.status === "fulfilled" ? syncIssues.value : null,
  }, { status: failed ? 500 : 200 });
}
