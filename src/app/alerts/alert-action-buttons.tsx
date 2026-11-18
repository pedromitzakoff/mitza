"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/app/toast-provider";
import { followUpAlertTomorrowAction, resolveAlertManuallyAction } from "@/app/alerts/actions";
import { ALERT_STATUS_BADGE_CLASSES } from "@/lib/alerts/alert-labels";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Aba "Alertas" — as 2 ações sobre UM alerta, agora direto no card
 * (pedido da melhoria visual, seção 4: "mostre Acompanhar e Resolver
 * diretamente nos cards abertos", nunca mais escondidas atrás do menu
 * "•••" — só 2 ações hoje, um menu seria só um clique extra sem
 * necessidade). Sem `adminOnly` (qualquer membro ativo pode agir aqui,
 * ver `actions.ts`). Um alerta "resolvido" não mostra mais nenhuma ação —
 * nada a fazer com ele até reabrir automaticamente, se reaparecer.
 *
 * "Marcar como revisado" existia como uma 3ª ação (sem observação, sem
 * mudar situação) — removida a pedido do usuário ("esse revisado pode
 * ser em acompanhamento então"): `actions.ts` explica o porquê.
 *
 * Rótulos dos botões (pedido do usuário: "em acompanhamento e ver amanha
 * sao as mesmas coisas... podemos mudar pra Em acompanhamento e
 * Resolvido"): nomeados pelo ESTADO que produzem, nunca mais pelo verbo
 * da ação — mesmo vocabulário das abas/badges de situação. Cor de cada
 * botão reaproveita a MESMA classe do badge de status que ele produz
 * (`ALERT_STATUS_BADGE_CLASSES`) — nunca uma 2ª paleta inventada aqui.
 */
export function AlertActionButtons({ alertId, status }: { alertId: string; status: AlertStatus }) {
  const [dialog, setDialog] = useState<"follow_up" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  if (status === "resolvido") return null;

  function closeDialog() {
    setDialog(null);
    setNote("");
  }

  function submit(action: (alertId: string, formData: FormData) => Promise<{ error?: string; message?: string }>) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("note", note);
      const result = await action(alertId, formData);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result.message) showToast(result.message);
      closeDialog();
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {status !== "acompanhamento" && (
          <button
            type="button"
            onClick={() => setDialog("follow_up")}
            className={`mitza-pressable flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-opacity hover:opacity-80 ${ALERT_STATUS_BADGE_CLASSES.acompanhamento}`}
          >
            Em acompanhamento
          </button>
        )}
        <button
          type="button"
          onClick={() => setDialog("resolve")}
          className={`mitza-pressable flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-opacity hover:opacity-80 ${ALERT_STATUS_BADGE_CLASSES.resolvido}`}
        >
          Resolvido
        </button>
      </div>

      {dialog === "follow_up" && (
        <ConfirmDialog
          title="Em acompanhamento"
          description="O alerta passa pra 'Em acompanhamento' — a próxima avaliação do dia completo decide se ele normalizou (resolve automático) ou se persiste (volta pra 'Precisa de atenção')."
          note={{ value: note, onChange: setNote, label: "Observação (opcional)", placeholder: 'Ex.: "Conta retomada após regularização do cartão. Acompanhar se o investimento normaliza amanhã."' }}
          confirmLabel="Em acompanhamento"
          confirmPendingLabel="Salvando..."
          pending={isPending}
          onCancel={closeDialog}
          onConfirm={() => submit(followUpAlertTomorrowAction)}
        />
      )}

      {dialog === "resolve" && (
        <ConfirmDialog
          title="Resolvido"
          description="Marca este alerta como resolvido. Se o aumento de gasto foi um orçamento planejado maior, ajuste a previsão em 'Editar orçamento' (atalho no rodapé do card) — o ajuste de orçamento é sempre uma ação separada e explícita, nunca disparada por aqui. Se a condição reaparecer, o mesmo alerta é reaberto automaticamente (histórico preservado)."
          note={{ value: note, onChange: setNote, label: "Por que está sendo resolvido?", placeholder: "Observação curta obrigatória", required: true }}
          confirmLabel="Resolvido"
          confirmPendingLabel="Resolvendo..."
          pending={isPending}
          onCancel={closeDialog}
          onConfirm={() => submit(resolveAlertManuallyAction)}
        />
      )}
    </>
  );
}
