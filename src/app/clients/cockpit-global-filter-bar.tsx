"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { NameFilterMode } from "@/lib/performance-report/report-filter-recompute";

const DEBOUNCE_MS = 400;

/**
 * KOFF Analytics — "Filtro global de performance" (pedido explícito do
 * usuário, prioridade máxima): filtro de texto "contém"/"não contém" por
 * CAMPANHA, visível acima da Visão executiva, que passa a reger a página
 * inteira — nunca mais só a tabela de exploração. Estado vive na URL
 * (`?filtro=...&modo=...`), nunca em `useState` isolado: é o que permite
 * `page.tsx` (Server Component) filtrar TUDO (indicadores, gráficos,
 * exploração) numa única passada, com uma ÚNICA definição de escopo
 * (`lib/cockpit-global-filter.ts`) — nunca cada componente reimplementando
 * seu próprio filtro local (era exatamente esse o problema: o filtro de
 * texto só existia dentro da tabela de Exploração).
 *
 * Preserva TODOS os outros parâmetros da URL (mês etc.) ao atualizar —
 * lê `useSearchParams()` em vez de reconstruir a URL do zero.
 */
export function CockpitGlobalFilterBar({ initialText, initialMode }: { initialText: string; initialMode: NameFilterMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<NameFilterMode>(initialMode);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mesmo cuidado de hidratação de sempre (DataFreshnessTimer/CockpitAdMetricCards):
  // navegação direta por URL (voltar/avançar do navegador, link compartilhado)
  // precisa refletir no input, não só o valor inicial da primeira renderização.
  useEffect(() => {
    function applyUrlState() {
      setText(initialText);
      setMode(initialMode);
    }
    applyUrlState();
  }, [initialText, initialMode]);

  function navigate(nextText: string, nextMode: NameFilterMode) {
    const params = new URLSearchParams(searchParams.toString());
    const normalized = nextText.trim();
    if (normalized === "") {
      params.delete("filtro");
      params.delete("modo");
    } else {
      params.set("filtro", normalized);
      params.set("modo", nextMode);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function handleTextChange(value: string) {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(value, mode), DEBOUNCE_MS);
  }

  function handleModeChange(value: NameFilterMode) {
    setMode(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(text, value);
  }

  function handleClear() {
    setText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate("", mode);
  }

  const isActive = text.trim() !== "";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-overview-border bg-overview-surface p-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Filtro de campanhas</span>
      <select
        aria-label="Operador do filtro"
        value={mode}
        onChange={(event) => handleModeChange(event.target.value as NameFilterMode)}
        className="min-h-9 rounded-lg border border-overview-border bg-overview-surface px-2 text-xs text-overview-text-primary"
      >
        <option value="contains">contém</option>
        <option value="not_contains">não contém</option>
      </select>
      <input
        type="text"
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        placeholder="Buscar por nome da campanha"
        aria-label="Texto do filtro de campanhas"
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-overview-border bg-overview-surface px-2.5 text-xs text-overview-text-primary placeholder:text-overview-text-muted sm:w-64 sm:flex-none"
      />
      {isActive && (
        <button
          type="button"
          onClick={handleClear}
          className="mitza-pressable rounded-lg border border-overview-border px-2.5 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
        >
          Limpar
        </button>
      )}
      {isActive && (
        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand">
          Página filtrada — só campanhas que {mode === "contains" ? "contêm" : "não contêm"} &ldquo;{text.trim()}&rdquo;
        </span>
      )}
    </div>
  );
}
