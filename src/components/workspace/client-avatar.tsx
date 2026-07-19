"use client";

import { useState } from "react";

const AVATAR_PALETTE = [
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
];

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function paletteClassFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-lg",
} as const;

export type ClientAvatarSize = keyof typeof SIZE_CLASSES;

/**
 * Avatar do cliente — componente de apresentação puro (Etapa "Redesenho
 * da Operação"), usado por enquanto só na Operação; `imageUrl` sempre
 * chega `null` até o PR de infraestrutura de avatar (upload, Storage,
 * coluna) ligar essa fonte de dado, sem precisar mudar este componente.
 * Mostra a imagem quando `imageUrl` existir e carregar; cai pras iniciais
 * (paleta hash do NOME — determinístico e estável por cliente) quando não
 * houver imagem OU ela falhar ao carregar (`onError`). `<img>` simples,
 * não `next/image`: a infraestrutura futura usará um bucket público com
 * imagens pequenas — sem necessidade da otimização/allowlist do
 * `next/image`.
 */
export function ClientAvatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name: string;
  imageUrl: string | null;
  size?: ClientAvatarSize;
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass = SIZE_CLASSES[size];

  if (imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizeClass} ${paletteClassFor(name)}`}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}
