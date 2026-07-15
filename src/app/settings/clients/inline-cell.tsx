"use client";

import { useState, useTransition } from "react";
import { formatCnpj, isValidCnpjLength, normalizeCnpj } from "@/lib/cnpj";
import { isValidEmail } from "@/lib/validation";
import { formatCurrency, formatDateWithYear } from "@/lib/format";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";

const cellButtonClasses =
  "block w-full truncate rounded px-1.5 py-0.5 text-left transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900";
const cellInputClasses =
  "w-full rounded-md border border-border bg-card px-1.5 py-0.5 text-sm text-foreground outline-none transition-colors focus:border-zinc-500";

const STATUS_OPTIONS = (Object.keys(CLIENT_STATUS_LABEL) as ClientContractStatus[]).map((value) => ({
  value,
  label: CLIENT_STATUS_LABEL[value],
}));

/**
 * Célula de Status: mesmo padrão de clique-pra-editar das outras, mas o
 * selo colorido é montado aqui dentro (não dá pra passar uma função de
 * renderização de um Server Component pra um Client Component — só dados e
 * Server Actions cruzam essa fronteira).
 */
export function InlineStatusCell({
  value,
  action,
}: {
  value: ClientContractStatus;
  action: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={cellButtonClasses} disabled={pending}>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[value]}`}>
          {CLIENT_STATUS_LABEL[value]}
        </span>
      </button>
    );
  }

  return (
    <select
      autoFocus
      aria-label="Status"
      defaultValue={value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await action(next);
          setEditing(false);
        });
      }}
      onBlur={() => setEditing(false)}
      className={cellInputClasses}
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Célula de select compacto (Gestor principal): mostra o valor formatado;
 * um clique troca pra um `<select>` focado — a própria escolha já salva
 * (onChange), sem precisar de um botão "salvar" separado. Blur sem mudança
 * só volta ao modo de exibição.
 */
export function InlineSelectCell({
  value,
  options,
  emptyLabel,
  action,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  action: (value: string) => Promise<void>;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const currentLabel = options.find((o) => o.value === value)?.label ?? emptyLabel ?? "—";

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={cellButtonClasses} disabled={pending}>
        {currentLabel}
      </button>
    );
  }

  return (
    <select
      autoFocus
      aria-label={ariaLabel}
      defaultValue={value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await action(next);
          setEditing(false);
        });
      }}
      onBlur={() => setEditing(false)}
      className={cellInputClasses}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Célula de data (Início do contrato): input type="date" nativo, preserva
 * timezone porque trabalha só com a string YYYY-MM-DD, nunca um objeto Date
 * local. Enter salva, Escape cancela, clique fora salva se mudou (ou só
 * fecha se não mudou). Formata sempre como dd/mm/aaaa (`formatDateWithYear`
 * importada aqui dentro, não recebida como prop — funções não podem
 * atravessar a fronteira Server → Client Component). */
export function InlineDateCell({
  value,
  action,
  ariaLabel,
}: {
  value: string | null;
  action: (value: string | null) => Promise<void>;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, startTransition] = useTransition();

  function commit() {
    setEditing(false);
    const next = draft || null;
    if (next === value) return;
    startTransition(() => {
      action(next);
    });
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={cellButtonClasses}
      >
        {value ? formatDateWithYear(value) : "—"}
      </button>
    );
  }

  return (
    <input
      type="date"
      autoFocus
      aria-label={ariaLabel}
      value={draft}
      disabled={pending}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") cancel();
      }}
      onBlur={commit}
      className={cellInputClasses}
    />
  );
}

/** Célula de CNPJ: máscara aplicada durante a digitação (aceita colar com
 * ou sem pontuação — sempre extrai só os dígitos), valida 14 dígitos (ou
 * vazio) antes de salvar. Entrada inválida reverte pro valor anterior em
 * vez de salvar algo quebrado. */
export function InlineCnpjCell({
  value,
  action,
}: {
  value: string | null;
  action: (raw: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [digits, setDigits] = useState(value ?? "");
  const [pending, startTransition] = useTransition();

  function commit() {
    if (!isValidCnpjLength(digits)) {
      setDigits(value ?? "");
      setEditing(false);
      return;
    }
    setEditing(false);
    if (digits === (value ?? "")) return;
    startTransition(() => {
      action(digits);
    });
  }

  function cancel() {
    setDigits(value ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDigits(value ?? "");
          setEditing(true);
        }}
        className={cellButtonClasses}
      >
        {value ? formatCnpj(value) : "—"}
      </button>
    );
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoFocus
      aria-label="CNPJ"
      placeholder="00.000.000/0000-00"
      value={formatCnpj(digits)}
      disabled={pending}
      onChange={(event) => setDigits(normalizeCnpj(event.target.value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") cancel();
      }}
      onBlur={commit}
      className={`${cellInputClasses} font-mono`}
    />
  );
}

/** Célula de e-mail: valida formato básico antes de salvar (vazio é
 * permitido — e-mail é opcional). */
export function InlineEmailCell({
  value,
  action,
}: {
  value: string | null;
  action: (raw: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, startTransition] = useTransition();

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !isValidEmail(trimmed)) {
      setDraft(value ?? "");
      setEditing(false);
      return;
    }
    setEditing(false);
    if (trimmed === (value ?? "")) return;
    startTransition(() => {
      action(trimmed);
    });
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={pending}
        title={value ?? undefined}
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={cellButtonClasses}
      >
        {value || "—"}
      </button>
    );
  }

  return (
    <input
      type="email"
      autoFocus
      aria-label="E-mail"
      value={draft}
      disabled={pending}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") cancel();
      }}
      onBlur={commit}
      className={cellInputClasses}
    />
  );
}

/** Célula monetária (Mensalidade): mesma digitação natural pt-BR do
 * MoneyInput usado nas sprints, mas aqui o campo vazio é um estado válido
 * (mensalidade não configurada) — diferente do MoneyInput, que sempre
 * resolve pra um número. */
export function InlineMoneyCell({
  value,
  action,
}: {
  value: number | null;
  action: (value: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value !== null ? formatMoneyDisplay(value) : "");
  const [pending, startTransition] = useTransition();

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setEditing(false);
      if (value === null) return;
      startTransition(() => {
        action(null);
      });
      return;
    }

    const parsed = parseMoneyInput(trimmed);
    if (parsed === null) {
      setDraft(value !== null ? formatMoneyDisplay(value) : "");
      setEditing(false);
      return;
    }

    setEditing(false);
    if (parsed === value) return;
    startTransition(() => {
      action(parsed);
    });
  }

  function cancel() {
    setDraft(value !== null ? formatMoneyDisplay(value) : "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDraft(value !== null ? formatMoneyDisplay(value) : "");
          setEditing(true);
        }}
        className={`${cellButtonClasses} tabular-nums`}
      >
        {value !== null ? formatCurrency(value) : "—"}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-muted-foreground">R$</span>
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        aria-label="Mensalidade"
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") cancel();
        }}
        onBlur={commit}
        className={cellInputClasses}
      />
    </span>
  );
}
