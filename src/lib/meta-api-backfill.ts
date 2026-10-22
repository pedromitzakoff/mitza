import { fetchMetaApiInsightsForAccount } from "@/lib/meta-api-fetch";
import { ingestMetaApiPayload, type MetaApiIngestOutcome } from "@/lib/meta-api-ingest-run";

/**
 * Backfill histórico administrativo (ponto 3 do pedido de migração) — pedido
 * explícito do usuário: "Implemente um mecanismo administrativo e
 * controlado... Não execute backfill real sem minha autorização." Este
 * arquivo é só o MECANISMO (nunca disparado por nenhum cron/script deste
 * repositório) — quem decide rodar é sempre uma ação explícita do admin na
 * tela (`/settings/meta-connections` -> conectar cliente -> seção
 * "Backfill histórico").
 *
 * Reaproveita INTEGRALMENTE o mesmo par fetch+ingest do sync normal
 * (`fetchMetaApiInsightsForAccount`/`ingestMetaApiPayload`) — nenhuma
 * segunda implementação de busca/gravação. Isso garante de graça 3 dos
 * requisitos pedidos:
 *  - "upsert idempotente": é o MESMO upsert por chave natural que o sync de
 *    3 dias já usa — rodar o mesmo lote duas vezes nunca duplica linha.
 *  - "sem sobrescrever dados de outros clientes": `ingestMetaApiPayload`
 *    resolve `client_id` SEMPRE a partir do `accountId` via `import_sources`
 *    — o backfill nunca recebe nem usa um `client_id` diretamente, só o
 *    `accountId` de UMA conta já registrada (nunca uma conta arbitrária).
 *  - "proteção contra execuções duplicadas": `ingestMetaApiPayload` já
 *    recusa (`concurrent_run`) uma nova execução enquanto uma
 *    `data_sync_runs` da MESMA fonte estiver `running` — o orquestrador
 *    abaixo trata esse outcome como sinal pra PARAR o backfill inteiro
 *    (nunca empilhar mais lotes por cima de uma sincronização já em
 *    andamento pra mesma conta, seja ela outro backfill ou o cron de 5 min).
 */

/** Tamanho de cada lote — grande o bastante pra não multiplicar
 * desnecessariamente o número de chamadas à Graph API (o requisito "respeito
 * aos limites da Graph API" é sobre NÚMERO de requisições, não só
 * volume por requisição), pequeno o bastante pra cada lote terminar dentro
 * de um tempo razoável e o progresso ficar visível por lote, nunca só no
 * final de um backfill de anos. */
export const BACKFILL_BATCH_DAYS = 30;

/** Teto de segurança — nenhum admin deveria conseguir disparar, por engano,
 * um backfill de décadas numa única execução. Contas reais da MITZA nunca
 * têm histórico anterior a isso. */
export const BACKFILL_MAX_TOTAL_DAYS = 731;

/** Pausa entre lotes — nunca martelar a Graph API lote após lote sem
 * intervalo (ela tem limite de requisições por app/conta, documentado como
 * "generoso pra uso normal" no guia n8n, mas um backfill de meses faz MUITO
 * mais chamadas em sequência do que o uso normal). */
export const BACKFILL_BATCH_DELAY_MS = 500;

function parseDateUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface BackfillBatchRange {
  since: string;
  until: string;
}

export type BackfillValidation = { ok: true; batches: BackfillBatchRange[] } | { ok: false; error: string };

/**
 * Função pura — parte o intervalo pedido em lotes sequenciais de
 * `batchDays`, do mais antigo pro mais recente (histórico primeiro, pra um
 * backfill interrompido no meio já deixar o começo do período utilizável).
 * Testável sem rede/banco.
 */
export function planBackfillBatches(since: string, until: string, batchDays: number = BACKFILL_BATCH_DAYS): BackfillValidation {
  const sinceDate = parseDateUtc(since);
  const untilDate = parseDateUtc(until);

  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
    return { ok: false, error: "Datas inválidas — use o formato YYYY-MM-DD." };
  }
  if (sinceDate.getTime() > untilDate.getTime()) {
    return { ok: false, error: "A data inicial precisa ser anterior ou igual à data final." };
  }

  const totalDays = Math.round((untilDate.getTime() - sinceDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (totalDays > BACKFILL_MAX_TOTAL_DAYS) {
    return { ok: false, error: `Intervalo muito longo (${totalDays} dias) — o máximo permitido por execução é ${BACKFILL_MAX_TOTAL_DAYS} dias.` };
  }

  const batches: BackfillBatchRange[] = [];
  let cursor = sinceDate;
  while (cursor.getTime() <= untilDate.getTime()) {
    const batchUntil = addDaysUtc(cursor, batchDays - 1);
    const clampedUntil = batchUntil.getTime() > untilDate.getTime() ? untilDate : batchUntil;
    batches.push({ since: toDateString(cursor), until: toDateString(clampedUntil) });
    cursor = addDaysUtc(clampedUntil, 1);
  }

  return { ok: true, batches };
}

export interface BackfillBatchResult {
  since: string;
  until: string;
  outcome: MetaApiIngestOutcome["kind"] | "fetch_error";
  rowsRead?: number;
  errorMessage?: string;
}

export interface BackfillResult {
  accountId: string;
  totalBatches: number;
  completedBatches: number;
  stoppedEarly: boolean;
  totalRowsRead: number;
  batches: BackfillBatchResult[];
}

/**
 * Orquestra o backfill — roda os lotes em SEQUÊNCIA (nunca em paralelo: o
 * próprio guard de execução concorrente de `ingestMetaApiPayload` é por
 * fonte, então lotes paralelos da MESMA conta se bloqueariam entre si sem
 * necessidade, e paralelismo nunca ajudaria a "respeitar o limite da Graph
 * API" — é o oposto do que esse requisito pede).
 *
 * Nunca lança — cada lote que falhar (rede, Graph API, validação) entra em
 * `batches` com o erro e o loop CONTINUA pro próximo lote, EXCETO quando o
 * outcome é `concurrent_run` (outra execução real em andamento pra esta
 * conta) ou `disabled_source`/`unregistered_account` (nada a fazer até o
 * admin corrigir o cadastro) — esses três são sinais de "pare agora", nunca
 * "pule e continue", pra não mascarar o problema rodando mais 10 lotes
 * inúteis.
 *
 * `onBatchComplete` é opcional — chamado depois de CADA lote, pra quem
 * invoca (ex.: uma Server Action) poder persistir/exibir progresso
 * incremental em vez de só o resultado final. Nunca usado hoje (nenhum
 * caller real ainda liga backfill de produção), mas a assinatura já
 * contempla acompanhamento de progresso sem precisar de um retrabalho.
 */
export async function runMetaApiBackfill(
  accountId: string,
  since: string,
  until: string,
  options?: { batchDays?: number; batchDelayMs?: number; onBatchComplete?: (result: BackfillBatchResult) => void },
): Promise<{ error: string } | { result: BackfillResult }> {
  const plan = planBackfillBatches(since, until, options?.batchDays);
  if (!plan.ok) return { error: plan.error };

  const batchDelayMs = options?.batchDelayMs ?? BACKFILL_BATCH_DELAY_MS;
  const batches: BackfillBatchResult[] = [];
  let totalRowsRead = 0;
  let stoppedEarly = false;

  for (const range of plan.batches) {
    let batchResult: BackfillBatchResult;
    try {
      const rows = await fetchMetaApiInsightsForAccount(accountId, range.since, range.until);
      const outcome = await ingestMetaApiPayload({ accountId, rows });
      batchResult =
        outcome.kind === "ok"
          ? { since: range.since, until: range.until, outcome: "ok", rowsRead: outcome.result.rowsRead }
          : { since: range.since, until: range.until, outcome: outcome.kind };
    } catch (err) {
      batchResult = {
        since: range.since,
        until: range.until,
        outcome: "fetch_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    batches.push(batchResult);
    totalRowsRead += batchResult.rowsRead ?? 0;
    options?.onBatchComplete?.(batchResult);

    const shouldStop = batchResult.outcome === "concurrent_run" || batchResult.outcome === "disabled_source" || batchResult.outcome === "unregistered_account";
    if (shouldStop) {
      stoppedEarly = true;
      break;
    }

    const isLastBatch = range.until === plan.batches[plan.batches.length - 1].until;
    if (!isLastBatch && batchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  return {
    result: {
      accountId,
      totalBatches: plan.batches.length,
      completedBatches: batches.length,
      stoppedEarly,
      totalRowsRead,
      batches,
    },
  };
}
