import type { NextConfig } from "next";

/**
 * Etapa 2B (Hardening antes do link externo) — headers globais de baixo
 * risco, aplicados a toda resposta (páginas e `/api/**`). Cada um foi
 * avaliado individualmente; o critério foi só adicionar o que não tem
 * chance real de quebrar algo hoje:
 *
 * - `X-Content-Type-Options: nosniff` — nunca deixa o browser "adivinhar"
 *   um Content-Type diferente do declarado (mitiga MIME-sniffing). Zero
 *   risco: a MITZA já declara Content-Type explícito em toda resposta.
 * - `X-Frame-Options: DENY` — a MITZA nunca foi desenhada pra rodar dentro
 *   de um `<iframe>` de outro site (nem o futuro link externo do relatório
 *   precisa disso). Zero risco.
 * - `Referrer-Policy: strict-origin-when-cross-origin` — nunca vaza o path
 *   completo (que pode conter `clientId`) no header `Referer` quando um
 *   link leva pra fora do domínio da MITZA; navegação dentro do próprio
 *   domínio continua enviando o referrer completo normalmente. Zero risco.
 * - `Permissions-Policy` — desliga câmera/microfone/geolocalização, que a
 *   MITZA nunca usa em lugar nenhum (confirmado: nenhuma referência a
 *   `getUserMedia`/`geolocation` no código). Zero risco.
 * - `Strict-Transport-Security` — seguro assumir HTTPS permanente (deploy é
 *   Vercel, que já força redirect HTTP→HTTPS em todo domínio); `max-age` de
 *   2 anos, SEM `includeSubDomains`/`preload` — não temos visibilidade
 *   sobre outros subdomínios que porventura existam fora deste projeto, e
 *   `preload` é um compromisso público (lista do Chromium) que merece
 *   decisão própria, não um efeito colateral deste hardening.
 *
 * Deliberadamente NÃO incluído nesta rodada: `Content-Security-Policy`. Uma
 * CSP forte exige mapear todo script/estilo/imagem/conexão que a MITZA (e o
 * Supabase JS SDK, o Next.js dev overlay, etc.) realmente usa — feita "no
 * escuro" tem risco real de quebrar a aplicação. Fica para uma auditoria
 * própria, futura.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // AnalyticsReport (PDF via Chromium headless): o binário do
  // @sparticuz/chromium (bin/*.br) é lido em runtime, não via
  // require/import estático — o tracer da Vercel não o detecta sozinho e a
  // function sobe sem esse diretório ("input directory ... does not
  // exist"). Escopo só nesta rota (o binário é grande; nunca incluir
  // globalmente com "/*").
  outputFileTracingIncludes: {
    "/api/clients/\\[id\\]/performance-report": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
