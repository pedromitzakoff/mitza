"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { formatAgencyDateTime } from "@/lib/format";

function subscribeToClock(callback: () => void) {
  const interval = setInterval(callback, 30_000);
  return () => clearInterval(interval);
}

function getClientNow() {
  return Date.now();
}

/** No servidor não existe um "agora" pra sincronizar com o cliente, então a
 * snapshot do servidor é `null` — o React usa esse valor só no primeiro
 * render de hydration (idêntico nos dois lados, sem mismatch) e troca pelo
 * valor real do cliente logo em seguida. */
function getServerNow() {
  return null;
}

/** Relógio da agência via useSyncExternalStore — é o jeito recomendado pelo
 * React pra ler um "relógio externo" que muda com o tempo sem cair no
 * anti-padrão de setState dentro de efeito (e sem erro de hydration). */
function AgencyClock() {
  const nowMs = useSyncExternalStore(subscribeToClock, getClientNow, getServerNow);

  if (nowMs === null) {
    return <span className="invisible text-sm">00:00</span>;
  }

  const { weekday, date, time } = formatAgencyDateTime(new Date(nowMs));

  return (
    <span className="text-right text-sm text-muted-foreground">
      <span className="hidden sm:inline">
        {weekday}, {date} ·{" "}
      </span>
      <span className="font-medium text-foreground">{time}</span>
    </span>
  );
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-foreground md:hidden"
        >
          Menu
        </button>
        <Link href="/" className="text-base font-semibold tracking-wide text-foreground">
          MITZA
        </Link>
      </div>

      <AgencyClock />
    </header>
  );
}
