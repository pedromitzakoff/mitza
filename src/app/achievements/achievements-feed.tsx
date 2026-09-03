"use client";

import { useState } from "react";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { familyLabelFor } from "@/lib/achievement-labels";
import type { AchievementRow } from "@/lib/achievements-data";
import { AchievementDetailDrawer } from "./achievement-detail-drawer";

/**
 * Feed de Conquistas (Etapa "Conquistas Auditáveis") — extraído de
 * `page.tsx` só pra poder segurar o estado "qual conquista está com o
 * detalhamento aberto" (client-state efêmero: nunca querystring, fechar o
 * painel não deveria mudar a URL nem perder a posição de scroll da lista).
 * Os cards continuam exatamente tão enxutos quanto antes — clicar
 * é o que abre o "comprovante" (`AchievementDetailDrawer`), a listagem em
 * si não ganhou nenhuma informação nova.
 */
export function AchievementsFeed({ groups, now }: { groups: { dayLabel: string; rows: AchievementRow[] }[]; now: Date }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openAchievement = groups.flatMap((g) => g.rows).find((row) => row.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.dayLabel}>
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
          <ul className="flex flex-col gap-1">
            {group.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(row.id)}
                  className="mitza-pressable w-full rounded-lg border border-border px-3.5 py-2 text-left text-sm hover:border-overview-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">
                    🏆 {familyLabelFor(row.scope, row.family)}
                  </p>
                  <p className="mt-0.5 font-medium text-foreground">{row.headline}</p>
                  {row.detail && <p className="mt-0.5 text-overview-text-secondary">{row.detail}</p>}
                  <p className="mt-1 text-xs text-overview-text-muted">
                    {formatTimelineDayLabel(row.occurredAt, now)} · {formatTimeOnly(row.occurredAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {openAchievement && <AchievementDetailDrawer achievement={openAchievement} onClose={() => setOpenId(null)} />}
    </div>
  );
}
