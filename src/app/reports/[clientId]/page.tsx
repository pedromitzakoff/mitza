import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { shiftMonthParam, monthRangeFromParam } from "@/lib/sprint-financials";
import { buildReportViewData } from "../report-data";
import { ClientReportView } from "../report-view";

export default async function ClientReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string; metricsChannel?: string; error?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";

  const { clientId } = await params;
  const { month, metricsChannel, error } = await searchParams;
  const today = todayUTC();

  const supabase = await createSupabaseClient();
  const data = await buildReportViewData(supabase, clientId, month, metricsChannel, today, formatMonthLabel);
  if (!data) notFound();

  const monthRange = monthRangeFromParam(month, today);
  const monthParam = (overrideMonth: string) => `?month=${overrideMonth}`;
  const prevMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, -1))}`;
  const nextMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, 1))}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/reports${month ? `?month=${month}` : ""}`} className="text-sm text-overview-text-secondary hover:underline">
          &larr; Relatórios
        </Link>
        <Link
          href={`/clients/${clientId}?area=relatorios`}
          className="rounded-md border border-overview-border px-2.5 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
        >
          Voltar ao cliente
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-overview-text-primary">{data.clientName}</h1>
          <p className="text-sm text-overview-text-secondary">
            {data.monthLabel}
            {data.managerName ? ` · ${data.managerName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-overview-border bg-overview-surface px-1 py-1 text-sm">
          <Link
            href={prevMonthHref}
            className="rounded-md px-1.5 py-0.5 text-overview-text-primary hover:bg-overview-surface-hover"
            aria-label="Mês anterior"
          >
            &lsaquo;
          </Link>
          <Link
            href={nextMonthHref}
            className="rounded-md px-1.5 py-0.5 text-overview-text-primary hover:bg-overview-surface-hover"
            aria-label="Próximo mês"
          >
            &rsaquo;
          </Link>
        </div>
      </div>

      <ClientReportView clientId={clientId} month={month} data={data} isAdmin={isAdmin} error={error} today={today} />
    </div>
  );
}
