export interface WorkspaceNote {
  id: string;
  title: string;
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

interface TextSelectionResult {
  value: string;
  start: number;
  end: number;
}

/** Envolve a seleção com `marker` dos dois lados (negrito `**`, itálico
 * `_`) — sem seleção, insere o par de marcadores e deixa o cursor entre
 * eles, pronto pra digitar. */
export function applyInlineWrap(value: string, start: number, end: number, marker: string): TextSelectionResult {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  const next = `${before}${marker}${selected}${marker}${after}`;

  if (selected.length === 0) {
    const caret = start + marker.length;
    return { value: next, start: caret, end: caret };
  }
  return { value: next, start: start + marker.length, end: end + marker.length };
}

/** Prefixa cada linha tocada pela seleção com `prefix` (lista `- `,
 * checklist `- [ ] `) — linhas que já têm o prefixo não são duplicadas. */
export function applyLinePrefix(value: string, start: number, end: number, prefix: string): TextSelectionResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextNewline = value.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;

  const before = value.slice(0, lineStart);
  const block = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);

  const nextBlock = block
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
    .join("\n");

  return { value: `${before}${nextBlock}${after}`, start: lineStart, end: lineStart + nextBlock.length };
}
