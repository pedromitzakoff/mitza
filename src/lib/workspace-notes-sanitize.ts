import sanitizeHtml from "sanitize-html";

/**
 * Editor rico das notas (Etapa "Editor de notas rico") — negrito, itálico,
 * sublinhado, lista com marcadores, lista numerada e link. De propósito,
 * nada de tabela/imagem/embed/heading/bloco: escopo mínimo aprovado, pra
 * não crescer pro tamanho de um editor tipo Notion.
 *
 * Este arquivo é server-only por construção — só `src/app/workspace/actions.ts`
 * ("use server") pode importar dele, nunca `workspace-notes.ts` nem
 * `workspace-drawer.tsx`. Usa `sanitize-html` (puro JS, `htmlparser2` por
 * baixo) em vez de `isomorphic-dompurify`: a versão server do DOMPurify
 * depende de `jsdom`, que quebrou o render de toda a plataforma em
 * produção (erro nos Server Components de qualquer página, já que o
 * arquivo de Server Actions é avaliado no render de toda rota que usa o
 * Workspace Pessoal) — provavelmente jsdom falhando ao inicializar no
 * runtime serverless da Vercel. `sanitize-html` não tem essa dependência.
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
  return sanitizeHtml(html, {
    allowedTags: NOTE_ALLOWED_TAGS,
    allowedAttributes: { a: NOTE_ALLOWED_ATTR },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
