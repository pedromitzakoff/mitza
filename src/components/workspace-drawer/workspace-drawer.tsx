"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Pin, Search, X } from "lucide-react";
import {
  createWorkspaceNoteAction,
  deleteWorkspaceNoteAction,
  listWorkspaceNotesAction,
  toggleWorkspaceNotePinAction,
  updateWorkspaceNoteAction,
} from "@/app/workspace/actions";
import { applyInlineWrap, applyLinePrefix, type WorkspaceNote } from "@/lib/workspace-notes";
import { useWorkspace } from "./workspace-provider";

const AUTOSAVE_DELAY_MS = 700;
type FormatKind = "bold" | "italic" | "list" | "checklist";

/**
 * Painel do Workspace Pessoal — só duas vistas internas (lista de notas /
 * nota aberta), nunca uma navegação de verdade (nenhum router.push aqui).
 * Salvamento é sempre automático: o rascunho vive só em `draftRef` entre
 * uma tecla e outra, e é gravado (ou descartado, se ficou em branco)
 * sempre que a nota muda ou o painel fecha — nunca existe um botão
 * "Salvar".
 */
export function WorkspaceDrawer() {
  const { isOpen, close, contextPath, contextLabel } = useWorkspace();
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef<{ title: string; content: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeNote = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    listWorkspaceNotesAction().then((result) => {
      if (cancelled) return;
      if ("notes" in result) setNotes(result.notes);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  function flushActiveNote() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const draft = draftRef.current;
    const id = activeId;
    draftRef.current = null;
    if (!draft || !id) return;

    if (draft.title.trim() === "" && draft.content.trim() === "") {
      setNotes((prev) => prev.filter((note) => note.id !== id));
      void deleteWorkspaceNoteAction(id);
    } else {
      void updateWorkspaceNoteAction(id, draft);
    }
  }

  function openNote(id: string) {
    flushActiveNote();
    setActiveId(id);
  }

  function backToList() {
    flushActiveNote();
    setActiveId(null);
  }

  function requestClose() {
    flushActiveNote();
    setActiveId(null);
    close();
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function handleCreate() {
    if (isCreating) return;
    setIsCreating(true);
    const result = await createWorkspaceNoteAction(contextPath, contextLabel);
    setIsCreating(false);
    if ("note" in result) {
      setNotes((prev) => [result.note, ...prev]);
      // Nota nova nasce em branco — se o usuário sair sem digitar nada,
      // `flushActiveNote` precisa enxergar um rascunho (mesmo vazio) pra
      // descartá-la; sem isto, `draftRef` só ganharia valor no primeiro
      // `onChange`, e uma nota nunca tocada ficaria pra sempre no banco.
      draftRef.current = { title: "", content: "" };
      setActiveId(result.note.id);
    }
  }

  function scheduleSave(next: { title: string; content: string }) {
    draftRef.current = next;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const id = activeId;
    saveTimerRef.current = setTimeout(() => {
      if (!id) return;
      void updateWorkspaceNoteAction(id, next);
    }, AUTOSAVE_DELAY_MS);
  }

  function handleTitleChange(value: string) {
    if (!activeNote) return;
    const next = { title: value, content: draftRef.current?.content ?? activeNote.content };
    setNotes((prev) => prev.map((note) => (note.id === activeNote.id ? { ...note, title: value } : note)));
    scheduleSave(next);
  }

  function handleContentChange(value: string) {
    if (!activeNote) return;
    const next = { title: draftRef.current?.title ?? activeNote.title, content: value };
    setNotes((prev) => prev.map((note) => (note.id === activeNote.id ? { ...note, content: value } : note)));
    scheduleSave(next);
  }

  function applyFormat(kind: FormatKind) {
    const textarea = contentRef.current;
    if (!textarea || !activeNote) return;
    const { selectionStart, selectionEnd, value } = textarea;

    const result =
      kind === "bold"
        ? applyInlineWrap(value, selectionStart, selectionEnd, "**")
        : kind === "italic"
          ? applyInlineWrap(value, selectionStart, selectionEnd, "_")
          : applyLinePrefix(value, selectionStart, selectionEnd, kind === "list" ? "- " : "- [ ] ");

    handleContentChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.start, result.end);
    });
  }

  async function togglePin(note: WorkspaceNote) {
    const nextPinned = !note.is_pinned;
    setNotes((prev) => prev.map((item) => (item.id === note.id ? { ...item, is_pinned: nextPinned } : item)));
    await toggleWorkspaceNotePinAction(note.id, nextPinned);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((note) => note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q));
  }, [notes, query]);

  const pinned = filtered.filter((note) => note.is_pinned);
  const recent = filtered.filter((note) => !note.is_pinned);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="mitza-backdrop-in fixed inset-0 z-40 bg-black/20"
        onClick={requestClose}
        role="presentation"
      />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-card">
        {activeNote ? (
          <NoteEditor
            note={activeNote}
            contentRef={contentRef}
            onBack={backToList}
            onClose={requestClose}
            onTitleChange={handleTitleChange}
            onContentChange={handleContentChange}
            onApplyFormat={applyFormat}
            onTogglePin={() => togglePin(activeNote)}
          />
        ) : (
          <NoteList
            loaded={loaded}
            pinned={pinned}
            recent={recent}
            query={query}
            onQueryChange={setQuery}
            onSelect={openNote}
            onCreate={handleCreate}
            isCreating={isCreating}
            onClose={requestClose}
            onTogglePin={togglePin}
          />
        )}
      </div>
    </>
  );
}

function NoteList({
  loaded,
  pinned,
  recent,
  query,
  onQueryChange,
  onSelect,
  onCreate,
  isCreating,
  onClose,
  onTogglePin,
}: {
  loaded: boolean;
  pinned: WorkspaceNote[];
  recent: WorkspaceNote[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  isCreating: boolean;
  onClose: () => void;
  onTogglePin: (note: WorkspaceNote) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Workspace</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Pesquisar notas..."
            className="w-full rounded-md border border-border bg-transparent py-1.5 pl-8 pr-3 text-sm text-foreground outline-none focus:border-zinc-500"
          />
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCreating ? "Criando..." : "Nova nota"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!loaded ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">Carregando...</p>
        ) : pinned.length === 0 && recent.length === 0 ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {query ? "Nada encontrado." : "Nenhuma nota ainda — clique em Nova nota."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {pinned.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Fixadas</p>
                {pinned.map((note) => (
                  <NoteListItem key={note.id} note={note} onSelect={onSelect} onTogglePin={onTogglePin} />
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {pinned.length > 0 && (
                <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Recentes</p>
              )}
              {recent.map((note) => (
                <NoteListItem key={note.id} note={note} onSelect={onSelect} onTogglePin={onTogglePin} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteListItem({
  note,
  onSelect,
  onTogglePin,
}: {
  note: WorkspaceNote;
  onSelect: (id: string) => void;
  onTogglePin: (note: WorkspaceNote) => void;
}) {
  const preview = note.content.trim().split("\n")[0]?.slice(0, 80) ?? "";

  return (
    <div className="group flex items-start gap-1 rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
      <button type="button" onClick={() => onSelect(note.id)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-foreground">{note.title.trim() || "Nota sem título"}</p>
        {preview && <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>}
      </button>
      <button
        type="button"
        onClick={() => onTogglePin(note)}
        aria-label={note.is_pinned ? "Desafixar nota" : "Fixar nota"}
        className={`shrink-0 rounded p-1 transition-opacity hover:text-foreground ${
          note.is_pinned ? "text-brand opacity-100" : "text-zinc-400 opacity-0 group-hover:opacity-100"
        }`}
      >
        <Pin className={`h-3.5 w-3.5 ${note.is_pinned ? "fill-current" : ""}`} />
      </button>
    </div>
  );
}

function NoteEditor({
  note,
  contentRef,
  onBack,
  onClose,
  onTitleChange,
  onContentChange,
  onApplyFormat,
  onTogglePin,
}: {
  note: WorkspaceNote;
  contentRef: React.RefObject<HTMLTextAreaElement | null>;
  onBack: () => void;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onApplyFormat: (kind: FormatKind) => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="rounded-md p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={note.is_pinned ? "Desafixar nota" : "Fixar nota"}
            className={`rounded-md p-1 ${
              note.is_pinned ? "text-brand" : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <Pin className={`h-4 w-4 ${note.is_pinned ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 px-4 pt-3">
        <input
          value={note.title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Título"
          className="w-full border-none bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-zinc-400"
        />
        {note.context_label && note.context_path && (
          <Link href={note.context_path} onClick={onClose} className="text-xs text-muted-foreground hover:underline">
            Criada em: <span className="text-foreground">{note.context_label}</span>
          </Link>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1 border-b border-border px-4 py-2">
        <ToolbarButton label="Negrito" onClick={() => onApplyFormat("bold")}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton label="Itálico" onClick={() => onApplyFormat("italic")}>
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton label="Lista" onClick={() => onApplyFormat("list")}>
          •
        </ToolbarButton>
        <ToolbarButton label="Checklist" onClick={() => onApplyFormat("checklist")}>
          ☑
        </ToolbarButton>
      </div>

      <textarea
        ref={contentRef}
        value={note.content}
        onChange={(event) => onContentChange(event.target.value)}
        placeholder="Escreva aqui..."
        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mitza-pressable flex h-7 w-7 items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900"
    >
      {children}
    </button>
  );
}
