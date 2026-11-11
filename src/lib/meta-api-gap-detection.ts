import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { DIRECT_SYNC_WINDOW_DAYS } from "@/lib/meta-api-direct-sync";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Diagnóstico de sincronização" — achado real da investigação de
 * 11/2026: um bug de schema (`campaign_daily_metrics`/`ad_set_daily_metrics`/
 * `ad_creative_daily_metrics` sem a coluna `link_clicks`, corrigida em
 * `supabase/meta-ads-link-clicks.sql`) bloqueava TODA gravação de campanha/
 * conjunto/criativo — sem impedir a gravação de investimento/resultado
 * agregado (`daily_spend`/`performance_records`, tabelas diferentes, nunca
 * tocadas pelo mesmo payload). Resultado: contas com investimento real
 * registrado, mas ZERO linha de campanha no mesmo dia.
 *
 * Ferramenta PERMANENTE (não um script de uso único pra este incidente) —
 * qualquer futura falha de gravação de campanha (nova coluna faltando,
 * fonte com erro silencioso, etc.) produz exatamente este mesmo sintoma
 * (investimento sem campanha), e esta função encontra de novo sem precisar
 * de uma nova investigação manual. Só LÊ — nunca escreve; a correção de
 * cada gap encontrado reaproveita 100% o backfill já existente e já
 * aprovado (`runMetaApiBackfill`/`runMetaApiBackfillAction`,
 * `lib/meta-api-backfill.ts`), nunca uma segunda implementação de busca/
 * gravação.
 */
export interface CampaignDataGap {
  clientId: string;
  clientName: string;
  /** `import_sources.external_account_id` — o identificador que
   * `runMetaApiBackfill` espera, nunca `clientId` diretamente (mesma
   * disciplina do backfill manual: `client_id` é sempre resolvido de volta
   * a partir da conta, nunca recebido como parâmetro de escrita). */
  accountId: string;
  since: string;
  until: string;
  missingDayCount: number;
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

/** `date.toISOString().slice(0, 10)` — NUNCA `todayDateString(date)` aqui:
 * essa Date já representa meia-noite UTC de um dia civil específico (mesma
 * convenção de `todayUTC()`/`meta-api-backfill.ts#toDateString`), e
 * reformatá-la via `todayDateString` reconverteria pelo fuso da agência
 * (America/Sao_Paulo, UTC-3), voltando um dia errado. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Núcleo puro — achado real de produção (11/2026): pedir pro backfill
 * cobrir o gap INTEIRO de uma vez (ex.: 17 dias de uma conta grande e
 * ativa) pode estourar o limite de execução da Vercel (300s) numa única
 * requisição — o volume de campanha/conjunto/criativo da Graph API cresce
 * com o número de dias E com o tamanho da conta, não só um dos dois.
 *
 * Corta o gap detectado numa fatia de no máximo `maxSliceDays` dias,
 * SEMPRE a partir do início (`since`) — mesmo tamanho da janela que a
 * sincronização automática normal já prova ser segura pra qualquer conta,
 * rodando sozinha a cada poucos minutos sem nunca estourar tempo
 * (`DIRECT_SYNC_WINDOW_DAYS`, `meta-api-direct-sync.ts`). Cada clique em
 * "Corrigir" processa uma fatia; o diagnóstico recalcula o gap restante
 * (menor) depois — repetir o clique até o gap zerar é o fluxo esperado,
 * nunca um "falso incompleto".
 */
export function clampGapToSafeSlice(since: string, until: string, maxSliceDays: number): { since: string; until: string } {
  const sinceDate = new Date(`${since}T00:00:00Z`);
  const untilDate = new Date(`${until}T00:00:00Z`);
  const sliceEnd = new Date(sinceDate);
  sliceEnd.setUTCDate(sliceEnd.getUTCDate() + maxSliceDays - 1);
  const clampedUntilDate = sliceEnd.getTime() < untilDate.getTime() ? sliceEnd : untilDate;
  return { since, until: toDateString(clampedUntilDate) };
}

/**
 * Núcleo puro — decide a janela de datas elegível pra checagem de gap, a
 * partir de "hoje". `windowEnd` NUNCA inclui os últimos `syncWindowDays`
 * dias (ponto 1 do pedido: nunca confundir "a sincronização normal ainda
 * não processou esse dia" com "falha real de gravação") — um dia só entra
 * na checagem depois de ter saído da janela de autocorreção da
 * sincronização normal.
 */
export function resolveGapScanWindow(today: string, lookbackDays: number, syncWindowDays: number): { windowStart: string; windowEnd: string } {
  const todayDate = new Date(`${today}T00:00:00Z`);
  return {
    windowStart: toDateString(subtractDays(todayDate, lookbackDays)),
    windowEnd: toDateString(subtractDays(todayDate, syncWindowDays)),
  };
}

/**
 * Núcleo puro — dado os dias com investimento REAL (spend > 0) e os dias
 * que JÁ têm granularidade de campanha gravada, decide se há um buraco e
 * devolve o intervalo [since, until] que cobre TODOS os dias faltantes.
 *
 * Deliberadamente NÃO recorta sub-intervalos exatos (ex.: "dias 3 e 7, mas
 * não o 5") — o intervalo cheio entre o primeiro e o último dia faltante,
 * mesmo que algum dia no meio já esteja certo. Reexecutar o backfill num
 * dia que já está correto é inofensivo (mesmo upsert idempotente por chave
 * natural de sempre) — e um intervalo contínuo é muito mais simples de
 * revisar visualmente do que uma lista de datas soltas.
 */
export function detectGapRange(
  spendDates: readonly string[],
  recordedDates: ReadonlySet<string>,
): { since: string; until: string; missingDayCount: number } | null {
  const missing = spendDates.filter((date) => !recordedDates.has(date)).sort();
  if (missing.length === 0) return null;
  return { since: missing[0], until: missing[missing.length - 1], missingDayCount: missing.length };
}

/**
 * Varre toda conta Meta API direta ATIVA e aponta o gap de cada uma —
 * `lookbackDays` limita a janela de varredura (não precisa olhar anos pra
 * trás; contas reais da MITZA não têm gap antes disso, e isso mantém a
 * consulta rápida mesmo com muitos clientes). Duas leituras por conta
 * (`daily_spend`/`campaign_daily_metrics`), nunca uma junção SQL — mais
 * simples de revisar e não depende de nenhuma relação de chave estrangeira
 * nomeada em particular.
 *
 * Garantia explícita (ponto 1 do pedido): NUNCA aponta os últimos
 * `DIRECT_SYNC_WINDOW_DAYS` dias (hoje + 2 anteriores) como gap — essa é
 * exatamente a janela que a sincronização normal ainda está processando
 * (`meta-api-direct-sync.ts`; a própria Meta atribui resultado com atraso
 * nesses dias mais recentes), nunca um problema real. Um dia só vira "gap"
 * depois de ter saído dessa janela e MESMO ASSIM continuar sem campanha —
 * sinal de que a sincronização normal teve chance de se autocorrigir e não
 * conseguiu.
 */
export async function findCampaignDataGaps(supabase: Supabase, lookbackDays = 60): Promise<CampaignDataGap[]> {
  const { windowStart, windowEnd } = resolveGapScanWindow(todayDateString(), lookbackDays, DIRECT_SYNC_WINDOW_DAYS);

  const sources = await requireQuery(
    supabase.from("import_sources").select("client_id, external_account_id").eq("channel", "meta").eq("provider", "meta_api").eq("enabled", true),
    "import_sources:gap-detection",
  );
  if (sources.length === 0) return [];

  const clientIds = sources.map((s) => s.client_id);
  const clients = await requireQuery(
    supabase.from("clients").select("id, name").in("id", clientIds).is("deleted_at", null),
    "clients:gap-detection",
  );
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  // Uma conta por vez seria lento demais com muitos clientes — as consultas
  // de contas DIFERENTES não dependem umas das outras, então rodam todas em
  // paralelo (nunca em lote sequencial só por estarem num loop `for`).
  const gapsOrNull = await Promise.all(
    sources.map(async (source): Promise<CampaignDataGap | null> => {
      const clientName = clientNameById.get(source.client_id);
      if (!clientName) return null; // cliente excluído/sem nome resolvido — nunca aponta um gap pra um id que não existe mais.

      const [spendRows, campaignRows] = await Promise.all([
        requireQuery(
          supabase
            .from("daily_spend")
            .select("date")
            .eq("client_id", source.client_id)
            .eq("channel", "meta")
            .gte("date", windowStart)
            .lte("date", windowEnd)
            .gt("spend", 0),
          "daily_spend:gap-detection",
        ),
        requireQuery(
          supabase
            .from("campaign_daily_metrics")
            .select("date")
            .eq("client_id", source.client_id)
            .eq("channel", "meta")
            .gte("date", windowStart)
            .lte("date", windowEnd),
          "campaign_daily_metrics:gap-detection",
        ),
      ]);

      const gap = detectGapRange(
        spendRows.map((r) => r.date),
        new Set(campaignRows.map((r) => r.date)),
      );
      return gap ? { clientId: source.client_id, clientName, accountId: source.external_account_id, ...gap } : null;
    }),
  );

  return gapsOrNull.filter((g): g is CampaignDataGap => g !== null).sort((a, b) => b.missingDayCount - a.missingDayCount);
}
