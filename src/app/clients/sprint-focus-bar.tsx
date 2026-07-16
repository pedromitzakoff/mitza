import Link from "next/link";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL, type SpendStatus } from "@/lib/spend-status";

/**
 * "Foco agora" — Etapa "MITZA Operational Workspace 1.0". Primeiro conteúdo
 * operacional da página do cliente, antes de qualquer bloco de consulta:
 * responde de imediato "a conta está saudável?" (mesmo `SpendStatus` que já
 * orienta toda a plataforma — nenhuma classificação nova, só um rótulo que
 * já existia em `SPEND_STATUS_LABEL`/`SPEND_STATUS_BADGE_CLASSES` e nunca
 * tinha sido exibido nesta página) e "o que eu preciso fazer agora?"
 * (`computeNextAction`, já existente — só promovida pra fora do card da
 * sprint atual, onde exigia rolar a página inteira e a sprint já estar
 * expandida pra ser vista). Nenhum cálculo novo: os dois valores já eram
 * computados pela página, só não tinham essa apresentação.
 *
 * `ctaHref`/`ctaLabel` vêm `null` quando não há ação clicável a promover
 * (kind "none" — conta em dia, nada pendente agora).
 */
export function SprintFocusBar({
  spendStatus,
  nextActionText,
  ctaHref,
  ctaLabel,
}: {
  spendStatus: SpendStatus;
  nextActionText: string;
  ctaHref: string | null;
  ctaLabel: string | null;
}) {
  const isAnchor = ctaHref?.startsWith("#") ?? false;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand/[0.04] px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[spendStatus]}`}
        >
          {SPEND_STATUS_LABEL[spendStatus]}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Próxima ação: </span>
          <span className="font-semibold text-foreground">{nextActionText}</span>
        </span>
      </div>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          scroll={isAnchor}
          className="mitza-pressable shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
