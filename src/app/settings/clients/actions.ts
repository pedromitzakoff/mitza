"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { normalizeCnpj, isValidCnpjLength } from "@/lib/cnpj";
import { isValidEmail } from "@/lib/validation";
import type { ClientContractStatus } from "@/lib/supabase/database.types";

const CONTRACT_STATUSES: ClientContractStatus[] = ["ativo", "pausado", "encerrado"];

/** As 6 actions abaixo editam um campo só por vez (edição inline da tabela
 * de Configurações > Clientes) — nunca redirecionam: a Server Action só
 * grava e revalida, o Next.js atualiza a própria rota sozinho. Entrada
 * inválida é ignorada silenciosamente (a célula já valida antes de chamar;
 * isso aqui é só a segunda camada de defesa). */
function revalidateClientLists() {
  revalidatePath("/settings/clients");
  revalidatePath("/clients");
}

export async function updateClientStatusAction(clientId: string, status: string) {
  await requireAdmin();
  if (!CONTRACT_STATUSES.includes(status as ClientContractStatus)) return;

  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ status: status as ClientContractStatus }).eq("id", clientId);
  revalidateClientLists();
}

export async function updateClientPrimaryManagerAction(clientId: string, managerId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ primary_manager_id: managerId || null }).eq("id", clientId);
  revalidateClientLists();
}

export async function updateClientContractStartAction(clientId: string, date: string | null) {
  await requireAdmin();
  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ contract_start_date: date }).eq("id", clientId);
  revalidateClientLists();
}

export async function updateClientCnpjAction(clientId: string, rawCnpj: string) {
  await requireAdmin();
  const digits = normalizeCnpj(rawCnpj);
  if (!isValidCnpjLength(digits)) return;

  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ cnpj: digits || null }).eq("id", clientId);
  revalidateClientLists();
}

export async function updateClientEmailAction(clientId: string, rawEmail: string) {
  await requireAdmin();
  const email = rawEmail.trim();
  if (email && !isValidEmail(email)) return;

  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ main_contact_email: email || null }).eq("id", clientId);
  revalidateClientLists();
}

export async function updateClientMonthlyFeeAction(clientId: string, value: number | null) {
  await requireAdmin();
  if (value !== null && (!Number.isFinite(value) || value < 0)) return;

  const supabase = await createSupabaseClient();
  await supabase.from("clients").update({ agency_monthly_fee: value }).eq("id", clientId);
  revalidateClientLists();
}
