"use client";

import { useState, useTransition } from "react";
import { REPORT_PURPOSE_OPTIONS, type ReportCampaignPurpose } from "@/lib/report-view-classification";
import type { CampaignForReportClassification } from "@/lib/report-campaign-classification-data";
import { saveReportClassificationsAction } from "./report-classification-actions";

type PendingValue = ReportCampaignPurpose | "unclassified";

const PURPOSE_SELECT_OPTIONS = [...REPORT_PURPOSE_OPTIONS, { value: "unclassified" as const, label: "Não classificada" }];

/**
 * "Classificar campanhas do Relatório" — Etapa "Separar o Relatório por
 * finalidade das campanhas". Mesmo padrão de UX de `CampaignClassificationDrawer`
 * (`client-goals-section.tsx`, Etapa "Múltiplos Objetivos"), mas gravando em
 * `campaign_report_classifications` (independente de `client_goals`, ver
 * `supabase/campaign-report-classifications.sql`) — nunca a mesma tabela.
 * Só admin (mesma regra de `requireAdmin` na Server Action) — quem chama
 * este componente já garante isso (`page.tsx`).
 */
export function ReportClassificationEntry({ clientId, campaigns }: { clientId: string; campaigns: CampaignForReportClassification[] }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="text-xs font-semibold text-[#6F6B65] underline underline-offset-2 hover:text-[#17171A]"
      >
        Classificar campanhas
      </button>
      {drawerOpen && <ReportClassificationDrawer clientId={clientId} campaigns={campaigns} onClose={() => setDrawerOpen(false)} />}
    </>
  );
}

function ReportClassificationDrawer({
  clientId,
  campaigns,
  onClose,
}: {
  clientId: string;
  campaigns: CampaignForReportClassification[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unclassified">("all");
  const [pending, setPending] = useState<Map<string, PendingValue>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  function currentValue(campaign: CampaignForReportClassification): PendingValue {
    if (!campaign.campaignId) return "unclassified";
    return pending.get(campaign.campaignId) ?? campaign.currentPurpose ?? "unclassified";
  }

  const filtered = campaigns.filter((c) => {
    if (search && !c.campaignName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "unclassified" && currentValue(c) !== "unclassified") return false;
    return true;
  });

  function handleSave() {
    setError(null);
    const changes = Array.from(pending.entries()).map(([campaignId, value]) => ({
      campaignId,
      purpose: value === "unclassified" ? null : value,
    }));

    if (changes.length === 0) {
      onClose();
      return;
    }

    startSaving(async () => {
      const result = await saveReportClassificationsAction(clientId, changes);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar classificação de campanhas"
        className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30"
      />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-[#D9D3C9] bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#17171A]">Classificar campanhas do Relatório</h2>
            <p className="mt-0.5 text-xs text-[#6F6B65]">
              Resultados principais (Leads/Vendas) vs. Objetivos secundários (Reconhecimento, Alcance, Seguidores, Visitas ao
              perfil, Tráfego). Campanha sem classificação continua no Relatório normalmente, só não entra em Objetivos
              secundários.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md border border-[#D9D3C9] p-1.5 text-[#6F6B65] hover:bg-black/5"
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campanha..."
            className="flex-1 rounded-md border border-[#D9D3C9] bg-white px-2 py-1.5 text-sm text-[#17171A]"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "all" ? "border-[#17171A] text-[#17171A]" : "border-[#D9D3C9] text-[#6F6B65]"}`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setFilter("unclassified")}
              className={`rounded-md border px-2 py-1 text-xs ${filter === "unclassified" ? "border-[#17171A] text-[#17171A]" : "border-[#D9D3C9] text-[#6F6B65]"}`}
            >
              Não classificadas
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1 overflow-x-auto">
          {filtered.length === 0 && <p className="text-xs text-[#6F6B65]">Nenhuma campanha encontrada.</p>}
          {filtered.map((campaign) => {
            const value = currentValue(campaign);
            return (
              <div
                key={campaign.campaignId ?? `name:${campaign.campaignName}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[#EFE9E0] py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[#17171A]">{campaign.campaignName}</p>
                  <p className="text-xs text-[#6F6B65]">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(campaign.recentSpend)} nos últimos 30 dias
                  </p>
                </div>
                <select
                  value={value}
                  disabled={!campaign.campaignId}
                  onChange={(e) => {
                    if (!campaign.campaignId) return;
                    const next = new Map(pending);
                    next.set(campaign.campaignId, e.target.value as PendingValue);
                    setPending(next);
                  }}
                  className="rounded-md border border-[#D9D3C9] bg-white px-2 py-1 text-xs text-[#17171A] disabled:opacity-40"
                >
                  {PURPOSE_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {!campaign.campaignId && (
                  <span className="text-[10px] text-[#9C978D]" title="Fonte sem ID de campanha configurado — não classificável ainda">
                    sem ID
                  </span>
                )}
                {campaign.campaignId && <span />}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-[#D9D3C9] pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-[#D9D3C9] px-3 py-1.5 text-sm text-[#17171A]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-[#17171A] px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
          >
            {isSaving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </>
  );
}
