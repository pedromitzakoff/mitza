"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchReportMetricsAction, markClientReportSentAction, saveClientReportAction } from "./client-report-actions";
import { buildClientReportText, createCustomMetric, type ClientReportMetric, type ClientReportStatus } from "@/lib/client-reports";
import { formatShortDateFromInstant } from "@/lib/format";

/**
 * O módulo de 5 etapas (Período → Buscar métricas → Revisão → Observações →
 * Pré-visualização) descrito no pedido — serve os dois modos com o mesmo
 * componente: `reportId` ausente = novo report (etapa 1 começa vazia,
 * "Buscar métricas" precisa rodar antes de liberar as próximas etapas);
 * presente = reabertura de um já salvo (todas as etapas liberadas de
 * cara, entra direto na Pré-visualização — "reports permanecem editáveis
 * pra sempre", decisão explícita do usuário).
 *
 * `initialPeriodStart`/`initialPeriodEnd`, quando o wizard é aberto a
 * partir do drawer da recorrência "Reportar cliente", são só um
 * PREENCHIMENTO INICIAL do formulário — nunca um vínculo com sprint. O
 * gestor pode trocar as datas livremente pra qualquer intervalo, sem
 * exigir que coincidam com uma sprint existente; nada aqui grava
 * `sprint_id` em lugar nenhum.
 */
const STEPS = [
  { key: "periodo", label: "Período" },
  { key: "metricas", label: "Buscar métricas" },
  { key: "revisao", label: "Revisão" },
  { key: "observacoes", label: "Observações" },
  { key: "preview", label: "Pré-visualização" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export interface ClientReportWizardProps {
  clientId: string;
  clientName: string;
  closeHref: string;
  /** Presente = reabertura de um report existente. */
  reportId?: string | null;
  initialPeriodStart: string;
  initialPeriodEnd: string;
  initialMetrics?: ClientReportMetric[];
  initialObservations?: string | null;
  initialStatus?: ClientReportStatus;
  initialSentAt?: string | null;
  initialSentByName?: string | null;
  /** Presente só quando o wizard foi aberto a partir do drawer da
   * recorrência "Reportar cliente" — usado só no momento de "Marcar como
   * enviado" (ver `markClientReportSentAction`), nunca ao salvar rascunho. */
  recurringTaskId?: string | null;
}

export function ClientReportWizard({
  clientId,
  clientName,
  closeHref,
  reportId = null,
  initialPeriodStart,
  initialPeriodEnd,
  initialMetrics,
  initialObservations = null,
  initialStatus = "draft",
  initialSentAt = null,
  initialSentByName = null,
  recurringTaskId = null,
}: ClientReportWizardProps) {
  const isEdit = Boolean(reportId);
  const router = useRouter();

  const [savedReportId, setSavedReportId] = useState<string | null>(reportId);
  const [step, setStep] = useState<StepKey>(isEdit ? "preview" : "periodo");
  const [periodStart, setPeriodStart] = useState(initialPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriodEnd);
  const [metrics, setMetrics] = useState<ClientReportMetric[]>(initialMetrics ?? []);
  const [hasFetchedMetrics, setHasFetchedMetrics] = useState(Boolean(initialMetrics));
  const [observations, setObservations] = useState(initialObservations ?? "");
  const [status, setStatus] = useState<ClientReportStatus>(initialStatus);
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [sentByName, setSentByName] = useState(initialSentByName);
  const [error, setError] = useState<string | null>(null);
  const [draftSavedMessage, setDraftSavedMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const periodValid = periodStart !== "" && periodEnd !== "" && periodEnd >= periodStart;

  function goTo(key: StepKey) {
    setError(null);
    setStep(key);
  }

  function fetchMetrics() {
    setError(null);
    startTransition(async () => {
      const result = await fetchReportMetricsAction(clientId, periodStart, periodEnd);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMetrics(result.metrics);
      setHasFetchedMetrics(true);
      setStep("revisao");
    });
  }

  function handleStartMetrics() {
    setStep("metricas");
    fetchMetrics();
  }

  function updateMetric(key: string, patch: Partial<ClientReportMetric>) {
    setMetrics((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeMetric(key: string) {
    setMetrics((rows) => rows.filter((row) => row.key !== key));
  }

  function addMetric() {
    setMetrics((rows) => [...rows, createCustomMetric()]);
  }

  const finalTextPreview = useMemo(
    () => buildClientReportText({ clientName, periodStart, periodEnd, metrics, observations }),
    [clientName, periodStart, periodEnd, metrics, observations],
  );

  function handleSaveDraft() {
    setError(null);
    setDraftSavedMessage(null);
    startTransition(async () => {
      const result = await saveClientReportAction({
        reportId: savedReportId,
        clientId,
        periodStart,
        periodEnd,
        metrics,
        observations: observations.trim() || null,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar o report.");
        return;
      }
      // Guarda o id assim que o report existe — a próxima chamada (rascunho
      // de novo, ou "Marcar como enviado") atualiza em vez de criar um
      // segundo registro.
      if (result.reportId) setSavedReportId(result.reportId);
      setDraftSavedMessage(status === "sent" ? "Alterações salvas." : "Rascunho salvo.");
    });
  }

  function handleMarkSent() {
    if (!savedReportId) return;
    setError(null);
    setDraftSavedMessage(null);
    startTransition(async () => {
      const result = await markClientReportSentAction({ reportId: savedReportId, clientId, recurringTaskId });
      if (!result.ok) {
        setError(result.error ?? "Não foi possível marcar o report como enviado.");
        return;
      }
      setStatus("sent");
      if (result.sentAt) setSentAt(result.sentAt);
      if (result.sentByName) setSentByName(result.sentByName);

      if (result.error) {
        // Marcado como enviado, mas a execução da recorrência não foi
        // registrada — mantém o painel aberto com o aviso em vez de
        // navegar embora, pra o gestor decidir o que fazer.
        setError(result.error);
        return;
      }

      router.push(closeHref);
      router.refresh();
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(finalTextPreview);
    } catch {
      // Clipboard indisponível (ex.: contexto não seguro) — falha
      // silenciosa, o texto continua visível na pré-visualização pra
      // copiar manualmente. Copiar NUNCA marca como enviado sozinho.
    }
  }

  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{isEdit ? "Editar report" : "Gerar novo report"}</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Passo {stepIndex + 1} de {STEPS.length}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
          {STEPS.map((s, index) => (
            <button
              key={s.key}
              type="button"
              onClick={() => goTo(s.key)}
              disabled={index > 0 && !hasFetchedMetrics}
              className={`mitza-pressable rounded-full px-2.5 py-1 font-medium ${
                s.key === step
                  ? "bg-brand text-white"
                  : "border border-border text-muted-foreground hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900"
              }`}
            >
              {index + 1}. {s.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
        )}
        {draftSavedMessage && !error && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            {draftSavedMessage}
          </p>
        )}

        <div className="mt-4 flex flex-1 flex-col gap-4">
          {step === "periodo" && (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Selecione o período que este report vai cobrir — qualquer intervalo, sem precisar coincidir com uma sprint.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Início
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Fim
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </div>
              {!periodValid && periodStart && periodEnd && (
                <p className="text-xs text-red-600 dark:text-red-400">O fim do período precisa ser igual ou depois do início.</p>
              )}
              <button
                type="button"
                onClick={handleStartMetrics}
                disabled={!periodValid}
                className="mitza-pressable self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buscar métricas
              </button>
            </section>
          )}

          {step === "metricas" && (
            <section className="flex flex-1 items-center justify-center">
              {isPending ? (
                <p className="text-sm text-muted-foreground">Buscando métricas do período…</p>
              ) : (
                <button type="button" onClick={fetchMetrics} className="text-sm font-medium text-brand hover:underline">
                  Buscar métricas novamente
                </button>
              )}
            </section>
          )}

          {step === "revisao" && (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Revise os valores — corrija o que estiver errado ou complete o que ainda não tem integração automática.
              </p>
              <div className="flex flex-col gap-2">
                {metrics.map((metric) => {
                  const isCustom = metric.key.startsWith("custom-");
                  return (
                    <div key={metric.key} className="flex items-center gap-2 rounded-md border border-border p-2">
                      {isCustom ? (
                        <input
                          value={metric.label}
                          onChange={(e) => updateMetric(metric.key, { label: e.target.value })}
                          placeholder="Nome da métrica"
                          className="w-1/2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                        />
                      ) : (
                        <span className="w-1/2 text-sm font-medium text-foreground">{metric.label}</span>
                      )}
                      <input
                        value={metric.value}
                        onChange={(e) => updateMetric(metric.key, { value: e.target.value })}
                        placeholder="Valor"
                        className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => removeMetric(metric.key)}
                        className="shrink-0 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                      >
                        Remover
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={addMetric} className="self-start text-xs font-medium text-brand hover:underline">
                + Adicionar métrica
              </button>
              <button
                type="button"
                onClick={() => goTo("observacoes")}
                className="mitza-pressable self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Continuar
              </button>
            </section>
          )}

          {step === "observacoes" && (
            <section className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Observações <span className="text-xs text-muted-foreground">(opcional)</span>
                <textarea
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  rows={5}
                  placeholder="Ex.: Nesta semana aumentamos o investimento nas campanhas de seguidores devido ao excelente desempenho observado..."
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </label>
              <button
                type="button"
                onClick={() => goTo("preview")}
                className="mitza-pressable self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                Ver pré-visualização
              </button>
            </section>
          )}

          {step === "preview" && (
            <section className="flex flex-col gap-3">
              <div className="rounded-md border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
                <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{finalTextPreview}</pre>
              </div>

              {status === "sent" && sentAt && (
                <p className="text-xs text-muted-foreground">
                  Enviado em {formatShortDateFromInstant(sentAt)}
                  {sentByName ? ` por ${sentByName}` : ""}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isPending}
                  className="mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900"
                >
                  {status === "sent" ? "Salvar alterações" : "Salvar rascunho"}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Copiar para WhatsApp
                </button>
                {status !== "sent" && (
                  <button
                    type="button"
                    onClick={handleMarkSent}
                    disabled={isPending || !savedReportId}
                    title={savedReportId ? undefined : "Salve o rascunho antes de marcar como enviado"}
                    className="mitza-pressable rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending ? "Enviando..." : "Marcar como enviado"}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
