import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * Formato comum de qualquer resposta do Supabase-js (`.select()`,
 * `.rpc()`, `.update()` etc.) — estrutural, não importa `PostgrestError`
 * nominalmente pra não acoplar a um tipo interno do pacote. `data` só vem
 * `null` quando `error` também vem preenchido: uma consulta bem-sucedida
 * sem linhas retorna `[]` (ou `null` legítimo só em `.maybeSingle()`),
 * nunca `null` por causa de falha silenciosa.
 */
interface QueryResult<T> {
  data: T | null;
  /** Opcional pra aceitar também os fallbacks literais tipo
   * `Promise.resolve({ data: [] })` (usados pra pular uma consulta quando
   * a lista de ids de entrada já está vazia) — sem `error`, o destructure
   * devolve `undefined`, que o `if (error)` trata como "sem erro". */
  error?: { message: string } | null;
}

/**
 * # `requireQuery` / `queryOrError` — padrão oficial para consultas
 * estruturais da plataforma
 *
 * Filosofia: consulta bem-sucedida com zero linhas e consulta que FALHOU
 * (schema desatualizado, RLS, timeout, erro de sintaxe) são dois estados
 * completamente diferentes — o primeiro é um dado de negócio legítimo
 * ("este cliente não tem sprints este mês"), o segundo é uma falha de
 * infraestrutura que precisa ser visível. O padrão antigo, espalhado pelo
 * código, era `const { data } = await supabase...; data ?? []` — que
 * ignora `error` completamente e trata os dois estados como se fossem o
 * mesmo. Isso foi a causa raiz do incidente da Árvore Viva 1.0: a coluna
 * `wallet_position` ainda não migrada derrubava a query inteira, e a tela
 * mostrava "nenhum cliente" — quando na verdade a consulta tinha falhado.
 *
 * Regra: NENHUMA consulta estrutural (clientes, gestores, planejamento
 * mensal, operação, tarefas, sprints etc. — qualquer coisa cuja ausência
 * o gestor perceberia como "sumiu") deve ignorar `error`. Use um destes
 * dois helpers em vez de desestruturar `{ data }` direto:
 *
 * - `requireQuery` em Server Components (`page.tsx`, funções que montam
 *   dados de página) — lança em caso de erro, capturado pelo `error.tsx`
 *   raiz já existente (mensagem genérica em português pro gestor, detalhe
 *   técnico + `context` só no log do servidor).
 * - `queryOrError` em Server Actions — nunca lança, encaixa no formato
 *   `{ error?: string }` que toda action deste projeto já devolve
 *   (preserva a UX de toast em vez de derrubar a página inteira). Usado
 *   também pras leituras que acontecem ANTES de uma mutação (ex.: buscar
 *   vizinhos antes de reordenar), que historicamente ignoravam erro mesmo
 *   quando a própria escrita seguinte já checava.
 *
 * Quando NÃO usar: buscas que já tratam `null`/vazio como estado de
 * negócio legítimo e distinto de erro (`.single()`/`.maybeSingle()` para
 * "este relatório do mês ainda não existe" ou "cliente não encontrado" →
 * 404) continuam como leitura direta — envolver essas em `requireQuery`
 * faria um 404 legítimo virar tela de erro genérica. Lookups puramente
 * complementares de baixo risco (comentários de um painel secundário,
 * histórico) também podem continuar com `?? []` — a barra é "a ausência
 * disso muda o que a tela comunica", não "toda query sem exceção".
 *
 * `context`: string curta identificando a origem da consulta nos logs
 * (geralmente o nome da tabela, com um sufixo quando o mesmo arquivo tem
 * mais de uma consulta na mesma tabela) — aparece como `[requireQuery][
 * <context>]`/`[queryOrError][<context>]` tanto no `console.error` quanto
 * na mensagem da exceção, pra uma investigação futura não precisar abrir
 * o arquivo pra descobrir qual das N queries de um `Promise.all` falhou.
 */
export async function requireQuery<T>(query: PromiseLike<QueryResult<T>>, context: string): Promise<T> {
  const { data, error } = await query;
  if (error) {
    console.error(`[requireQuery][${context}]`, error);
    throw new Error(`[requireQuery][${context}] ${error.message}`);
  }
  return data as T;
}

export async function queryOrError<T>(
  query: PromiseLike<QueryResult<T>>,
  context: string,
  fallbackMessage: string,
): Promise<{ data: T } | { error: string }> {
  const { data, error } = await query;
  if (error) {
    console.error(`[queryOrError][${context}]`, error);
    return { error: toUserFacingError(error, fallbackMessage) };
  }
  return { data: data as T };
}
