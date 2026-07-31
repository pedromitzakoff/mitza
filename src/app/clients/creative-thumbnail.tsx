"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * Miniatura do criativo — Módulo de Criativos (Creative Analytics), ajuste
 * "representação visual dos criativos": `url` (`preview_image_url`) chega
 * SEMPRE `null` hoje — nenhum mecanismo de preenchimento existe ainda (sem
 * scraping, sem download, sem cache de mídia, ver DECISIONS.md). Nome
 * deliberadamente desacoplado de origem (nunca "creative_thumbnail_url"):
 * amanhã a imagem pode vir do Instagram, da CDN do Meta, de upload manual,
 * de cache próprio ou até ser gerada internamente — este componente já
 * nasce definitivo: quando `preview_image_url` passar a ser populado, a
 * imagem aparece sozinha, sem
 * nenhuma mudança estrutural aqui nem em quem consome este componente — só
 * o dado passa a existir.
 *
 * Mesmo padrão de `ClientAvatar` (`@/components/workspace/client-avatar`):
 * `<img>` simples com `onError` caindo pro placeholder, nunca `next/image`
 * (a fonte futura da imagem ainda não está definida, não faz sentido
 * configurar allowlist de domínio agora). O permalink do Instagram NUNCA é
 * a representação visual do criativo — só uma ação secundária renderizada
 * por quem usa este componente, fora dele.
 */
export function CreativeThumbnail({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    return (
      <div className="aspect-square w-full overflow-hidden rounded-md border border-border bg-zinc-50 dark:bg-zinc-900/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-md border border-border bg-zinc-50 text-muted-foreground dark:bg-zinc-900/40"
      role="img"
      aria-label={`${alt} — miniatura indisponível`}
    >
      <ImageOff className="h-6 w-6" aria-hidden="true" />
      <span className="text-[11px] font-medium">Thumbnail indisponível</span>
    </div>
  );
}
