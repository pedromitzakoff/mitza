import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { shiftMonthParam, monthRangeFromParam } from "@/lib/sprint-financials";
import { MONTHLY_REPORT_STATUS_BADGE_CLASSES, MONTHLY_REPORT_STATUS_LABEL } from "@/lib/monthly-reports";
import { buildReportViewData } from "../report-data";
import { ClientReportView } from "../report-view";

export default async function ClientReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";

  const { clientId } = await params;
  const { month, error } = await searchParams;
  const today = todayUTC();

  const supabase = await createSupabaseClient();
  const data = await buildReportViewData(supabase, clientId, month, today, formatMonthLabel);
  if (!data) notFound();

  const { data: managers } = await supabase
    .from("client_managers")
    .select("team_members(id, name)")
    .eq("client_id", clientId);
  const responsibleOptions = (managers ?? []).flatMap((m) => (m.team_members ? [m.team_members] : []));

  const monthRange = monthRangeFromParam(month, today);
  const monthParam = (overrideMonth: string) => `?month=${overrideMonth}`;
  const prevMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, -1))}`;
  const nextMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, 1))}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/reports${month ? `?month=${month}` : ""}`} className="text-sm text-muted-foreground hover:underline">
          &larr; Relatórios
        </Link>
        <Link
          href={`/clients/${clientId}?area=relatorios`}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Voltar ao cliente
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{data.clientName}</h1>
          <p className="text-sm text-muted-foreground">
            {data.monthLabel}
            {data.managerName ? ` · ${data.managerName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[data.status]}`}>
            {MONTHLY_REPORT_STATUS_LABEL[data.status]}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 text-sm">
            <Link href={prevMonthHref} className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Mês anterior">
              &lsaquo;
            </Link>
            <Link href={nextMonthHref} className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Próximo mês">
              &rsaquo;
            </Link>
          </div>
        </div>
      </div>

      <ClientReportView
        clientId={clientId}
        month={month}
        data={data}
        isAdmin={isAdmin}
        responsibleOptions={responsibleOptions}
        error={error}
        today={today}
      />
    </div>
  );
}
