"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import type { Database } from "@/lib/supabase/database.types";
import { AVAILABLE_TRAFFIC_CHANNELS, TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { PERFORMANCE_GOAL_OPTIONS, PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings/settings-shell";
import { SubmitButton } from "@/app/submit-button";

type Manager = { id: string; name: string };
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

const inputClasses =
  "rounded-md border border-overview-border bg-overview-surface px-3 py-2 text-overview-text-primary outline-none transition-colors focus:border-brand";
const labelClasses = "flex flex-col gap-1 text-sm text-overview-text-primary";

/**
 * Etapa "Simplificação do Cadastro do Cliente" — reescrita completa deste
 * formulário a partir da auditoria de uso real de todos os campos que
 * `/clients/[id]/edit` expunha (ver relatório da etapa). Regra da tela
 * agora: só informação ESTRUTURAL e relativamente permanente do cliente.
 * Planejamento mensal vive no Planejamento Mensal; performance vive nas
 * telas de performance/relatório; acompanhamento vive na Operação;
 * informação sem consumidor real (confirmado por auditoria de código, nunca
 * só "existe uma coluna") não ocupa mais espaço aqui.
 *
 * Removidos desta tela (dado/coluna preservados no banco — nenhuma
 * migration destrutiva): `legal_name`, `cnpj`, `contract_start_date`,
 * `contract_end_date`, `renewal_date`, todos os contatos (principal e
 * financeiro), `agency_monthly_fee`, `billing_due_day`,
 * `notice_period_days`, `contracted_services`, os 6 campos de "contexto
 * estratégico", `main_objective`, `monthly_planned_spend`, `primary_kpi`/
 * `primary_kpi_target`, `meta_ad_account_name`, `instagram_url`,
 * `website_url`, `facebook_url`, `commercial_whatsapp`. `cnpj`/
 * `contract_start_date`/`main_contact_email`/`agency_monthly_fee`
 * continuam editáveis em Settings > Clientes (`app/settings/clients/`) —
 * já eram o lugar canônico pra eles (coluna própria, edição inline), então
 * tirá-los daqui evita informação duplicada entre telas sem remover
 * funcionalidade nenhuma. "Gestores de apoio" (`client_managers`) saiu de
 * vez — mas não foi substituído por "só o gestor principal": Etapa
 * "Correção do Modelo de Autorização — Acesso Amplo Interno" define que
 * qualquer usuário interno autorizado da KOFF (admin ou gestor) tem acesso
 * de gestão a qualquer cliente, responsável ou não por ele (ver
 * `lib/auth.ts`, `requireClientManagerAccess`). `primary_manager_id`
 * (campo "Gestor principal" abaixo) continua existindo — só não concede
 * nem restringe mais acesso.
 *
 * `readStructuralFields`/`createClientAction`/`updateClientAction`
 * (`../actions.ts`) foram reduzidos junto — nenhum campo removido daqui
 * continua sendo lido/reescrito nas Server Actions, senão cada salvamento
 * apagaria silenciosamente o dado antigo dessas colunas.
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
    <section className="flex flex-col gap-6 rounded-lg border border-overview-border bg-overview-surface p-6">
      <div>
        <h2 className="text-base font-semibold text-overview-text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-overview-text-secondary">{description}</p>}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function ClientForm({
  action,
  managers,
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
  error?: string;
  defaultName?: string;
  defaultMetaAdAccountId?: string | null;
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
  // Etapa "Canais Ativos por Cliente": cliente novo (`defaults === undefined`)
  // nasce com "Meta Ads" pré-marcado — o gestor pode desmarcar se este for
  // excepcionalmente um caso só-Google.
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

  // Etapa "Simplificação do Cadastro do Cliente": conta Meta deixou de ser
  // obrigatória pra todo cliente — só faz sentido continuar exigida
  // enquanto "Meta Ads" estiver marcado em Canais de mídia (validado de
  // verdade no servidor, `validateMetaAccountRequirement`, ../actions.ts;
  // este estado só decide o `*`/texto de ajuda em tela, nunca é a fonte da
  // regra).
  const [metaChannelChecked, setMetaChannelChecked] = useState(mediaChannels.has("meta"));

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
        <p className="rounded-md bg-overview-danger-subtle px-3 py-2 text-sm text-overview-danger">{error}</p>
      )}

      <Block title="Cliente" description="Identidade e responsabilidade — o que não muda todo mês.">
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
              className="text-sm text-overview-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-overview-surface-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-overview-text-primary hover:file:bg-overview-surface-hover"
            />
            <span className="text-xs text-overview-text-secondary">Sem foto, mostramos as iniciais do cliente.</span>
          </div>
        </div>

        <label className={labelClasses}>
          Nome <span className="text-overview-danger">*</span>
          <input name="name" required defaultValue={defaultName} className={inputClasses} />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Status contratual
            <select name="status" defaultValue={defaults?.status ?? "ativo"} className={inputClasses}>
              <option value="ativo">Ativo</option>
              <option value="pausado">Pausado</option>
              <option value="encerrado">Encerrado</option>
            </select>
          </label>

          <label className={labelClasses}>
            Gestor principal <span className="text-xs text-overview-text-secondary">(opcional)</span>
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
        </div>

        {/* Etapa "Simplificação do Cadastro do Cliente": CNPJ, início de
            contrato, e-mail principal e mensalidade saíram desta tela —
            Settings > Clientes já é o lugar canônico deles (coluna própria,
            edição inline direto na tabela), manter os dois lugares editando
            o mesmo dado duplicaria informação sem necessidade. */}
        <p className="text-xs text-overview-text-secondary">
          CNPJ, início de contrato, e-mail principal e mensalidade da agência são editados em{" "}
          <Link href="/settings/clients" className="underline hover:text-overview-text-primary">
            Configurações → Clientes
          </Link>
          .
        </p>
      </Block>

      <Block title="Mídia" description="Canais que este cliente opera e como medimos o resultado.">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-overview-text-secondary">
            Canais de mídia <span className="text-overview-danger">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AVAILABLE_TRAFFIC_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm text-overview-text-primary">
                <input
                  type="checkbox"
                  name="media_channels"
                  value={channel}
                  defaultChecked={mediaChannels.has(channel)}
                  onChange={(event) => {
                    if (channel === "meta") setMetaChannelChecked(event.target.checked);
                  }}
                  className="h-4 w-4 rounded border-overview-border"
                />
                {TRAFFIC_CHANNELS[channel].label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={labelClasses}>
          Conta de anúncios (Meta) {metaChannelChecked && <span className="text-overview-danger">*</span>}
          <input
            name="meta_ad_account_id"
            placeholder="act_1234567890"
            pattern="act_[0-9]+"
            title="Formato: act_ seguido de números"
            defaultValue={defaultMetaAdAccountId ?? ""}
            className={`${inputClasses} font-mono`}
          />
          <span className="text-xs text-overview-text-secondary">
            {metaChannelChecked
              ? "Obrigatória enquanto Meta Ads estiver marcado acima."
              : "Só necessária se Meta Ads estiver marcado acima — cliente Google-only pode deixar em branco."}
          </span>
        </label>

        <label className={labelClasses}>
          Objetivo principal de performance {isNewClient && <span className="text-overview-danger">*</span>}
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
          <span className="text-xs text-overview-text-secondary">
            Define se os resultados desta conta são acompanhados como leads, vendas ou seguidores.
          </span>
        </label>

        {/* Configuração avançada/fallback — mesmo padrão visual de
            <details>/<summary> já usado em `client-goals-section.tsx`
            ("Configuração avançada" de um objetivo). `target_cost_per_result`
            não pode sair (auditoria confirmou: é o último elo da cadeia de
            fallback canal → consolidado → este campo, `resolveTargetCostPerResult`,
            lib/client-plan.ts — regra intocada), só perde peso visual: quem
            já configurou meta por canal no Planejamento Mensal raramente
            precisa abrir isto. */}
        <details className="rounded-md border border-overview-border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-overview-text-secondary">
            Configuração avançada
          </summary>
          <div className="mt-3 flex flex-col gap-1">
            <label className={labelClasses}>
              Meta padrão de {costMetricLabel.toLowerCase()} <span className="text-xs text-overview-text-secondary">(opcional)</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="target_cost_per_result"
                defaultValue={defaults?.target_cost_per_result ?? ""}
                className={`${inputClasses} max-w-xs`}
              />
            </label>
            <span className="text-xs text-overview-text-secondary">
              Fallback usado só quando nenhum canal tem meta própria no Planejamento Mensal — nunca a meta vigente
              de verdade (essa é sempre definida mês a mês, por canal, na própria página do cliente).
            </span>
          </div>
        </details>
      </Block>

      <Block title="Links" description="Atalhos usados no dia a dia deste cliente.">
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
          </label>
        </div>
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
        <span className="text-xs text-overview-text-secondary">
          <span className="text-overview-danger">*</span> campos obrigatórios
        </span>
      </div>
    </form>
  );
}
