import { redirect } from "next/navigation";

/**
 * `/pendencias` — aposentada em favor de `/demandas` (nomenclatura oficial,
 * Etapa "MITZA — Reformulação Estrutural": "Pendências" deixou de ser o
 * nome do produto pra esta área). Links/bookmarks antigos nunca quebram —
 * redireciona preservando a query string inteira (filtros/agrupamento
 * ficam 100% na URL, ver `lib/pendencias.ts`), mesmo padrão já usado por
 * `reports/[clientId]/page.tsx` ao aposentar uma rota anterior.
 */
export default async function PendenciasRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else {
      query.set(key, value);
    }
  }
  const queryString = query.toString();
  redirect(queryString ? `/demandas?${queryString}` : "/demandas");
}
