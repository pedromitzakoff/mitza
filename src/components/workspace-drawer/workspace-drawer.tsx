"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  ChevronLeft,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pin,
  Search,
  Trash2,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import {
  createWorkspaceNoteAction,
  deleteWorkspaceNoteAction,
  listWorkspaceNotesAction,
  toggleWorkspaceNotePinAction,
  updateWorkspaceNoteAction,
} from "@/app/workspace/actions";
import { htmlToPlainPreview, noteContentToEditorHtml, type WorkspaceNote } from "@/lib/workspace-notes";
import { formatRelativeDateTime } from "@/lib/format";
import { useToast } from "@/app/toast-provider";
import { useWorkspace } from "./workspace-provider";

const AUTOSAVE_DELAY_MS = 700;

/**
 * Painel do Workspace Pessoal — só duas vistas internas (lista de notas /
 * nota aberta), nunca uma navegação de verdade (nenhum router.push aqui).
 * Salvamento é sempre automático: o rascunho vive só em `draftRef` entre
 * uma tecla e outra, e é gravado (ou descartado, se ficou em branco)
 * sempre que a nota muda ou o painel fecha — nunca existe um botão
 * "Salvar".
 *
 * Etapa "Editor de notas rico": o conteúdo passou de texto puro (textarea +
 * símbolos `**`/`_`/`- `) pra HTML sanitizado editado por um Tiptap real —
 * negrito/itálico/sublinhado/lista/link agora aparecem formatados de
 * verdade durante a edição, não só como marcador de texto. Ver
 * `src/lib/workspace-notes.ts` pra sanitização e compatibilidade com notas
 * antigas (texto puro, exibidas como estavam, sem conversão automática).
 */
export function WorkspaceDrawer() {
  const { isOpen, close, contextPath, contextLabel } = useWorkspace();
  const { showToast } = useToast();
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

    if (draft.title.trim() === "" && htmlToPlainPreview(draft.content) === "") {
      setNotes((prev) => prev.filter((note) => note.id !== id));
      void deleteWorkspaceNoteAction(id);
    } else {
      void updateWorkspaceNoteAction(id, draft);
    }
  }

  function openNote(id: string) {
    flushActiveNote();
    setConfirmDeleteId(null);
    setActiveId(id);
  }

  function backToList() {
    flushActiveNote();
    setActiveId(null);
  }

  function requestClose() {
    flushActiveNote();
    setActiveId(null);
    setConfirmDeleteId(null);
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
    const editedAt = new Date().toISOString();
    setNotes((prev) =>
      prev.map((note) => (note.id === activeNote.id ? { ...note, title: value, updated_at: editedAt } : note)),
    );
    scheduleSave(next);
  }

  function handleContentChange(html: string) {
    if (!activeNote) return;
    const next = { title: draftRef.current?.title ?? activeNote.title, content: html };
    const editedAt = new Date().toISOString();
    setNotes((prev) =>
      prev.map((note) => (note.id === activeNote.id ? { ...note, content: html, updated_at: editedAt } : note)),
    );
    scheduleSave(next);
  }

  async function togglePin(note: WorkspaceNote) {
    const nextPinned = !note.is_pinned;
    setNotes((prev) => prev.map((item) => (item.id === note.id ? { ...item, is_pinned: nextPinned } : item)));
    await toggleWorkspaceNotePinAction(note.id, nextPinned);
  }

  function requestDeleteNote(id: string) {
    setConfirmDeleteId(id);
  }

  function cancelDeleteNote() {
    setConfirmDeleteId(null);
  }

  async function confirmDeleteNote() {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);

    // A nota sendo excluída pode ser a que está aberta agora — descarta
    // qualquer autosave pendente dela antes de apagar, senão o timer do
    // debounce dispara depois e tenta gravar numa nota que já não existe.
    if (activeId === id) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      draftRef.current = null;
      setActiveId(null);
    }

    setNotes((prev) => prev.filter((note) => note.id !== id));

    const result = await deleteWorkspaceNoteAction(id);
    if (result?.error) {
      showToast("Não foi possível excluir a nota. Tente novamente.", "error");
      const refreshed = await listWorkspaceNotesAction();
      if ("notes" in refreshed) setNotes(refreshed.notes);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (note) => note.title.toLowerCase().includes(q) || htmlToPlainPreview(note.content).toLowerCase().includes(q),
    );
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
            onBack={backToList}
            onClose={requestClose}
            onTitleChange={handleTitleChange}
            onContentChange={handleContentChange}
            onTogglePin={() => togglePin(activeNote)}
            confirmingDelete={confirmDeleteId === activeNote.id}
            onRequestDelete={() => requestDeleteNote(activeNote.id)}
            onConfirmDelete={confirmDeleteNote}
            onCancelDelete={cancelDeleteNote}
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
            confirmDeleteId={confirmDeleteId}
            onRequestDelete={requestDeleteNote}
            onConfirmDelete={confirmDeleteNote}
            onCancelDelete={cancelDeleteNote}
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
  confirmDeleteId,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
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
  confirmDeleteId: string | null;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
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
                  <NoteListItem
                    key={note.id}
                    note={note}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                    confirmingDelete={confirmDeleteId === note.id}
                    onRequestDelete={() => onRequestDelete(note.id)}
                    onConfirmDelete={onConfirmDelete}
                    onCancelDelete={onCancelDelete}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {pinned.length > 0 && (
                <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Recentes</p>
              )}
              {recent.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  confirmingDelete={confirmDeleteId === note.id}
                  onRequestDelete={() => onRequestDelete(note.id)}
                  onConfirmDelete={onConfirmDelete}
                  onCancelDelete={onCancelDelete}
                />
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
  confirmingDelete,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  note: WorkspaceNote;
  onSelect: (id: string) => void;
  onTogglePin: (note: WorkspaceNote) => void;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const preview = htmlToPlainPreview(note.content).slice(0, 80);
  // "Hoje, 14:03" / "Ontem, 09:10" / "12/07, 09:10" — mesmo formato usado no
  // histórico de conta e revisões da plataforma, igual ao pedido de sempre
  // mostrar a data (como no ClickUp).
  const date = formatRelativeDateTime(note.updated_at, new Date());

  if (confirmingDelete) {
    return (
      <div className="rounded-md border border-border bg-zinc-50 px-2 py-2 text-xs dark:bg-zinc-900/40">
        <p className="text-foreground">
          Excluir &ldquo;{note.title.trim() || "Nota sem título"}&rdquo;? Essa ação não pode ser desfeita.
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <button type="button" onClick={onConfirmDelete} className="font-medium text-red-600 hover:underline dark:text-red-400">
            Excluir
          </button>
          <button type="button" onClick={onCancelDelete} className="text-muted-foreground hover:underline">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-1 rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
      <button type="button" onClick={() => onSelect(note.id)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{note.title.trim() || "Nota sem título"}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{date}</span>
        </div>
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
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Excluir nota"
        className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NoteEditor({
  note,
  onBack,
  onClose,
  onTitleChange,
  onContentChange,
  onTogglePin,
  confirmingDelete,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  note: WorkspaceNote;
  onBack: () => void;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onContentChange: (html: string) => void;
  onTogglePin: () => void;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
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
            onClick={onRequestDelete}
            aria-label="Excluir nota"
            className="rounded-md p-1 text-muted-foreground hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
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

      {confirmingDelete && (
        <div className="mx-4 mt-3 rounded-md border border-border bg-zinc-50 p-2.5 text-xs dark:bg-zinc-900/40">
          <p className="font-medium text-foreground">Excluir esta nota?</p>
          <p className="mt-0.5 text-muted-foreground">Essa ação não pode ser desfeita.</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onConfirmDelete}
              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Excluir
            </button>
            <button type="button" onClick={onCancelDelete} className="text-xs text-muted-foreground hover:underline">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 px-4 pt-3">
        <input
          value={note.title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Título"
          className="w-full rounded border-none bg-transparent px-1 -mx-1 text-base font-semibold text-foreground outline-none transition-colors placeholder:text-zinc-400 focus:bg-zinc-100 dark:focus:bg-zinc-900"
        />
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatRelativeDateTime(note.updated_at, new Date())}</span>
          {note.context_label && note.context_path && (
            <>
              <span>·</span>
              <Link href={note.context_path} onClick={onClose} className="hover:underline">
                Criada em: <span className="text-foreground">{note.context_label}</span>
              </Link>
            </>
          )}
        </div>
      </div>

      <NoteContentEditor
        key={note.id}
        initialContent={note.content}
        onChange={onContentChange}
      />
    </div>
  );
}

/**
 * Editor rico da nota (Tiptap). Recebe o conteúdo só na montagem
 * (`initialContent`) — o pai já nunca remonta este componente sem trocar
 * de nota (`NoteEditor` só existe enquanto uma nota está aberta, e a lista
 * sempre reaparece entre uma nota e outra), então não há necessidade de
 * ressincronizar `content` a cada tecla: o próprio Tiptap é a fonte da
 * verdade do documento, e cada mudança sobe pro pai via `onChange`.
 */
function NoteContentEditor({ initialContent, onChange }: { initialContent: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      UnderlineExtension,
      LinkExtension.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Placeholder.configure({ placeholder: "Escreva aqui..." }),
    ],
    content: noteContentToEditorHtml(initialContent),
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "text-sm text-foreground",
      },
    },
  }, []);

  if (!editor) return null;

  return (
    <div className="mitza-note-editor flex flex-1 flex-col overflow-hidden">
      <NoteToolbar editor={editor} />
      <EditorContent editor={editor} className="flex-1 overflow-y-auto px-4 py-3" />
    </div>
  );
}

function NoteToolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previousUrl = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("URL do link", previousUrl);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-2">
      <ToolbarButton label="Negrito" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Itálico" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Sublinhado"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Lista com marcadores"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`mitza-pressable flex h-7 w-7 items-center justify-center rounded-md ${
        active
          ? "bg-brand/10 text-brand"
          : "text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}
