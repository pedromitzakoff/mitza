import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { ReportPeriodPicker } from "./report-period-picker";

/**
 * Etapa "Relatório Único": ÚNICA função desta página é escolher um período e
 * abrir o Relatório de Performance já existente pra ele — "Cliente →
 * Relatório → selecionar período → Gerar relatório", nunca um Analytics
 * intermediário no meio do caminho. Nenhum dado de performance é buscado
 * aqui (isso é 100% do Relatório de Performance,
 * `/api/clients/[id]/performance-report`); esta rota só confirma que o
 * cliente existe (mesmo critério de RLS + 404 silencioso de
 * `clients/[id]/page.tsx`) e mostra o nome pro contexto.
 */
export default async function ClientReportPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase.from("clients").select("id, name").eq("id", id).is("deleted_at", null).single();

  if (error) console.error(`[ClientReportPeriodPage] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <Link href={`/clients/${client.id}`} className="text-sm font-medium text-brand hover:underline">
        &larr; {client.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-overview-text-primary">Relatório de Performance</h1>
      <p className="mt-1 text-sm text-overview-text-secondary">Escolha o período e gere o relatório.</p>

      <div className="mt-6">
        <ReportPeriodPicker clientId={client.id} today={todayDateString()} />
      </div>
    </div>
  );
}
