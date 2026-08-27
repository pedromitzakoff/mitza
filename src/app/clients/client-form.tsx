"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import type { Database } from "@/lib/supabase/database.types";
import { CONTRACTED_SERVICE_OPTIONS } from "@/lib/client-fields";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { formatCnpj } from "@/lib/cnpj";
import { PERFORMANCE_GOAL_OPTIONS, PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings/settings-shell";
import { SubmitButton } from "@/app/submit-button";

type Manager = { id: string; name: string };
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

const inputClasses = "rounded-md border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-zinc-500";
const labelClasses = "flex flex-col gap-1 text-sm text-foreground";

/**
 * MITZA 2.0 — Refinamento do Cadastro do Cliente: esta tela é o cadastro
 * administrativo, não o prontuário (uso diário fica em /clients/[id]).
 * Por isso os 4 blocos abaixo (Identidade, Configurações Operacionais,
 * Integrações, Administração) não são mais accordions colapsáveis — a
 * ideia é uma leitura leve e contínua, sem "sensação de configuração
 * técnica". `Subgroup` só existe pra dar um rótulo discreto a conjuntos de
 * campos dentro de Configurações Operacionais, que reúne o que antes eram
 * 5 seções separadas.
 */
export function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Subgroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function ClientForm({
  action,
  managers,
  assignedIds,
  error,
  defaultName,
  defaultMetaAdAccountId,
  defaults,
  submitLabel,
  submitPendingLabel = "Salvando...",
  cancelHref,
}: {
  action: (formData: FormData) => void | Promise<void>;
  managers: Manager[];
  assignedIds: string[];
  error?: string;
  defaultName?: string;
  defaultMetaAdAccountId?: string;
  /** Campos estruturais (Etapa 27) — todos opcionais, `undefined` numa
   * criação nova. */
  defaults?: Partial<ClientRow>;
  submitLabel: string;
  /** Etapa "Padronização Global de Feedback" — texto mostrado durante o
   * envio (`SubmitButton`). Padrão cobre o caso comum ("Salvar" →
   * "Salvando..."); `/clients/new` passa "Criando..." pra combinar com
   * "Criar cliente". */
  submitPendingLabel?: string;
  cancelHref: string;
}) {
  const assigned = new Set(assignedIds);
  const contractedServices = new Set(defaults?.contracted_services ?? []);
  // Etapa "Canais Ativos por Cliente": cliente novo (`defaults === undefined`)
  // nasce com "Meta Ads" pré-marcado — `meta_ad_account_id` já é obrigatório
  // na criação, então na prática todo cliente novo tem Meta configurado; o
  // gestor pode desmarcar se este for excepcionalmente um caso só-Google.
  const mediaChannels = new Set(defaults?.media_channels ?? (defaults === undefined ? ["meta"] : []));
  const [dirty, setDirty] = useState(false);
  // MITZA 2.0 — Refinamento da Identidade do Cliente: preview local do
  // arquivo escolhido (nunca enviado ao servidor até o submit) — `null`
  // até o usuário escolher uma nova foto, caso em que mostra a foto já
  // salva (`defaults?.avatar_url`) ou as iniciais (`ClientAvatar`).
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // `defaults` só é `undefined` na criação de um cliente novo (ver
  // src/app/clients/new/page.tsx vs. .../[id]/edit/page.tsx) — objetivo de
  // performance é obrigatório apenas nesse caso; clientes já existentes
  // continuam podendo ficar sem objetivo configurado (Etapa 71, seção 2).
  const isNewClient = defaults === undefined;
  const [performanceGoal, setPerformanceGoal] = useState<PerformanceGoal | "">(
    (defaults?.performance_goal as PerformanceGoal | null) ?? "",
  );
  const costMetricLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].costMetricLabel : "custo por resultado";

  // Confirmação "simples" antes de sair (só fecha aba/recarrega — o App
  // Router navega sem descarregar a página, então isso não cobre clique em
  // outro link/menu, só o caso realmente simples de fechar/recarregar).
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="mt-6 flex flex-col gap-6"
    >
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Block title="Identidade" description="O que representa este cliente visualmente e quem cuida dele.">
        <div className="flex items-center gap-4">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
          ) : (
            <ClientAvatar name={defaultName || "Cliente"} imageUrl={defaults?.avatar_url ?? null} size="lg" />
          )}
          <div className="flex flex-col gap-1">
            <input
              type="file"
              name="photo"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setPhotoPreview(file ? URL.createObjectURL(file) : null);
              }}
              className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:hover:file:bg-zinc-700"
            />
            <span className="text-xs text-muted-foreground">Sem foto, mostramos as iniciais do cliente.</span>
          </div>
        </div>

        <label className={labelClasses}>
          Nome <span className="text-red-500">*</span>
          <input name="name" required defaultValue={defaultName} className={inputClasses} />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Empresa (razão social) <span className="text-xs text-muted-foreground">(opcional)</span>
            <input name="legal_name" defaultValue={defaults?.legal_name ?? ""} className={inputClasses} />
          </label>

          <label className={labelClasses}>
            CNPJ <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              name="cnpj"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              defaultValue={defaults?.cnpj ? formatCnpj(defaults.cnpj) : ""}
              onChange={(event) => {
                event.target.value = formatCnpj(event.target.value);
              }}
              className={`${inputClasses} font-mono`}
            />
          </label>
        </div>

        <label className={labelClasses}>
          Gestor principal <span className="text-xs text-muted-foreground">(opcional)</span>
          <select
            name="primary_manager_id"
            defaultValue={defaults?.primary_manager_id ?? ""}
            className={inputClasses}
          >
            <option value="">Sem gestor principal</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-foreground">Gestores de apoio</legend>
          {managers.length === 0 && (
            <EmptyState>
              Nenhum membro da equipe cadastrado ainda (cadastre em Equipe).
            </EmptyState>
          )}
          {managers.map((manager) => (
            <label key={manager.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="manager_ids"
                value={manager.id}
                defaultChecked={assigned.has(manager.id)}
                className="h-4 w-4 rounded border-border"
              />
              {manager.name}
            </label>
          ))}
        </fieldset>
      </Block>

      <Block title="Configurações Operacionais" description="Como o MITZA trabalha com este cliente no dia a dia.">
        <Subgroup label="Mídia">
          <label className={labelClasses}>
            Conta de anúncios (Meta) <span className="text-red-500">*</span>
            <input
              name="meta_ad_account_id"
              required
              placeholder="act_1234567890"
              pattern="act_[0-9]+"
              title="Formato: act_ seguido de números"
              defaultValue={defaultMetaAdAccountId}
              className={`${inputClasses} font-mono`}
            />
          </label>
          <label className={labelClasses}>
            Nome da conta de anúncios <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              name="meta_ad_account_name"
              defaultValue={defaults?.meta_ad_account_name ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Objetivo principal
            <select name="main_objective" defaultValue={defaults?.main_objective ?? ""} className={inputClasses}>
              <option value="">Sem objetivo definido</option>
              <option value="leads">Leads</option>
              <option value="vendas">Vendas</option>
              <option value="reservas">Reservas</option>
              <option value="reconhecimento">Reconhecimento</option>
              <option value="trafego">Tráfego</option>
              <option value="outro">Outro</option>
            </select>
          </label>
          <label className={labelClasses}>
            Investimento mensal planejado (referência)
            <input
              type="number"
              step="0.01"
              min="0"
              name="monthly_planned_spend"
              defaultValue={defaults?.monthly_planned_spend ?? ""}
              className={inputClasses}
            />
            <span className="text-xs text-muted-foreground">
              Valor de referência do cliente — não altera o planejado das sprints.
            </span>
          </label>
          <label className={labelClasses}>
            Região de atuação
            <input name="operation_region" defaultValue={defaults?.operation_region ?? ""} className={inputClasses} />
          </label>
        </Subgroup>

        {/* Etapa "Canais Ativos por Cliente": fonte única de verdade de "em
            quais plataformas este cliente investe" (`clients.media_channels`)
            — controla diretamente as opções do seletor de canal na Visão
            Geral (`VisaoGeralChannelSwitch`, via `resolveClientChannelScopeOptions`,
            lib/traffic-channels.ts). Nunca chamado "Redes sociais" (Google
            Ads não é uma rede social). Mesmo padrão de checkbox de array já
            usado em "Serviços contratados" logo abaixo — `formData.getAll`
            no Server Action, nunca um segundo mecanismo de leitura. Pelo
            menos 1 canal é obrigatório (validado na Server Action): sem
            nenhum canal ativo não haveria o que mostrar na Visão Geral. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Canais de mídia</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AVAILABLE_TRAFFIC_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="media_channels"
                  value={channel}
                  defaultChecked={mediaChannels.has(channel)}
                  className="h-4 w-4 rounded border-border"
                />
                {TRAFFIC_CHANNELS[channel].label}
              </label>
            ))}
          </div>
        </fieldset>

        <Subgroup label="Performance">
          <label className={labelClasses}>
            Objetivo principal de performance {isNewClient && <span className="text-red-500">*</span>}
            <select
              name="performance_goal"
              required={isNewClient}
              value={performanceGoal}
              onChange={(event) => setPerformanceGoal(event.target.value as PerformanceGoal | "")}
              className={inputClasses}
            >
              <option value="" disabled={isNewClient}>
                {isNewClient ? "Selecione um objetivo" : "Não configurado"}
              </option>
              {PERFORMANCE_GOAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Define se os resultados desta conta são acompanhados como leads, vendas ou seguidores.
            </span>
          </label>
          <label className={labelClasses}>
            Meta padrão de {costMetricLabel.toLowerCase()} <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              name="target_cost_per_result"
              defaultValue={defaults?.target_cost_per_result ?? ""}
              className={inputClasses}
            />
            {/* Etapa "Clarificar meta padrão" (Auditoria de Settings, item 3):
                a meta vigente de verdade vem do Planejamento por Canal
                (mês a mês, na própria página do cliente — `channel-plan-editor.tsx`);
                este campo é só o fallback quando nenhum canal tem meta
                definida ainda (`resolveClientMonthlyPlan`, lib/client-plan.ts,
                nunca alterado aqui — só o texto ficou explícito). */}
            <span className="text-xs text-muted-foreground">
              Usada quando não houver uma meta definida no planejamento mensal por canal.
            </span>
          </label>
          <label className={labelClasses}>
            KPI principal
            <input name="primary_kpi" defaultValue={defaults?.primary_kpi ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            Meta do KPI principal
            <input
              name="primary_kpi_target"
              defaultValue={defaults?.primary_kpi_target ?? ""}
              className={inputClasses}
            />
          </label>
        </Subgroup>

        <Subgroup label="Contrato">
          <label className={labelClasses}>
            Início de contrato <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              type="date"
              name="contract_start_date"
              defaultValue={defaults?.contract_start_date ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Fim de contrato <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              type="date"
              name="contract_end_date"
              defaultValue={defaults?.contract_end_date ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Próxima renovação <span className="text-xs text-muted-foreground">(opcional)</span>
            <input
              type="date"
              name="renewal_date"
              defaultValue={defaults?.renewal_date ?? ""}
              className={inputClasses}
            />
          </label>
        </Subgroup>

        <Subgroup label="Contatos">
          <label className={labelClasses}>
            Contato principal — nome
            <input name="main_contact_name" defaultValue={defaults?.main_contact_name ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            Contato principal — cargo
            <input name="main_contact_role" defaultValue={defaults?.main_contact_role ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            Contato principal — e-mail
            <input
              type="email"
              name="main_contact_email"
              defaultValue={defaults?.main_contact_email ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Contato principal — telefone
            <input
              type="tel"
              name="main_contact_phone"
              defaultValue={defaults?.main_contact_phone ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Contato financeiro — nome
            <input
              name="financial_contact_name"
              defaultValue={defaults?.financial_contact_name ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Contato financeiro — e-mail
            <input
              type="email"
              name="financial_contact_email"
              defaultValue={defaults?.financial_contact_email ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Contato financeiro — telefone
            <input
              type="tel"
              name="financial_contact_phone"
              defaultValue={defaults?.financial_contact_phone ?? ""}
              className={inputClasses}
            />
          </label>
        </Subgroup>

        <Subgroup label="Comercial">
          <label className={labelClasses}>
            Valor mensal da agência
            <input
              type="number"
              step="0.01"
              min="0"
              name="agency_monthly_fee"
              defaultValue={defaults?.agency_monthly_fee ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Dia de vencimento
            <input
              type="number"
              min="1"
              max="31"
              name="billing_due_day"
              defaultValue={defaults?.billing_due_day ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Prazo de aviso prévio (dias)
            <input
              type="number"
              min="0"
              name="notice_period_days"
              defaultValue={defaults?.notice_period_days ?? ""}
              className={inputClasses}
            />
          </label>
        </Subgroup>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Serviços contratados</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONTRACTED_SERVICE_OPTIONS.map((service) => (
              <label key={service} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="contracted_services"
                  value={service}
                  defaultChecked={contractedServices.has(service)}
                  className="h-4 w-4 rounded border-border"
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>

        <Subgroup label="Contexto estratégico">
          <label className={labelClasses}>
            Produto ou serviço principal
            <input
              name="main_product_or_service"
              defaultValue={defaults?.main_product_or_service ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Público-alvo principal
            <textarea
              name="primary_audience"
              rows={2}
              defaultValue={defaults?.primary_audience ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Diferenciais do cliente
            <textarea
              name="client_differentials"
              rows={2}
              defaultValue={defaults?.client_differentials ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Restrições do cliente
            <textarea
              name="client_restrictions"
              rows={2}
              defaultValue={defaults?.client_restrictions ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Datas sazonais importantes
            <textarea
              name="important_seasonal_dates"
              rows={2}
              placeholder="Ex.: Black Friday, Dia das Mães, alta temporada em dezembro..."
              defaultValue={defaults?.important_seasonal_dates ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Resumo operacional
            <textarea
              name="operational_summary"
              rows={2}
              placeholder="Ex.: Captação de leads para franquias. Prioridade em Campinas e região."
              defaultValue={defaults?.operational_summary ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Observações importantes
            <textarea
              name="important_notes"
              rows={2}
              defaultValue={defaults?.important_notes ?? ""}
              className={inputClasses}
            />
          </label>
        </Subgroup>
      </Block>

      <Block title="Integrações" description="Links externos usados no dia a dia deste cliente.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Link do Dashboard (Looker Studio)
            <input
              type="url"
              name="dashboard_url"
              placeholder="https://lookerstudio.google.com/..."
              defaultValue={defaults?.dashboard_url ?? ""}
              className={inputClasses}
            />
            <span className="text-xs text-muted-foreground">Usado só pelo atalho &ldquo;Dashboard&rdquo; no prontuário do cliente.</span>
          </label>
          <label className={labelClasses}>
            Link da página de Saldo
            <input
              type="url"
              name="balance_url"
              placeholder="https://..."
              defaultValue={defaults?.balance_url ?? ""}
              className={inputClasses}
            />
            <span className="text-xs text-muted-foreground">Usado só pelo atalho &ldquo;Saldo&rdquo; no prontuário do cliente.</span>
          </label>
          <label className={labelClasses}>
            Planilha de fechamento mensal
            <input
              type="url"
              name="monthly_closing_sheet_url"
              placeholder="https://docs.google.com/spreadsheets/..."
              defaultValue={defaults?.monthly_closing_sheet_url ?? ""}
              className={inputClasses}
            />
            <span className="text-xs text-muted-foreground">Usado só pelo atalho &ldquo;Abrir fechamento mensal&rdquo; no prontuário do cliente.</span>
          </label>
          <label className={labelClasses}>
            Instagram
            <input
              type="url"
              name="instagram_url"
              placeholder="https://instagram.com/..."
              defaultValue={defaults?.instagram_url ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Site
            <input
              type="url"
              name="website_url"
              placeholder="https://..."
              defaultValue={defaults?.website_url ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Facebook
            <input
              type="url"
              name="facebook_url"
              placeholder="https://facebook.com/..."
              defaultValue={defaults?.facebook_url ?? ""}
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            WhatsApp comercial
            <input
              type="tel"
              name="commercial_whatsapp"
              defaultValue={defaults?.commercial_whatsapp ?? ""}
              className={inputClasses}
            />
          </label>
        </div>
      </Block>

      <Block title="Administração" description="Situação contratual do cliente dentro do MITZA.">
        <label className={labelClasses}>
          Status contratual
          <select name="status" defaultValue={defaults?.status ?? "ativo"} className={inputClasses}>
            <option value="ativo">Ativo</option>
            <option value="pausado">Pausado</option>
            <option value="encerrado">Encerrado</option>
          </select>
        </label>
      </Block>

      <div className="flex items-center gap-3">
        <SubmitButton
          pendingChildren={submitPendingLabel}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {submitLabel}
        </SubmitButton>
        <Link href={cancelHref} className={`px-4 py-2 text-sm ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}>
          Cancelar
        </Link>
        <span className="text-xs text-muted-foreground">
          <span className="text-red-500">*</span> campos obrigatórios
        </span>
      </div>
    </form>
  );
}
