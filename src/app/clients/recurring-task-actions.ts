"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";
import { OPTIMIZATION_QUICK_GROUPS } from "@/lib/recurring-tasks";

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

/** Valida o JSON do picker de otimização (`optimization_selections_json`,
 * montado no cliente por `OptimizationQuickPicker`) contra as combinações
 * curadas de `OPTIMIZATION_QUICK_GROUPS` — nunca confia em type/action/
 * quantity vindos do formulário sem checar contra a lista oficial (defesa em
 * profundidade, mesmo princípio de `parseOptimizations` na Análise da Conta
 * manual, `account-review-actions.ts`). */
function parseOptimizationSelections(raw: string): { type: string; action: string; quantity: number }[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: { type: string; action: string; quantity: number }[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    const action = (item as Record<string, unknown>).action;
    const quantity = Math.trunc(Number((item as Record<string, unknown>).quantity));

    const isKnownCombo = OPTIMIZATION_QUICK_GROUPS.some((group) =>
      group.actions.some((quickAction) => quickAction.type === type && quickAction.action === action),
    );
    if (!isKnownCombo || !(quantity > 0)) continue;

    valid.push({ type: type as string, action: action as string, quantity });
  }
  return valid;
}

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
  const optimizationSelections = parseOptimizationSelections(String(formData.get("optimization_selections_json") ?? ""));

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
    // migration que remove as assinaturas antigas).
    p_client_report_id: null,
    p_source: "web",
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
