/**
 * Etapa "MITZA Interaction Engine v1.5" — extraído de `task-row.tsx`, onde
 * vivia como função privada. Qualquer Client Component que chama uma Server
 * Action diretamente (fora de um `<form action>`) dentro de uma
 * `startTransition`/optimistic flow precisa desta mesma checagem: `redirect()`
 * de dentro de uma Server Action lança um erro especial com `digest`
 * começando em "NEXT_REDIRECT", que precisa atravessar sem ser tratado como
 * falha (senão o redirecionamento real da action nunca aconteceria, e o
 * `catch` do optimistic UI mostraria um erro genérico por engano).
 */
export function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
