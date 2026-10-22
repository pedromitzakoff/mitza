"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { fetchMetaApiAccountBalance, fetchMetaApiInsightsForAccount } from "@/lib/meta-api-fetch";
import { syncOneMetaApiAccount } from "@/lib/meta-api-direct-sync";
import { runMetaApiBackfill } from "@/lib/meta-api-backfill";
import { META_API_ACTIONS_PREFIX, META_API_ACTION_VALUES_PREFIX, collectDistinctActionTypes } from "@/lib/meta-api-ingest";
import { todayDateString } from "@/lib/today";
import type { PerformanceGoal } from "@/lib/performance-goals";

/**
 * KOFF Analytics — "Interface para conectar contas Meta" (ponto 1 do pedido
 * do usuário): substitui o procedimento manual via SQL descrito em
 * `docs/N8N_META_INGESTION_GUIDE.md` (seção 5) por uma tela admin. Reaproveita
 * 100% dos serviços já existentes — `requireAdmin` (mesma autorização de
 * toda Configurações), `fetchMetaApiAccountBalance`/`fetchMetaApiInsightsForAccount`
 * (mesmas chamadas à Graph API que o sync real usa, nunca uma segunda
 * implementação), `syncOneMetaApiAccount` (mesmo motor do cron e do botão
 * "Sincronizar agora" do Cockpit).
 *
 * Nenhuma linha aqui apaga dado histórico — `import_sources` só recebe
 * INSERT (conta nova) ou UPDATE de `external_account_id`/`enabled`/`status`
 * (reconectar/trocar conta); `metric_mappings` só recebe INSERT (novo
 * mapeamento) ou `active = false` (retirar um mapeamento) — nunca DELETE,
 * mesma disciplina já documentada em `docs/STRACT_INTEGRATION_ARCHITECTURE.md`.
 */

const ACCOUNT_ID_PATTERN = /^act_\d+$/;

function manageUrl(clientId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ manage: clientId, ...extra });
  return `/settings/meta-connections?${params.toString()}`;
}

function failure(message: string, clientId: string): never {
  redirect(manageUrl(clientId, { error: message }));
}

function success(message: string, clientId: string): never {
  redirect(manageUrl(clientId, { saved: message }));
}

/**
 * Traduz erros da Graph API em mensagens que distinguem "token inválido/
 * expirado" de "conta inexistente ou sem permissão" (ponto 1 do pedido:
 * "Identificar erros de autenticação ou permissões") — nunca um erro
 * genérico só. Tela admin-only: mostrar a mensagem bruta da Meta ao final é
 * seguro e útil (não é uma superfície voltada ao cliente final).
 */
function describeMetaApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("não configurado")) return raw;
  if (lower.includes("access token") || lower.includes("oauth")) {
    return `Token de acesso da Meta inválido ou expirado — confira a variável de ambiente META_API_ACCESS_TOKEN. Detalhe: ${raw}`;
  }
  if (lower.includes("permission") || lower.includes("does not exist") || lower.includes("unknown path")) {
    return `Sem permissão pra esta conta, ou conta inexistente — confirme o ID (formato act_...) e se o token tem acesso a ela. Detalhe: ${raw}`;
  }
  return `Falha ao validar a conta na Meta: ${raw}`;
}

/**
 * Cadastra OU atualiza a fonte `meta_api` de UM cliente — upsert manual (não
 * via `.upsert()` do Supabase porque a identidade real aqui é
 * `(client_id, provider, channel)`, não uma constraint única formal; um
 * cliente tem no máximo uma conexão `meta_api` ativa, mesma suposição já
 * usada por `/settings/meta-connections` hoje — `importSourceByClientId` é
 * um Map por `client_id`). Valida a conta na Meta ANTES de gravar qualquer
 * coisa — nunca cadastra um `act_...` que a própria Meta já rejeitaria.
 */
export async function connectMetaApiAccountAction(clientId: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    failure('ID de conta inválido — use o formato "act_" seguido só de números (ex.: act_123456789).', clientId);
  }

  try {
    const balance = await fetchMetaApiAccountBalance(accountId);
    if (balance === null) {
      failure("A Meta respondeu, mas sem os dados mínimos da conta — confirme o ID e tente novamente.", clientId);
    }
  } catch (err) {
    failure(describeMetaApiError(err), clientId);
  }

  const { data: existing } = await supabase
    .from("import_sources")
    .select("id, external_account_id")
    .eq("client_id", clientId)
    .eq("provider", "meta_api")
    .eq("channel", "meta")
    .maybeSingle();

  if (existing) {
    const accountChanged = existing.external_account_id !== accountId;
    const { error } = await supabase
      .from("import_sources")
      .update({ external_account_id: accountId, enabled: true, ...(accountChanged ? { status: "pending" } : {}) })
      .eq("id", existing.id);
    if (error) failure("Não foi possível atualizar a conexão existente.", clientId);
  } else {
    const { error } = await supabase
      .from("import_sources")
      .insert({ client_id: clientId, provider: "meta_api", channel: "meta", external_account_id: accountId, enabled: true, status: "pending" });
    if (error) failure("Não foi possível cadastrar a nova conexão.", clientId);
  }

  revalidatePath("/settings/meta-connections");
  success('Conta conectada. Clique em "Sincronizar agora" pra confirmar que os dados chegam certos.', clientId);
}

/**
 * "Executar sincronização manual" — mesmo motor usado pelo cron
 * (`/api/cron/sync-meta-api`) e pelo botão "Sincronizar agora" do Cockpit
 * (`syncClientMetaApiSourcesAction`), só que pra UMA conta específica (a que
 * está sendo configurada nesta tela) e sem redirect — resultado aparece
 * inline via `ToastActionButton`.
 */
export async function syncMetaConnectionAction(accountId: string): Promise<{ error?: string; message?: string }> {
  await requireAdmin();

  const result = await syncOneMetaApiAccount(accountId);
  revalidatePath("/settings/meta-connections");

  switch (result.outcome) {
    case "ok":
      return { message: `Sincronizado — ${result.rowsRead ?? 0} linha(s) lida(s) nos últimos 3 dias.` };
    case "unregistered_account":
      return { error: "Conta não encontrada em import_sources — recarregue a página e tente de novo." };
    case "disabled_source":
      return { error: "Esta fonte está desativada." };
    case "concurrent_run":
      return { error: "Já existe uma sincronização em andamento pra esta conta — aguarde terminar." };
    case "error":
    default:
      return { error: describeMetaApiError(new Error(result.errorMessage ?? "Erro desconhecido ao sincronizar.")) };
  }
}

function sevenDayWindow(today: string): { since: string; until: string } {
  const untilDate = new Date(`${today}T00:00:00Z`);
  const sinceDate = new Date(untilDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 6);
  return { since: sinceDate.toISOString().slice(0, 10), until: today };
}

/**
 * "Mapeamento de resultados" (ponto 4 do pedido): descobre os `action_type`
 * REAIS que a conta recebeu nos últimos 7 dias — nunca uma lista adivinhada
 * ou copiada da convenção do Stract (mesmo aviso de
 * `docs/N8N_META_INGESTION_GUIDE.md`, seção 5). Reaproveita
 * `fetchMetaApiInsightsForAccount` (mesma chamada que o sync real já faz) +
 * `collectDistinctActionTypes` (`lib/meta-api-ingest.ts`, já existia, nunca
 * usada antes desta tela).
 */
export async function discoverActionTypesAction(accountId: string): Promise<{ error?: string; actionTypes?: string[] }> {
  await requireAdmin();

  const { since, until } = sevenDayWindow(todayDateString());
  try {
    const rows = await fetchMetaApiInsightsForAccount(accountId, since, until);
    const actionTypes = collectDistinctActionTypes(rows);
    if (actionTypes.length === 0) {
      return {
        error:
          "Nenhum evento de resultado encontrado nos últimos 7 dias pra esta conta — pode ser falta de conversão no período, ou os dados ainda não propagaram. Você pode digitar o action_type manualmente, mas confirme o nome exato no Gerenciador de Anúncios da Meta antes de salvar.",
      };
    }
    return { actionTypes };
  } catch (err) {
    return { error: describeMetaApiError(err) };
  }
}

/**
 * Adiciona um novo mapeamento ativo — NUNCA desativa outro mapeamento do
 * mesmo objetivo automaticamente (um objetivo pode somar mais de um
 * `action_type` ao mesmo tempo, ver `docs/STRACT_INTEGRATION_ARCHITECTURE.md`,
 * ponto 2 da arquitetura original — a mesma regra vale aqui). Pra retirar um
 * mapeamento, o admin usa "Desativar" explicitamente
 * (`deactivateMetricMappingAction`) — nunca um `UPDATE` implícito aqui.
 */
export async function saveMetricMappingAction(importSourceId: string, clientId: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const goal = String(formData.get("goal") ?? "");
  if (goal !== "leads" && goal !== "sales" && goal !== "followers") {
    failure("Selecione um objetivo válido.", clientId);
  }

  const manualActionType = String(formData.get("action_type_manual") ?? "").trim();
  const selectedActionType = String(formData.get("action_type") ?? "").trim();
  const actionType = manualActionType || selectedActionType;
  if (!actionType) {
    failure("Informe qual evento da Meta (action_type) representa este objetivo.", clientId);
  }

  const valueActionType = String(formData.get("value_action_type") ?? "").trim();

  const resultColumn = `${META_API_ACTIONS_PREFIX}${actionType}`;
  const valueColumn = valueActionType ? `${META_API_ACTION_VALUES_PREFIX}${valueActionType}` : null;

  const { data: duplicate } = await supabase
    .from("metric_mappings")
    .select("id")
    .eq("import_source_id", importSourceId)
    .eq("goal", goal as PerformanceGoal)
    .eq("result_column", resultColumn)
    .eq("active", true)
    .maybeSingle();

  if (duplicate) {
    failure("Este evento já está mapeado e ativo pra este objetivo.", clientId);
  }

  const { error } = await supabase.from("metric_mappings").insert({
    import_source_id: importSourceId,
    goal: goal as PerformanceGoal,
    result_column: resultColumn,
    value_column: valueColumn,
    active: true,
  });

  if (error) failure("Não foi possível salvar o mapeamento.", clientId);

  revalidatePath("/settings/meta-connections");
  success("Mapeamento salvo.", clientId);
}

/**
 * "Backfill histórico" (ponto 3 do pedido de migração) — pedido explícito
 * do usuário: "Não execute backfill real sem minha autorização." Esta
 * action só RODA quando um admin preenche o intervalo e clica no botão na
 * própria tela — nenhum cron, script ou outra parte do código chama isto.
 * Nunca recebe `client_id` como parâmetro de escrita — `accountId` é o único
 * identificador usado, e `runMetaApiBackfill`/`ingestMetaApiPayload` sempre
 * resolvem o cliente de volta via `import_sources` (nunca é possível
 * escrever no cliente errado por esta tela).
 */
export async function runMetaApiBackfillAction(accountId: string, clientId: string, formData: FormData) {
  await requireAdmin();

  const since = String(formData.get("since") ?? "").trim();
  const until = String(formData.get("until") ?? "").trim();

  const outcome = await runMetaApiBackfill(accountId, since, until);
  revalidatePath("/settings/meta-connections");

  if ("error" in outcome) failure(outcome.error, clientId);

  const { result } = outcome;
  if (result.stoppedEarly) {
    const lastOutcome = result.batches[result.batches.length - 1]?.outcome ?? "desconhecida";
    failure(
      `Backfill interrompido depois de ${result.completedBatches}/${result.totalBatches} lote(s) — motivo: ${lastOutcome}. ${result.totalRowsRead} linha(s) lida(s) até parar.`,
      clientId,
    );
  }

  const failedBatches = result.batches.filter((b) => b.outcome !== "ok");
  if (failedBatches.length > 0) {
    failure(
      `Backfill concluído com ${failedBatches.length} de ${result.totalBatches} lote(s) com problema — ${result.totalRowsRead} linha(s) lida(s) no total. Confira o histórico de execuções antes de considerar completo.`,
      clientId,
    );
  }

  success(`Backfill concluído — ${result.totalBatches} lote(s), ${result.totalRowsRead} linha(s) lida(s).`, clientId);
}

export interface ConnectionTestResult {
  clientId: string;
  clientName: string;
  accountId: string;
  ok: boolean;
  error?: string;
}

/**
 * "Testar todas as conexões" — pedido do usuário depois de descobrir, uma
 * conta de cada vez, que algumas (ex.: Vaapty SBC) não têm permissão
 * concedida pro token da MITZA na Meta. Em vez de abrir "Gerenciar" e
 * clicar em cada cliente um por um, testa TODAS as fontes `meta_api`
 * habilitadas de uma vez, em paralelo — reaproveita exatamente a mesma
 * chamada de validação do "Conectar" (`fetchMetaApiAccountBalance`) e a
 * mesma tradução de erro (`describeMetaApiError`), nunca uma segunda
 * implementação. Só leitura — nenhuma gravação, mesmo critério de qualquer
 * outro diagnóstico desta tela.
 *
 * Paralelo (não sequencial como `syncAllMetaApiAccounts`): são chamadas
 * independentes, só leitura, disparadas manualmente por um admin — nunca
 * automático/frequente — então não tem o mesmo risco de rate limit que uma
 * sincronização em lote escrevendo no banco teria.
 */
export async function testAllMetaConnectionsAction(): Promise<{ results: ConnectionTestResult[] } | { error: string }> {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const [{ data: sources, error: sourcesError }, { data: clients, error: clientsError }] = await Promise.all([
    supabase.from("import_sources").select("client_id, external_account_id").eq("provider", "meta_api").eq("channel", "meta").eq("enabled", true),
    supabase.from("clients").select("id, name"),
  ]);

  if (sourcesError) return { error: "Não foi possível carregar as conexões cadastradas." };
  if (clientsError) return { error: "Não foi possível carregar os clientes." };
  if (!sources || sources.length === 0) return { results: [] };

  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));

  const results = await Promise.all(
    sources.map(async (source): Promise<ConnectionTestResult> => {
      const clientName = nameById.get(source.client_id) ?? "Cliente desconhecido";
      try {
        const row = await fetchMetaApiAccountBalance(source.external_account_id);
        if (row === null) {
          return {
            clientId: source.client_id,
            clientName,
            accountId: source.external_account_id,
            ok: false,
            error: "A Meta respondeu, mas sem os dados mínimos da conta.",
          };
        }
        return { clientId: source.client_id, clientName, accountId: source.external_account_id, ok: true };
      } catch (err) {
        return { clientId: source.client_id, clientName, accountId: source.external_account_id, ok: false, error: describeMetaApiError(err) };
      }
    }),
  );

  results.sort((a, b) => (a.ok === b.ok ? a.clientName.localeCompare(b.clientName) : a.ok ? 1 : -1));

  return { results };
}

/** "Desativar" — nunca `DELETE`, mesma disciplina de histórico preservado
 * de `docs/STRACT_INTEGRATION_ARCHITECTURE.md` (ponto 2: "mudança de
 * mapeamento desativa a linha antiga... nunca UPDATE destrutivo"). */
export async function deactivateMetricMappingAction(mappingId: string): Promise<{ error?: string; message?: string }> {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase.from("metric_mappings").update({ active: false }).eq("id", mappingId);
  if (error) return { error: "Não foi possível desativar o mapeamento." };

  revalidatePath("/settings/meta-connections");
  return { message: "Mapeamento desativado." };
}
