import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AnalyticsReport (PDF via Chromium headless): o binário do
  // @sparticuz/chromium (bin/*.br) é lido em runtime, não via
  // require/import estático — o tracer da Vercel não o detecta sozinho e a
  // function sobe sem esse diretório ("input directory ... does not
  // exist"). Escopo só nesta rota (o binário é grande; nunca incluir
  // globalmente com "/*").
  outputFileTracingIncludes: {
    "/api/clients/\\[id\\]/analytics-report": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
