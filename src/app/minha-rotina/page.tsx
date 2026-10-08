import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { fetchRecurringTaskDetail } from "@/lib/recurring-task-data";
import { RecurringTaskDrawer } from "@/app/clients/recurring-task-drawer";
import { loadMinhaRotinaRawData } from "./minha-rotina-data";
import { MinhaRotinaPageClient } from "./minha-rotina-page-client";

/**
 * `/minha-rotina` — MITZA ONE: execução diária do gestor, consolidando
 * Demandas (`tasks`, por `assignee_id`) e Rotinas (`recurring_tasks`, por
 * `primary_manager_id` do cliente) atribuídas a ele, em toda a carteira —
 * nunca exige abrir cliente por cliente. Nenhuma tabela/RPC nova: reaproveita
 * `loadMinhaRotinaRawData` (que por sua vez reaproveita `loadPendenciasRawData`-
 * style query + `fetchRecurringTaskListsForSprints`, já oficiais).
 *
 * Rotina que precisa do fluxo completo (checklist/diagnóstico/Report, ver
 * `canOneClick` em `lib/minha-rotina.ts`) abre o MESMO `RecurringTaskDrawer`
 * que `/sprints` já usa, via query string (`recurringTaskDetail`/
 * `recurringTaskClient`/`recurringTaskSprint`) — nenhum formulário
 * duplicado, nenhuma validação reimplementada.
 */
export default async function MinhaRotinaPage({
  searchParams,
}: {
  searchParams: Promise<{
    recurringTaskDetail?: string;
    recurringTaskClient?: string;
    recurringTaskSprint?: string;
    quick?: string;
    q?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const supabase = await createSupabaseClient();
  const today = todayDateString();

  const { items } = await loadMinhaRotinaRawData(supabase, profile.id, today);

  const closeParams = new URLSearchParams();
  if (params.quick) closeParams.set("quick", params.quick);
  if (params.q) closeParams.set("q", params.q);
  const closeQuery = closeParams.toString();
  const closeHref = `/minha-rotina${closeQuery ? `?${closeQuery}` : ""}`;

  const openRotinaItem =
    params.recurringTaskDetail && params.recurringTaskClient
      ? items.find((item) => item.kind === "rotina" && item.id === params.recurringTaskDetail && item.clientId === params.recurringTaskClient)
      : null;
  const recurringTaskDetail =
    params.recurringTaskDetail && params.recurringTaskClient && openRotinaItem && openRotinaItem.kind === "rotina"
      ? await fetchRecurringTaskDetail(
          supabase,
          params.recurringTaskDetail,
          params.recurringTaskClient,
          { start_date: openRotinaItem.sprintStartDate, end_date: openRotinaItem.sprintEndDate },
          today,
        )
      : null;
  // Mesma composição de href que `/sprints/page.tsx` já usa pro CTA "Gerar
  // report" (`usesReport`) — cliente/recorrência/período (da sprint REAL em
  // que a execução pendente foi calculada) resolvidos, nenhum wizard
  // próprio aqui.
  const recurringTaskReportHref =
    recurringTaskDetail && params.recurringTaskClient && openRotinaItem && openRotinaItem.kind === "rotina"
      ? `/clients/${params.recurringTaskClient}/relatorio?clientReport=new&reportRecurringTaskId=${params.recurringTaskDetail}&reportPeriodStart=${openRotinaItem.sprintStartDate}&reportPeriodEnd=${openRotinaItem.sprintEndDate}`
      : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <MinhaRotinaPageClient initialItems={items} today={today} />

      {recurringTaskDetail && params.recurringTaskClient && (
        <RecurringTaskDrawer detail={recurringTaskDetail} clientId={params.recurringTaskClient} closeHref={closeHref} reportHref={recurringTaskReportHref} />
      )}
    </div>
  );
}
