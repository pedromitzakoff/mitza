import { redirect } from "next/navigation";

/**
 * Operação foi renomeada pra Sprints (mesma tela, mesmos filtros e modos) —
 * esta rota continua existindo só como redirect, preservando favoritos e
 * links antigos, sem quebrar nada que apontava pra cá.
 */
export default async function OperationRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }

  redirect(`/sprints${query.toString() ? `?${query.toString()}` : ""}`);
}
