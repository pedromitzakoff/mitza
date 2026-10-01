import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadDadosPageData, type DadosSourceView } from "../../dados-data";
import { WorkspaceContainer } from "../../workspace-container";
import type { DataAttention } from "@/lib/data-trust";

/**
 * `/clients/[id]/dados` — Etapa "MEGA FACELIFT — Fase 5: Dados". Primeira
 * versão funcional do módulo (a Fase 1 só validava a rota/navegação) —
 * responde "posso confiar nos dados deste cliente?", nunca "esse resultado
 * é bom?" (isso é Performance/`/relatorio`, nunca duplicado aqui: zero
 * CPA/ROAS/spend como KPI de performance nesta tela).
 *
 * Contexto GLOBAL continua o cliente (header do workspace, inalterado);
 * esta tela não tem contexto LOCAL próprio (sem mês/objetivo na URL — os
 * dados mostrados são sempre o estado ATUAL da fonte, nunca escopados a um
 * período, mesma decisão já tomada pro drawer "Informações da conta").
 */
export default async function ClientDadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const data = await loadDadosPageData(supabase, id, isAdmin);
  if (!data) notFound();

  return (
    <WorkspaceContainer>
      <div>
        <h1 className="text-lg font-semibold text-overview-text-primary">Dados</h1>
        <p className="mt-0.5 text-sm text-overview-text-secondary">Fontes e qualidade dos dados usados pelo Growth deste cliente.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <HealthStat label="Fontes ativas" value={`${data.health.activeSourceCount}/${data.health.enabledSourceCount}`} />
        <HealthStat label="Último dado recebido" value={data.health.latestImportedDateLabel ?? "Nenhum ainda"} />
        <HealthStat
          label="Atenções"
          value={String(data.health.attentionCount)}
          tone={data.health.attentionCount > 0 ? "warning" : "success"}
        />
      </div>

      {data.attentions.length > 0 && (
        <section className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Atenções</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.attentions.map((attention) => (
              <AttentionRow key={attention.id} attention={attention} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Fontes de dados</p>
        {data.isFullyManual ? (
          <div className="mt-2 rounded-lg border border-overview-border bg-overview-surface p-6">
            <p className="text-sm text-overview-text-secondary">
              Este cliente não tem nenhuma fonte automática configurada — os resultados usados em Metas e Performance vêm de lançamento manual.
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {data.sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        )}
      </section>

      {data.goals.length > 0 && (
        <section className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">Objetivos</p>
          <div className="mt-2 flex flex-col gap-2">
            {data.goals.map((goal) => (
              <div key={goal.resultType} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-overview-text-primary">
                  {goal.label}
                  {goal.isPrimary && <span className="ml-1.5 text-xs font-normal text-overview-text-muted">(principal)</span>}
                </span>
                <span className="text-sm text-overview-text-secondary">
                  {goal.resultSourceLabel}
                  {goal.automaticChannelLabels && ` · ${goal.automaticChannelLabels.join(", ")}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </WorkspaceContainer>
  );
}

function HealthStat({ label, value, tone }: { label: string; value: string; tone?: "warning" | "success" }) {
  const valueClassName = tone === "warning" ? "text-overview-warning" : tone === "success" ? "text-overview-success" : "text-overview-text-primary";
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}

function AttentionRow({ attention }: { attention: DataAttention }) {
  return <li className={`text-sm ${attention.severity === "error" ? "text-overview-danger" : "text-overview-warning"}`}>{attention.message}</li>;
}

function SourceCard({ source }: { source: DadosSourceView }) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-overview-text-primary">{source.channelLabel}</span>
          <span className="text-xs text-overview-text-muted">{source.providerLabel}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${source.statusBadgeClassName}`}>{source.statusLabel}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-overview-text-secondary">
        {source.lastImportedDateLabel && <span>{source.lastImportedDateLabel}</span>}
        {source.lastSuccessAtLabel && <span>Sincronizado {source.lastSuccessAtLabel.toLowerCase()}</span>}
      </div>

      {source.mappings.length > 0 && (
        <p className="mt-2 text-xs text-overview-text-secondary">
          Alimenta: {source.mappings.map((m) => m.goalLabel).join(", ")}
        </p>
      )}

      {source.configureHref && (
        <Link href={source.configureHref} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
          Ver configuração →
        </Link>
      )}

      {source.technical && (
        <details className="mt-3 text-xs text-overview-text-secondary [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer select-none font-medium text-overview-text-primary">Detalhes técnicos</summary>
          <div className="mt-2 flex flex-col gap-1">
            <Row label="Conta externa" value={source.externalAccountId} />
            {source.technical.tableName && <Row label="Tabela de origem" value={source.technical.tableName} />}
            {source.technical.dateColumn && <Row label="Coluna de data" value={source.technical.dateColumn} />}
            {source.technical.accountIdColumn && <Row label="Coluna de conta" value={source.technical.accountIdColumn} />}
            {source.mappings.length > 0 && (
              <div className="mt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Mapeamentos</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {source.mappings.map((mapping, index) => (
                    <li key={`${mapping.goalLabel}-${index}`}>
                      {mapping.goalLabel}: coluna &quot;{mapping.resultColumn}&quot;
                      {mapping.valueColumn && <> · receita: coluna &quot;{mapping.valueColumn}&quot;</>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {source.technical.recentRuns.length > 0 && (
              <div className="mt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Últimas sincronizações</p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {source.technical.recentRuns.map((run) => (
                    <li key={run.id} className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${run.statusBadgeClassName}`}>{run.statusLabel}</span>
                        <span>{run.startedAtLabel}</span>
                      </div>
                      {run.countsLabel && <p>{run.countsLabel}</p>}
                      {run.errorMessage && <p className="text-overview-danger">{run.errorMessage}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-overview-text-muted">{label}</span>
      <span className="font-medium text-overview-text-primary">{value}</span>
    </div>
  );
}
