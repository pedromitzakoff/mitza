import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Etapa "Link Externo V1": `/r/[token]` é o Performance Report somente
// leitura enviado ao cliente — nunca exige sessão MITZA. A autorização real
// não é esta lista (que só evita o redirect pro `/login`); é a resolução do
// token contra `report_share_links`, feita dentro da própria rota
// (`resolveClientIdFromShareToken`, `lib/report-share-links.ts`).
const PUBLIC_PATHS = ["/login", "/r"];

/** Exportado só pra `scripts/test-report-share-links.ts` exercitar a lógica
 * real de "esta rota exige sessão?" sem precisar montar um `NextRequest`/
 * Supabase de verdade (`updateSession` chama rede). */
export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the session with Supabase Auth on every
  // request instead of trusting the (spoofable) cookie contents.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
