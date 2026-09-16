"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { isValidAccountReviewDiagnosis, parseOptimizationSelections } from "@/lib/account-reviews";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";

/**
 * Registra uma revisão operacional (Etapa "Histórico de Decisões
 * Operacionais" — substitui o formulário de 3 perguntas condicionais por
 * Diagnóstico + Ação + Observação, ver `record-account-review-drawer.tsx`).
 * `reason` sempre `'ROUTINE'` e `outcome` sempre DERIVADO do número de ações
 * selecionadas (nenhuma ⇒ `NO_CHANGE`, 1+ ⇒ `OPTIMIZATION_PERFORMED') —
 * nenhum dos dois é mais perguntado nesta tela; o fluxo de "problema
 * identificado + criar tarefa" também saiu daqui (criar uma tarefa continua
 * disponível como funcionalidade genérica do produto, só não é mais um passo
 * deste formulário rápido). Toda a validação de negócio e a gravação
 * (revisão + otimizações + eventos operacionais) continuam acontecendo
 * atomicamente em `record_account_review` (supabase/account-review-diagnosis.sql);
 * esta action só resolve o ator, normaliza o input e traduz erros do banco.
 */
export async function recordAccountReviewAction(clientId: string, returnTo: string, formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reviewError=${encodeURIComponent("Sessão expirada, faça login de novo")}`);
  }

  const supabase = await createSupabaseClient();

  const blocked = await checkWorkspaceClientAction(supabase, clientId);
  if (blocked) fail(blocked);

  const diagnosisRaw = String(formData.get("diagnosis") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const optimizations = parseOptimizationSelections(String(formData.get("optimization_selections_json") ?? ""));

  function fail(message: string): never {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reviewError=${encodeURIComponent(message)}`);
  }

  if (!isValidAccountReviewDiagnosis(diagnosisRaw)) fail("Selecione o diagnóstico da conta.");

  const { data, error } = await supabase.rpc("record_account_review", {
    p_client_id: clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_reason: "ROUTINE",
    p_reason_other_description: null,
    p_outcome: optimizations.length > 0 ? "OPTIMIZATION_PERFORMED" : "NO_CHANGE",
    p_notes: notes,
    p_issue_description: null,
    p_issue_category: null,
    p_optimizations: optimizations.map((opt) => ({ type: opt.type, action: opt.action, quantity: opt.quantity })),
    p_create_task: false,
    p_task_responsible_id: null,
    p_task_due_date: null,
    p_source: "web",
    p_diagnosis: diagnosisRaw,
  });

  if (error || !data) fail(error?.message ?? "Não foi possível registrar a revisão.");

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");
  // Etapa 59, seção 16: ação rápida "Gerar atualização" depois de registrar
  // — o banner de sucesso na página do cliente usa este id, nunca o
  // gestor precisa reabrir a análise manualmente pra chegar lá.
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reviewSaved=${data.reviewId}`);
}

// Etapa "Simplificação do Cadastro do Cliente": `updateAccountReviewCadenceAction`
// foi removida — decisão de produto explícita ("a KOFF não usa mais
// Cadência de Revisões como processo operacional"), bloco correspondente
// saiu de `/clients/[id]/edit` (único chamador) e sua influência sobre
// saúde/prioridade operacional foi neutralizada em
// `lib/account-health-engine.ts`/`lib/attention-alerts.ts`. A tabela
// `account_review_cadences` continua existindo e sendo LIDA normalmente
// (`resolveReviewCadenceInputs`, `lib/account-health-engine.ts` — linhas já
// configuradas continuam resolvidas do mesmo jeito, só ninguém mais escreve
// nelas por aqui) — nenhuma migration destrutiva.
