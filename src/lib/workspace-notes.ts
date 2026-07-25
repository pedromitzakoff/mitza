export interface WorkspaceNote {
  id: string;
  title: string;
  /** HTML sanitizado (Etapa "Editor de notas rico") — notas criadas antes
   * dessa etapa guardam texto puro (nenhuma migração automática rodou);
   * ver `looksLikeRichContent`/`legacyPlainTextToHtml` pra exibir as duas
   * gerações de nota do mesmo jeito no editor. */
  content: string;
  is_pinned: boolean;
  context_path: string | null;
  context_label: string | null;
  created_at: string;
  updated_at: string;
}

/** Rótulo padrão do contexto por rota — só usado quando a própria página
 * não registra um rótulo mais específico (ex.: nome do cliente) via
 * `useWorkspaceContextLabel`. A ordem importa: a primeira regra que bater
 * vence, por isso `/clients/` (prefixo genérico) vem depois de `/clients`
 * exato. */
const CONTEXT_LABEL_RULES: { test: (path: string) => boolean; label: string }[] = [
  { test: (path) => path === "/", label: "Painel Geral" },
  { test: (path) => path.startsWith("/operation"), label: "Operação" },
  { test: (path) => path.startsWith("/sprints"), label: "Sprints" },
  { test: (path) => path === "/clients" || path === "/clients/new", label: "Clientes" },
  { test: (path) => path.startsWith("/clients/"), label: "Cliente" },
  { test: (path) => path.startsWith("/reports"), label: "Relatórios" },
  { test: (path) => path.startsWith("/settings"), label: "Configurações" },
  { test: (path) => path.startsWith("/team"), label: "Equipe" },
];

export function defaultWorkspaceContextLabel(path: string): string {
  return CONTEXT_LABEL_RULES.find((rule) => rule.test(path))?.label ?? "MITZA";
}

/** Notas criadas pelo editor novo sempre têm ao menos uma tag de bloco
 * (`<p>`/`<ul>`/`<ol>`); notas antigas (textarea + símbolos `**`/`_`/`- `)
 * são sempre texto puro sem nenhuma tag. Heurística simples, mas
 * suficiente pra nunca confundir as duas gerações sem precisar de coluna
 * nova ou migração. */
function looksLikeRichContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converte texto puro legado em HTML equivalente (cada linha vira um
 * parágrafo, preservando a quebra de linha que o textarea antigo
 * mostrava) — nunca interpreta os símbolos `**`/`_`/`- ` como formatação:
 * pedido explícito é exibir notas antigas exatamente como texto simples,
 * sem conversão automática. */
export function legacyPlainTextToHtml(content: string): string {
  if (content.trim() === "") return "";
  return content
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
}

/** HTML pronto pra alimentar o editor (Tiptap `content`), cobrindo as
 * duas gerações de nota com a mesma função. */
export function noteContentToEditorHtml(content: string): string {
  return looksLikeRichContent(content) ? content : legacyPlainTextToHtml(content);
}

/** Prévia em texto puro pra lista de notas (tira as tags, nunca renderiza
 * HTML fora do editor). */
export function htmlToPlainPreview(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
