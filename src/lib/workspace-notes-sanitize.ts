import DOMPurify from "isomorphic-dompurify";

/**
 * Editor rico das notas (Etapa "Editor de notas rico") — negrito, itálico,
 * sublinhado, lista com marcadores, lista numerada e link. De propósito,
 * nada de tabela/imagem/embed/heading/bloco: escopo mínimo aprovado, pra
 * não crescer pro tamanho de um editor tipo Notion.
 *
 * Este arquivo é server-only por construção: `isomorphic-dompurify` resolve
 * pra uma build baseada em jsdom (dependências Node — fs/http) fora do
 * navegador. Importar isso de um módulo que também é usado por um
 * componente client ("use client") faz o bundler tentar incluir jsdom no
 * bundle do navegador, que quebra em runtime (Node builtins não existem
 * lá). Só `src/app/workspace/actions.ts` ("use server") pode importar
 * deste arquivo — nunca `workspace-notes.ts` nem `workspace-drawer.tsx`.
 */
export const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "ul", "ol", "li", "a"];
export const NOTE_ALLOWED_ATTR = ["href", "target", "rel"];

/**
 * Única fronteira de autorização real pro conteúdo salvo: o editor (Tiptap)
 * já restringe a estrutura pelo schema, mas a Server Action é um endpoint
 * de rede — alguém podendo chamá-la diretamente (fora da UI) poderia
 * mandar HTML arbitrário. Sanitiza sempre no servidor antes de gravar,
 * nunca só confiando no que o cliente mandou.
 */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: NOTE_ALLOWED_TAGS, ALLOWED_ATTR: NOTE_ALLOWED_ATTR });
}
