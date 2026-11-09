/**
 * KOFF Analytics — Auditoria read-only de fuso horário/moeda/atribuição
 * (pedido explícito do usuário: "verificar a confiabilidade dos dados da
 * KOFF sem alterar campanhas, configurações, banco de dados ou histórico").
 *
 * GARANTIAS DE SEGURANÇA (lidas antes de rodar):
 * - Só faz chamadas GET à Graph API (`/act_.../insights`, `/act_...`,
 *   `/act_.../adsets`) — NUNCA POST/PATCH/DELETE, nunca cria/edita/pausa
 *   nenhum objeto de anúncio.
 * - Se credenciais do Supabase estiverem presentes, só faz `.select()` —
 *   NUNCA `.insert()`/`.update()`/`.upsert()`/`.delete()`. Sem as
 *   credenciais, esse passo é pulado inteiro (não é obrigatório).
 * - NUNCA chama `ingestMetaApiPayload`/qualquer função de sincronização —
 *   nenhum dado é gravado em `daily_spend`/`campaign_daily_metrics`/
 *   `daily_performance`/etc.
 * - O token de acesso NUNCA aparece no stdout nem no JSON de saída — toda
 *   função de log recebe os parâmetros da chamada já sem `access_token`.
 * - A saída (JSON com números reais de investimento/resultado das contas)
 *   vai pra `scripts/audit-output/`, que está no `.gitignore` — nunca
 *   commitada sem querer.
 *
 * O QUE ESTE SCRIPT NÃO FAZ (fora do seu escopo, de propósito):
 * - Não compara com o Gerenciador de Anúncios — isso é sempre uma etapa
 *   MANUAL separada, feita por um humano olhando a tela da Meta (pedido
 *   explícito: "não declare que os dados conferem... apenas porque duas
 *   consultas da API retornaram o mesmo valor").
 * - Não decide qual janela de atribuição é "a certa" — só expõe o
 *   comportamento real de cada cenário, lado a lado, pra decisão humana.
 *
 * USO:
 *   META_API_ACCESS_TOKEN=... npx tsx scripts/audit-meta-attribution.ts act_111 act_222 --since 2026-10-19 --until 2026-10-22
 *
 *   Opcional (pra também comparar contra o que já está gravado no banco
 *   da MITZA pro mesmo período — só leitura):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/audit-meta-attribution.ts act_111 act_222 --since 2026-10-19 --until 2026-10-22
 *
 * Rode num ambiente que já tenha META_API_ACCESS_TOKEN configurado (local
 * com .env.local carregado, ou onde já existam as credenciais de produção)
 * — nunca cole o token direto no comando nem em texto versionado.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchMetaApiInsightsForAccount, mapMetaInsightsRowToIngestRow } from "../src/lib/meta-api-fetch";
import type { MetaApiIngestRow } from "../src/lib/meta-api-ingest";

const META_GRAPH_API_VERSION = "v25.0"; // Mantenha sincronizado com src/lib/meta-api-fetch.ts — não importado de lá porque é const privada.

// ---------------------------------------------------------------------------
// Args

interface CliArgs {
  accountIds: string[];
  since: string;
  until: string;
}

function parseArgs(argv: string[]): CliArgs {
  const accountIds: string[] = [];
  let since: string | undefined;
  let until: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--since") since = argv[++i];
    else if (arg === "--until") until = argv[++i];
    else if (arg.startsWith("act_")) accountIds.push(arg);
  }

  if (accountIds.length === 0) throw new Error("Informe pelo menos 1 conta (ex.: act_123456789). Veja o doc-comment do arquivo pro uso completo.");
  if (!since || !until) throw new Error("Informe --since YYYY-MM-DD --until YYYY-MM-DD (um período curto e conhecido, ex.: a mesma janela que você já conferiu manualmente antes).");

  return { accountIds, since, until };
}

function requireToken(): string {
  const token = process.env.META_API_ACCESS_TOKEN;
  if (!token) throw new Error("META_API_ACCESS_TOKEN não configurado neste ambiente.");
  return token;
}

// ---------------------------------------------------------------------------
// Chamadas brutas à Graph API — SEMPRE GET, nunca loga o token.

interface GraphCallLog {
  path: string;
  /** Parâmetros usados na chamada, já SEM `access_token` — seguro de logar/salvar. */
  params: Record<string, string>;
}

interface GraphResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  call: GraphCallLog;
}

async function graphGet<T = unknown>(path: string, params: Record<string, string>, token: string): Promise<GraphResult<T>> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const call: GraphCallLog = { path, params }; // nunca inclui access_token
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok) return { ok: false, data: null, error: json?.error?.message ?? res.statusText, call };
    return { ok: true, data: json as T, error: null, call };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err), call };
  }
}

// ---------------------------------------------------------------------------
// 1. Conta — id, fuso, moeda

interface AccountInfoRaw {
  id?: string;
  name?: string;
  timezone_id?: number;
  timezone_name?: string;
  currency?: string;
}

async function fetchAccountInfo(accountId: string, token: string) {
  return graphGet<AccountInfoRaw>(`/${accountId}`, { fields: "id,name,timezone_id,timezone_name,currency" }, token);
}

// ---------------------------------------------------------------------------
// 2. Conjuntos de anúncios — configuração de atribuição por conjunto (se a
//    API ainda expuser isso — contas em estrutura ODAX/Outcome-driven podem
//    não ter mais este campo visível; o script só reporta o que vier, nunca
//    assume).

interface AdSetAttributionRaw {
  id?: string;
  name?: string;
  optimization_goal?: string;
  status?: string;
  attribution_spec?: { event_type: string; window_days: number }[];
}

async function fetchAdSetsAttribution(accountId: string, token: string) {
  return graphGet<{ data: AdSetAttributionRaw[] }>(
    `/${accountId}/adsets`,
    { fields: "id,name,optimization_goal,status,attribution_spec", limit: "25" },
    token,
  );
}

// ---------------------------------------------------------------------------
// 3. Insights — múltiplos cenários de atribuição, MESMA janela de datas,
//    MESMO nível/breakdown — só o parâmetro de atribuição/report_time muda
//    entre cenários, pra isolar exatamente o efeito dele.

interface InsightsRawRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

const INSIGHTS_FIELDS = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";

async function fetchInsightsScenario(
  accountId: string,
  token: string,
  since: string,
  until: string,
  extraParams: Record<string, string>,
): Promise<{ rows: MetaApiIngestRow[]; call: GraphCallLog; error: string | null }> {
  const baseParams: Record<string, string> = {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    breakdowns: "publisher_platform,platform_position",
    fields: INSIGHTS_FIELDS,
    ...extraParams,
  };

  const rows: InsightsRawRow[] = [];
  let nextUrl: string | undefined;
  let lastCall: GraphCallLog = { path: `/${accountId}/insights`, params: baseParams };
  let errorMessage: string | null = null;

  const first = await graphGet<{ data: InsightsRawRow[]; paging?: { next?: string } }>(`/${accountId}/insights`, baseParams, token);
  lastCall = first.call;
  if (!first.ok) {
    return { rows: [], call: lastCall, error: first.error };
  }
  rows.push(...(first.data?.data ?? []));
  nextUrl = first.data?.paging?.next;

  // Paginação: segue os links `next` da própria Meta (já incluem o token
  // deles mesmos na URL completa — nunca logamos essa URL inteira).
  while (nextUrl) {
    try {
      const res = await fetch(nextUrl);
      const json = await res.json();
      if (!res.ok) {
        errorMessage = `Falha na paginação: ${json?.error?.message ?? res.statusText}`;
        break;
      }
      rows.push(...(json.data ?? []));
      nextUrl = json.paging?.next;
    } catch (err) {
      errorMessage = `Falha na paginação: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }

  const mapped = rows
    .map((r) =>
      mapMetaInsightsRowToIngestRow({
        date_start: r.date_start,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        actions: r.actions,
        action_values: r.action_values,
      }),
    )
    .filter((r): r is MetaApiIngestRow => r !== null);

  return { rows: mapped, call: lastCall, error: errorMessage };
}

interface ScenarioTotals {
  label: string;
  paramsUsed: Record<string, string>;
  ok: boolean;
  error: string | null;
  rowCount: number;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  /** Soma de CADA action_type separadamente — nunca um "resultado oficial"
   * pré-decidido aqui (esse script não aplica metric_mappings nenhum). */
  actionTotals: Record<string, number>;
}

function summarizeRows(label: string, paramsUsed: Record<string, string>, rows: MetaApiIngestRow[], ok: boolean, error: string | null): ScenarioTotals {
  const actionTotals: Record<string, number> = {};
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;

  for (const row of rows) {
    totalSpend += row.spend;
    totalImpressions += row.impressions ?? 0;
    totalClicks += row.clicks ?? 0;
    for (const [actionType, count] of Object.entries(row.actions ?? {})) {
      actionTotals[actionType] = (actionTotals[actionType] ?? 0) + count;
    }
  }

  return { label, paramsUsed, ok, error, rowCount: rows.length, totalSpend, totalImpressions, totalClicks, actionTotals };
}

/**
 * Os 5 cenários pedidos — cada um isola UMA variável por vez (nunca dois
 * parâmetros de significado diferente testados juntos, pra não confundir
 * qual deles causou uma eventual divergência):
 *
 * A — exatamente como o MITZA sincroniza hoje (nenhum parâmetro de
 *     atribuição) — usa a MESMA função que a sincronização real usa,
 *     `fetchMetaApiInsightsForAccount`, não uma reimplementação.
 * B — atribuição explícita no "default" documentado pela própria Meta
 *     (7d_click + 1d_view).
 * C — janela mais estreita (1d_click só), pra medir o quanto a LARGURA da
 *     janela muda o resultado nesta conta específica.
 * D — `action_report_time=conversion` (atribui pelo dia da conversão, não
 *     pelo dia em que o anúncio foi servido) — eixo DIFERENTE da janela,
 *     nunca testado junto com B/C pra não misturar os dois efeitos.
 * E — `use_unified_attribution_setting=true` — parâmetro cuja existência
 *     eu não consegui confirmar na documentação oficial (acesso bloqueado
 *     neste ambiente); o script tenta e reporta se a API aceita ou rejeita,
 *     em vez de presumir.
 */
async function runScenariosForAccount(accountId: string, token: string, since: string, until: string): Promise<ScenarioTotals[]> {
  const results: ScenarioTotals[] = [];

  // Cenário A — caminho de produção real, sem reimplementar nada.
  try {
    const rows = await fetchMetaApiInsightsForAccount(accountId, since, until);
    results.push(summarizeRows("A — produção (sem parâmetro de atribuição)", {}, rows, true, null));
  } catch (err) {
    results.push(summarizeRows("A — produção (sem parâmetro de atribuição)", {}, [], false, err instanceof Error ? err.message : String(err)));
  }

  const scenarios: { label: string; params: Record<string, string> }[] = [
    { label: "B — atribuição explícita 7d_click + 1d_view (default documentado)", params: { action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]) } },
    { label: "C — atribuição explícita 1d_click (janela mais estreita)", params: { action_attribution_windows: JSON.stringify(["1d_click"]) } },
    { label: "D — action_report_time=conversion", params: { action_report_time: "conversion" } },
    { label: "E — use_unified_attribution_setting=true (parâmetro não confirmado na doc oficial)", params: { use_unified_attribution_setting: "true" } },
  ];

  for (const scenario of scenarios) {
    const { rows, error } = await fetchInsightsScenario(accountId, token, since, until, scenario.params);
    results.push(summarizeRows(scenario.label, scenario.params, rows, error === null, error));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 4. Comparação contra o que já está gravado no banco da MITZA — OPCIONAL,
//    só roda se as credenciais do Supabase estiverem presentes, e é
//    SEMPRE só leitura (.select, nunca .insert/.update/.upsert).

interface StoredComparison {
  available: boolean;
  reason?: string;
  importSourceId?: string;
  storedSpendSum?: number;
  storedCampaignCount?: number;
}

async function fetchStoredComparison(accountId: string, since: string, until: string): Promise<StoredComparison> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { available: false, reason: "Credenciais do Supabase não configuradas neste ambiente — passo pulado (opcional)." };
  }

  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  const { data: importSource, error: importSourceError } = await supabase
    .from("import_sources")
    .select("id, client_id, channel")
    .eq("provider", "meta_api")
    .eq("external_account_id", accountId)
    .maybeSingle();

  if (importSourceError || !importSource) {
    return { available: false, reason: `Conta ${accountId} não encontrada em import_sources (provider=meta_api) — nenhuma sincronização registrada pra ela ainda.` };
  }

  // `daily_spend` é por (client_id, channel) — não tem import_source_id
  // (um cliente pode ter mais de uma fonte pro mesmo canal historicamente,
  // mas o investimento diário é consolidado por canal, não por fonte).
  const { data: spendRows, error: spendError } = await supabase
    .from("daily_spend")
    .select("spend")
    .eq("client_id", importSource.client_id)
    .eq("channel", importSource.channel)
    .gte("date", since)
    .lte("date", until);

  const { data: campaignRows, error: campaignError } = await supabase
    .from("campaign_daily_metrics")
    .select("campaign_name")
    .eq("import_source_id", importSource.id)
    .gte("date", since)
    .lte("date", until);

  if (spendError || campaignError) {
    return { available: false, reason: `Falha ao ler dado gravado: ${spendError?.message ?? campaignError?.message}` };
  }

  return {
    available: true,
    importSourceId: importSource.id,
    storedSpendSum: (spendRows ?? []).reduce((sum, r) => sum + r.spend, 0),
    storedCampaignCount: new Set((campaignRows ?? []).map((r) => r.campaign_name)).size,
  };
}

// ---------------------------------------------------------------------------
// Orquestração + saída

interface AccountAuditReport {
  accountId: string;
  accountInfo: { ok: boolean; error: string | null; data: AccountInfoRaw | null; call: GraphCallLog };
  adSetsAttribution: { ok: boolean; error: string | null; data: AdSetAttributionRaw[] | null; call: GraphCallLog };
  scenarios: ScenarioTotals[];
  storedComparison: StoredComparison;
}

async function auditAccount(accountId: string, token: string, since: string, until: string): Promise<AccountAuditReport> {
  const accountInfo = await fetchAccountInfo(accountId, token);
  const adSets = await fetchAdSetsAttribution(accountId, token);
  const scenarios = await runScenariosForAccount(accountId, token, since, until);
  const storedComparison = await fetchStoredComparison(accountId, since, until);

  return {
    accountId,
    accountInfo: { ok: accountInfo.ok, error: accountInfo.error, data: accountInfo.data, call: accountInfo.call },
    adSetsAttribution: { ok: adSets.ok, error: adSets.error, data: adSets.data?.data ?? null, call: adSets.call },
    scenarios,
    storedComparison,
  };
}

function printScenarioTable(scenarios: ScenarioTotals[]) {
  for (const s of scenarios) {
    console.log(`\n  ${s.label}`);
    console.log(`    params: ${JSON.stringify(s.paramsUsed)}`);
    if (!s.ok) {
      console.log(`    ERRO: ${s.error}`);
      continue;
    }
    console.log(`    linhas: ${s.rowCount} | spend total: ${s.totalSpend.toFixed(2)} | impressões: ${s.totalImpressions} | cliques: ${s.totalClicks}`);
    const actionEntries = Object.entries(s.actionTotals);
    if (actionEntries.length === 0) {
      console.log(`    nenhum action_type com dado neste período/cenário`);
    } else {
      for (const [actionType, count] of actionEntries) console.log(`    action "${actionType}": ${count}`);
    }
  }
}

async function main() {
  const { accountIds, since, until } = parseArgs(process.argv.slice(2));
  const token = requireToken();

  console.log(`KOFF Analytics — Auditoria read-only de atribuição/fuso/moeda`);
  console.log(`Período: ${since} a ${until} | Contas: ${accountIds.join(", ")}`);
  console.log(`Graph API version: ${META_GRAPH_API_VERSION}`);
  console.log(`\nNenhuma escrita será feita — só leitura, Meta API e (se configurado) Supabase.\n`);

  const reports: AccountAuditReport[] = [];

  for (const accountId of accountIds) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`Conta: ${accountId}`);
    console.log(`${"=".repeat(70)}`);

    const report = await auditAccount(accountId, token, since, until);
    reports.push(report);

    console.log(`\n-- Informações da conta --`);
    if (report.accountInfo.ok && report.accountInfo.data) {
      const d = report.accountInfo.data;
      console.log(`  nome: ${d.name ?? "—"} | fuso: ${d.timezone_name ?? "—"} (id ${d.timezone_id ?? "—"}) | moeda: ${d.currency ?? "—"}`);
    } else {
      console.log(`  ERRO ao buscar info da conta: ${report.accountInfo.error}`);
    }

    console.log(`\n-- Atribuição por conjunto de anúncios --`);
    if (report.adSetsAttribution.ok && report.adSetsAttribution.data) {
      if (report.adSetsAttribution.data.length === 0) {
        console.log(`  nenhum conjunto retornado`);
      } else {
        for (const as of report.adSetsAttribution.data.slice(0, 10)) {
          console.log(`  "${as.name}" (${as.status}) — optimization_goal: ${as.optimization_goal ?? "—"} | attribution_spec: ${JSON.stringify(as.attribution_spec) ?? "campo não retornado"}`);
        }
        if (report.adSetsAttribution.data.length > 10) console.log(`  ... e mais ${report.adSetsAttribution.data.length - 10} conjunto(s)`);
      }
    } else {
      console.log(`  ERRO/indisponível: ${report.adSetsAttribution.error}`);
    }

    console.log(`\n-- Cenários de Insights (mesma janela de datas, só o parâmetro de atribuição muda) --`);
    printScenarioTable(report.scenarios);

    console.log(`\n-- Comparação com o que já está gravado no banco da MITZA --`);
    if (report.storedComparison.available) {
      console.log(`  import_source_id: ${report.storedComparison.importSourceId}`);
      console.log(`  spend gravado (daily_spend, soma do período): ${report.storedComparison.storedSpendSum?.toFixed(2)}`);
      console.log(`  campanhas distintas gravadas no período: ${report.storedComparison.storedCampaignCount}`);
    } else {
      console.log(`  não disponível: ${report.storedComparison.reason}`);
    }
  }

  mkdirSync(join(__dirname, "audit-output"), { recursive: true });
  const outPath = join(__dirname, "audit-output", `meta-attribution-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify({ since, until, graphApiVersion: META_GRAPH_API_VERSION, generatedAt: new Date().toISOString(), reports }, null, 2));

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Relatório completo salvo em: ${outPath}`);
  console.log(`Lembrete: a conferência com o Gerenciador de Anúncios é uma etapa MANUAL separada — este script não a substitui.`);
}

main().catch((err) => {
  console.error(`\nFalha na auditoria: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
