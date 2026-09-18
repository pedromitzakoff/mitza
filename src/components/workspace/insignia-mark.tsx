import type { Insignia, InsigniaPrestige } from "@/lib/achievement-insignia";

/**
 * Etapa "Equipe — Redesign do Perfil + Sistema Visual de Insígnias — 6B":
 * representação visual PURA de uma `Insignia` (camada 6A,
 * `lib/achievement-insignia.ts`) — SVG + CSS, sem asset externo, sem regra
 * de negócio (família/estágio/prestígio já chegam prontos; este arquivo só
 * decide COMO desenhar cada um).
 *
 * Paleta INTENCIONALMENTE fixa (hex literal, não os tokens semânticos
 * `--brand`/`--sand`/`--cream` de `globals.css`) — mesmo raciocínio já
 * usado no OG image do Relatório público (`app/r/[token]/opengraph-image.tsx`):
 * uma insígnia é um objeto colecionável com identidade própria, não chrome
 * de UI que deve reagir a tema claro/escuro (`--brand`, por exemplo, INVERTE
 * pra claro no modo escuro — o oposto do que "placa grafite" da Elite
 * precisa continuar sendo). Os valores batem exatamente com os já usados no
 * resto do sistema (`--sand: #c8bead`, `--cream: #efe9e0`, `--lime: #d8f238`
 * em `globals.css`) — só grafite usa o hex pedido nesta etapa (`#17171A`)
 * em vez do `--brand` (`#1c1c1c`) já existente, por ser um valor
 * institucional específico desta peça, mesma decisão já tomada no OG image.
 */

const CREAM = "#EFE9E0";
const SAND = "#C8BEAD";
const GRAPHITE = "#17171A";
const WHITE = "#FFFFFF";
const LIME = "#D8F238";

/**
 * Forma-base — uma placa/selo geométrico proprietário: topo chanfrado a
 * 45° nos dois cantos (silhueta angulosa, editorial, nunca um círculo/
 * hexágono genérico), base com cantos arredondados (nunca ponta de escudo).
 * MESMA forma pra toda insígnia, sempre — só preenchimento/traço/glifo
 * mudam por prestígio/família (ver `PRESTIGE_STYLES`/`Glyph`).
 */
const PLATE_PATH = "M16 4H48L60 16V48Q60 60 48 60H16Q4 60 4 48V16L16 4Z";

const STAGE_NUMERALS: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

/** Exportado — a credencial (texto "Estágio III") e o glifo (numeral
 * desenhado na placa) precisam do MESMO numeral, nunca duas conversões
 * divergentes. */
export function stageNumeral(stage: number): string {
  return STAGE_NUMERALS[stage] ?? String(stage);
}

interface PrestigeStyle {
  plateFill: string;
  plateStroke: string;
  glyphColor: string;
}

/**
 * As 3 classificações continuam perceptíveis mesmo em impressão/monocromia
 * (nenhuma delas depende só de cor): Marco é predominantemente contorno
 * (preenchimento creme, quase confundido com o fundo da página — "mais
 * leve/editorial"); Destaque preenche em areia sólida ("mais presença");
 * Elite preenche em grafite sólido, glifo em branco, e ganha o único
 * detalhe em lime de toda a peça (`ELITE_ACCENT`, abaixo) — o traço
 * (`plateStroke`) é sempre grafite nos 3 níveis, garantindo que a SILHUETA
 * nunca desaparece, só o preenchimento evolui.
 */
const PRESTIGE_STYLES: Record<InsigniaPrestige, PrestigeStyle> = {
  marco: { plateFill: CREAM, plateStroke: GRAPHITE, glyphColor: GRAPHITE },
  destaque: { plateFill: SAND, plateStroke: GRAPHITE, glyphColor: GRAPHITE },
  elite: { plateFill: GRAPHITE, plateStroke: GRAPHITE, glyphColor: WHITE },
};

/**
 * Chave visual do glifo — igual a `insignia.family` na maioria dos casos,
 * MAS consistência (`person_consecutive_months_fully_within_target`) ganha
 * um glifo PRÓPRIO ("repetição/ritmo") mesmo compartilhando
 * `family: "performance"` com os outros 2 tipos de Performance na camada
 * 6A (agrupamento correto lá — é o que garante "no máximo 1 destaque por
 * família" — mas visualmente "ritmo" e "precisão/meta" são conceitos
 * diferentes). Decisão só desta camada visual; a 6A nunca é alterada.
 */
function resolveGlyphKey(insignia: Pick<Insignia, "family" | "type">): string {
  if (insignia.type === "person_consecutive_months_fully_within_target") return "consistencia";
  return insignia.family;
}

/**
 * Glifos geométricos abstratos, um por família visual — nenhum ícone de
 * biblioteca, nenhum emoji, todos pensados pra funcionar pequenos (a
 * mesma insígnia aparece tanto na coleção quanto, futuramente, em destaque
 * no cabeçalho). `color` já resolvido por `PRESTIGE_STYLES` — este
 * componente só desenha.
 */
function InsigniaGlyph({ glyphKey, color }: { glyphKey: string; color: string }) {
  switch (glyphKey) {
    case "otimizacoes":
      // 3 marcas ascendentes — evolução incremental.
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round" fill="none">
          <line x1="20" y1="36" x2="20" y2="28" />
          <line x1="32" y1="36" x2="32" y2="22" />
          <line x1="44" y1="36" x2="44" y2="16" />
        </g>
      );
    case "revisoes":
      // anel + ponto de foco — análise/diagnóstico.
      return (
        <g stroke={color} fill="none">
          <circle cx="32" cy="27" r="10" strokeWidth="3" />
          <circle cx="32" cy="27" r="3" fill={color} stroke="none" />
        </g>
      );
    case "clientes_atendidos":
      // 3 nós conectados — alcance/conexão.
      return (
        <g stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none">
          <line x1="22" y1="34" x2="32" y2="18" />
          <line x1="32" y1="18" x2="42" y2="34" />
          <line x1="22" y1="34" x2="42" y2="34" />
          <circle cx="22" cy="34" r="2.6" fill={color} stroke="none" />
          <circle cx="42" cy="34" r="2.6" fill={color} stroke="none" />
          <circle cx="32" cy="18" r="2.6" fill={color} stroke="none" />
        </g>
      );
    case "reports":
      // 3 traços horizontais — estrutura/documentação.
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <line x1="19" y1="20" x2="45" y2="20" />
          <line x1="19" y1="28" x2="45" y2="28" />
          <line x1="19" y1="36" x2="36" y2="36" />
        </g>
      );
    case "experiencia":
      // ponto de partida + linha ascendente — início de trajetória.
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <circle cx="22" cy="36" r="3" fill={color} stroke="none" />
          <line x1="22" y1="36" x2="42" y2="18" />
        </g>
      );
    case "consistencia":
      // marcas curtas e regulares — ritmo/repetição.
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <line x1="19" y1="22" x2="19" y2="34" />
          <line x1="27.5" y1="22" x2="27.5" y2="34" />
          <line x1="36" y1="22" x2="36" y2="34" />
          <line x1="44.5" y1="22" x2="44.5" y2="34" />
        </g>
      );
    case "performance":
    default:
      // anéis concêntricos abstratos — precisão/meta.
      return (
        <g stroke={color} fill="none">
          <circle cx="32" cy="27" r="11" strokeWidth="2.5" />
          <circle cx="32" cy="27" r="4.5" strokeWidth="2.5" />
        </g>
      );
  }
}

const SIZE_PX = { sm: 40, md: 56 } as const;
export type InsigniaMarkSize = keyof typeof SIZE_PX;

/**
 * Componente reutilizável (Etapa 6B) — nenhuma regra de negócio aqui,
 * só apresentação a partir dos campos já classificados pela camada 6A
 * (`family`, `type`, `prestige`, `stage`). `size="sm"` pensado pra uso
 * futuro em contexto denso (ex.: destaque no cabeçalho, 6C); `"md"` é o
 * tamanho padrão da coleção (6B).
 */
export function InsigniaMark({
  insignia,
  size = "md",
}: {
  insignia: Pick<Insignia, "family" | "type" | "prestige" | "stage">;
  size?: InsigniaMarkSize;
}) {
  const style = PRESTIGE_STYLES[insignia.prestige];
  const glyphKey = resolveGlyphKey(insignia);
  const px = SIZE_PX[size];

  return (
    <svg width={px} height={px} viewBox="0 0 64 64" aria-hidden="true">
      <path d={PLATE_PATH} fill={style.plateFill} stroke={style.plateStroke} strokeWidth="1.5" strokeLinejoin="round" />
      <InsigniaGlyph glyphKey={glyphKey} color={style.glyphColor} />
      {insignia.stage && (
        <text x="32" y="52" textAnchor="middle" fontSize="10" fontWeight="600" letterSpacing="0.5" fill={style.glyphColor}>
          {stageNumeral(insignia.stage.current)}
        </text>
      )}
      {/* Único detalhe em lime de toda a peça — reservado pra Elite,
          exatamente como pedido ("extremamente pequeno", "extremamente
          controlado"). */}
      {insignia.prestige === "elite" && <circle cx="51" cy="13" r="2" fill={LIME} />}
    </svg>
  );
}
