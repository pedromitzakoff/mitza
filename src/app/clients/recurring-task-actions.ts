"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";
import { ACCOUNT_REVIEW_DIAGNOSIS_LABEL, isValidAccountReviewDiagnosis, parseOptimizationSelections } from "@/lib/account-reviews";
import type { AccountReviewDiagnosis } from "@/lib/supabase/database.types";

/**
 * Bug crítico corrigido — antes, QUALQUER falha (sessão expirada, cliente
 * pausado, erro do RPC) fazia um `redirect()` de volta pro `closeHref` — o
 * MESMO href que fecha o drawer — carregando a mensagem na querystring
 * (`recurringTaskError`). Isso fechava o drawer, apagava toda seleção de
 * chips/checklist e a observação (o formulário inteiro era recriado do
 * zero), e a mensagem virava um banner solto no topo da página, sem relação
 * nenhuma com o botão clicado.
 *
 * Agora o Server Action só usa `redirect()` no SUCESSO (fecha o drawer de
 * propósito, comportamento inalterado — ver "Em caso de sucesso" no pedido
 * do usuário). No erro, ele retorna este estado estruturado — SEM navegação
 * nenhuma — pra `useActionState` (`register-execution-form.tsx`); como o
 * DOM do formulário nunca desmonta, as seleções e a observação continuam
 * exatamente como o gestor deixou, sem precisar duplicar esse estado aqui.
 */
export type RegisterExecutionState = { status: "idle" } | { status: "success" } | { status: "error"; message: string };

/** SQLSTATE de um `raise exception '...'` sem código customizado — é assim
 * que `register_recurring_execution`/`record_account_review` sinalizam uma
 * regra de negócio já escrita em português pra ser lida pelo gestor (ex.:
 * "Nenhuma sprint encontrada para a data de hoje..."). Qualquer OUTRO
 * código (ambiguidade de função, violação de constraint, etc.) é um erro
 * técnico — nunca mostrado cru, só logado no servidor (seção
 * "Observabilidade" do pedido do usuário). */
const RAISED_BUSINESS_ERROR_CODE = "P0001";
const GENERIC_ERROR_MESSAGE = "Não foi possível registrar a otimização. Suas seleções foram mantidas. Tente novamente.";

/**
 * Registra uma execução de tarefa recorrente — nunca conclui a tarefa (ela é
 * permanente), sempre cria um novo registro em `recurring_task_executions`
 * (e, pra Otimização, também um `account_reviews` por baixo). Toda a
 * validação de negócio e a gravação acontecem atomicamente em
 * `register_recurring_execution` (supabase/recurring-tasks.sql); esta action
 * só resolve o ator e traduz erros do banco em mensagens seguras.
 *
 * `checklist_items` (checkboxes marcados no drawer, presente só quando a
 * recorrência tem `has_checklist=true` e NÃO é a Otimização) vira
 * `p_checklist_selected_keys`. `optimization_selections_json` (o picker de
 * chips, presente só quando `uses_account_review=true`) vira
 * `p_optimization_selections` — a mesma action serve qualquer recorrência,
 * com checklist genérico, com o picker de otimização, ou sem nenhum dos
 * dois.
 *
 * Assinatura em `(recurringTaskId, clientId, returnTo, prevState, formData)`
 * — os 3 primeiros vêm de `.bind()` no client component, os 2 últimos são o
 * contrato que `useActionState` exige (ver `register-execution-form.tsx`).
 */
export async function registerRecurringExecutionAction(
  recurringTaskId: string,
  clientId: string,
  returnTo: string,
  _prevState: RegisterExecutionState,
  formData: FormData,
): Promise<RegisterExecutionState> {
  const profile = await getCurrentProfile();
  if (!profile) return { status: "error", message: "Sessão expirada, faça login de novo." };

  const supabase = await createSupabaseClient();

  const blocked = await checkWorkspaceClientAction(supabase, clientId);
  if (blocked) return { status: "error", message: blocked };

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const checklistSelectedKeys = formData.getAll("checklist_items").map(String);

  // Presença de `optimization_selections_json` no formData é o mesmo sinal
  // que `RegisterExecutionForm` usa pra decidir se renderiza
  // `OptimizationQuickPicker`+`DiagnosisPicker` (`usesAccountReview=true`) —
  // reaproveitado aqui pra saber se diagnóstico é exigido nesta submissão
  // específica (recorrências com checklist genérico não têm o campo, então
  // nunca caem nesta validação).
  const isAccountReviewFlow = formData.has("optimization_selections_json");
  const optimizationSelections = parseOptimizationSelections(String(formData.get("optimization_selections_json") ?? ""));
  const diagnosisRaw = String(formData.get("diagnosis") ?? "");
  const diagnosis: AccountReviewDiagnosis | null = isValidAccountReviewDiagnosis(diagnosisRaw) ? diagnosisRaw : null;

  if (isAccountReviewFlow && !diagnosis) {
    return { status: "error", message: "Selecione o diagnóstico da conta." };
  }

  // "Criar tarefa a partir desta revisão" (revisão pós-aprovação) — mesma
  // capacidade discreta da revisão manual, disponível aqui porque as duas
  // escrevem a mesma account_reviews por baixo (record_account_review).
  // Texto da tarefa: a observação, quando preenchida, ou o rótulo do
  // diagnóstico quando não há observação — nunca em branco, nunca um campo
  // novo no formulário.
  const createTask = isAccountReviewFlow && formData.get("create_task") === "on";
  const taskContext = createTask ? notes ?? (diagnosis ? ACCOUNT_REVIEW_DIAGNOSIS_LABEL[diagnosis] : null) : null;

  const { error } = await supabase.rpc("register_recurring_execution", {
    p_recurring_task_id: recurringTaskId,
    p_client_id: clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_notes: notes,
    p_checklist_selected_keys: checklistSelectedKeys.length > 0 ? checklistSelectedKeys : null,
    p_optimization_selections: optimizationSelections.length > 0 ? optimizationSelections : null,
    // BUG CORRIGIDO ("não foi possível escolher a melhor função candidata"):
    // omitir este parâmetro deixava a chamada ambígua entre a assinatura
    // antiga de register_recurring_execution (sem p_client_report_id) e a
    // atual (com ele, default null) — as duas eram candidatas válidas pro
    // mesmo conjunto de argumentos nomeados. Passar `null` explicitamente
    // nunca depende da resolução automática do Postgres (ver também a
    // migration que remove as assinaturas antigas). Mesmo raciocínio agora
    // pra p_diagnosis/p_create_task/p_issue_description, novos nesta etapa —
    // mesma migration já cuida de remover a assinatura antiga que não os tinha.
    p_client_report_id: null,
    p_source: "web",
    p_diagnosis: diagnosis,
    p_create_task: createTask,
    p_issue_description: taskContext,
  });

  if (error) {
    // Nunca engolir o erro — contexto completo pro servidor, mensagem segura
    // pra UI. `raise exception` no plpgsql (RAISED_BUSINESS_ERROR_CODE) já
    // escreve mensagens em português pensadas pra aparecer pro gestor (ex.:
    // "Tarefa recorrente não encontrada."); qualquer outro código (RPC
    // ambígua, violação de constraint, etc.) é técnico e nunca é exposto cru.
    console.error("[registerRecurringExecutionAction] register_recurring_execution falhou", {
      clientId,
      recurringTaskId,
      teamMemberId: profile.id,
      optimizationSelections,
      checklistSelectedKeys,
      source: "web",
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    const message = error.code === RAISED_BUSINESS_ERROR_CODE ? error.message : GENERIC_ERROR_MESSAGE;
    return { status: "error", message };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");
  redirect(returnTo);
}
