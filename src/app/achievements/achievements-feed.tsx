"use client";

import { useState } from "react";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { ACHIEVEMENT_LEVEL_LABEL, familyLabelFor } from "@/lib/achievement-labels";
import type { AchievementRow } from "@/lib/achievements-data";
import { AchievementDetailDrawer } from "./achievement-detail-drawer";

/**
 * Feed de Conquistas (Etapa "Conquistas por Granularidade" — redesenho
 * completo do card, seções 2/3/10/11 do pedido). Hierarquia fixa em TODO
 * card: CLIENTE (sempre a primeira informação) → O QUE ACONTECEU (headline,
 * nunca repete o nome do cliente dentro da frase) → EVIDÊNCIA (detail,
 * numérica) → data/hora discreta. Categoria deixa de ser protagonista —
 * vira uma tag pequena, sem emoji de troféu (seção 14: "não precisamos de
 * troféu em todo card").
 *
 * Divisor leve entre itens em vez de card com borda própria (mesma
 * linguagem editorial já adotada em `/timeline`) — boa densidade pra
 * dezenas de eventos por dia, sem o peso visual do card grande anterior.
 *
 * Extraído de `page.tsx` só pra poder segurar o estado "qual conquista está
 * com o detalhamento aberto" (client-state efêmero: nunca querystring,
 * fechar o painel não deveria mudar a URL nem perder a posição de scroll).
 */
export function AchievementsFeed({ groups, now }: { groups: { dayLabel: string; rows: AchievementRow[] }[]; now: Date }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openAchievement = groups.flatMap((g) => g.rows).find((row) => row.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.dayLabel}>
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
          <ul className="flex flex-col">
            {group.rows.map((row) => (
              <li key={row.id} className="border-b border-overview-border/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenId(row.id)}
                  className="mitza-pressable w-full py-2.5 text-left text-sm hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-foreground">{subjectLabel(row)}</span>
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{contextTag(row)}</span>
                  </div>
                  <p className="mt-1 font-medium text-foreground">{row.headline}</p>
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

/** Cliente (escopo Cliente) ou pessoa (escopo Pessoa) — sempre a primeira
 * informação do card, nunca embutido na frase do headline. Escopo Agência
 * não tem sujeito individual: "Agência" é o rótulo neutro. */
function subjectLabel(row: AchievementRow): string {
  if (row.scope === "client") return row.clientName ?? "Cliente";
  if (row.scope === "person") return row.actorTeamMemberName ?? "Pessoa";
  return "Agência";
}

/** Tag pequena de contexto (seção 10 do pedido) — nível quando existe
 * (Campanha/Público/Criativo, mais informativo: "onde aconteceu"), família
 * quando é Conta (nível "Conta" seria redundante como tag; a família —
 * Evolução/Consistência/Recorde/etc. — é o contexto que sobra). Nunca o
 * protagonista do card. */
function contextTag(row: AchievementRow): string {
  return row.level === "account" ? familyLabelFor(row.scope, row.family) : ACHIEVEMENT_LEVEL_LABEL[row.level];
}
