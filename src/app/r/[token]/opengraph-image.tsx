import { ImageResponse } from "next/og";
import { formatReportPeriodLabel, resolveReportShareClientName, resolveReportShareDefaultPeriod } from "./report-share-metadata";

export const alt = "Relatório de Performance";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Etapa "OG Metadata do Relatório Público": imagem pro preview de
 * compartilhamento do link (`/r/[token]`) — antes o WhatsApp/Google Chat
 * caíam no ícone genérico da plataforma (sem `opengraph-image` nenhum
 * existia em lugar algum da app). Paleta exata pedida pra esta peça
 * (creme/areia/grafite/verde-limão — os mesmos valores de `--cream`/
 * `--sand`/`--lime`/`--brand` em `globals.css`, hardcoded aqui porque o
 * Satori (motor por trás de `ImageResponse`) não lê CSS custom properties,
 * só valores literais). Mostra nome do cliente + período (`this_month`,
 * ver `resolveReportShareDefaultPeriod`) quando o token resolve; token
 * inválido/revogado/cliente excluído cai no mesmo cartão sem nenhuma
 * informação específica — nunca uma métrica, nunca o `clientId`.
 *
 * Etapa "White label no link público": sem wordmark "KOFF" — o link é
 * enviado em nome do cliente final da agência (pedido explícito: a marca
 * da agência não deve aparecer no preview pra clientes white label).
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientName = await resolveReportShareClientName(token);
  const periodLabel = formatReportPeriodLabel(resolveReportShareDefaultPeriod());

  const CREAM = "#EFE9E0";
  const SAND = "#C8BEAD";
  const GRAPHITE = "#17171A";
  const LIME = "#D8F238";
  const MUTED = "#655F56";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: CREAM,
          padding: "76px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, lineHeight: 1.15, color: GRAPHITE, maxWidth: "920px" }}>
            Relatório de Performance
          </div>
          {clientName ? (
            <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: GRAPHITE }}>{clientName}</div>
              <div style={{ display: "flex", width: 8, height: 8, borderRadius: "50%", backgroundColor: SAND }} />
              <div style={{ display: "flex", fontSize: 32, color: MUTED }}>{periodLabel}</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ display: "flex", width: 56, height: 4, backgroundColor: LIME }} />
          <div style={{ display: "flex", fontSize: 20, letterSpacing: "2px", color: MUTED }}>Relatório confidencial</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
