# AnalyticsReport — Documento de Arquitetura

## Status

**Arquitetura aprovada, com refinamentos incorporados nesta revisão —
implementação ainda não iniciada.** Este documento existe pra ser discutido
e aprovado antes de qualquer linha de código (pedido explícito do usuário:
"essa funcionalidade vai ficar na plataforma por anos, vale gastar uma hora
desenhando ela"). A primeira versão propunha 4 camadas (Dados → Tema →
Renderer → Formatos); esta revisão adiciona uma quinta, `AnalyticsReportDocument`
(estrutura do documento, separada do dado bruto), formaliza uma restrição
não-negociável de reuso de lógica, e resolve as 3 perguntas em aberto da
versão anterior. Próximo passo é a Fase 0 (validação técnica), ainda não
iniciada.

## Nome do produto interno

Internamente, esta funcionalidade se chama **AnalyticsReport** — nunca
"exportar PDF"/"gerar PDF". PDF é só o primeiro FORMATO de saída, não o
produto em si:

```
AnalyticsReport
    │
    ├── PDF (hoje)
    ├── HTML / página compartilhável (futuro)
    ├── E-mail (futuro)
    └── Outro formato (futuro — ex.: apresentação)
```

Nomear internamente pelo formato ("PdfExporter", "generatePdf") sedimenta a
suposição errada de que PDF é o produto — o resto deste documento evita
esse nome em qualquer camada que não seja literalmente o passo final de
rasterização.

## Objetivo da arquitetura

Fazer o botão "Exportar relatório" do hub de Analytics gerar um documento
executivo de verdade — não um print da tela, não uma segunda cópia dos
cálculos — desenhado desde o início pra servir qualquer formato de saída
futuro sem reescrever nada quando esses formatos forem adicionados.

## Restrição não-negociável

**O AnalyticsReport nunca pode conter lógica própria.** Toda informação
exibida nele deve vir de funções já reutilizadas pelo Analytics na tela —
nunca uma fórmula, um cálculo ou uma regra que só existe pro relatório. Se
amanhã alguém quiser adicionar uma métrica nova só no PDF, a ordem correta
é sempre: (1) essa métrica primeiro passa a existir no Analytics (tela);
(2) só depois o AnalyticsReport passa a exibi-la, lendo o mesmo dado. Nunca
o caminho inverso.

Essa regra é o que garante, estruturalmente, que tela e relatório nunca
divergem — não por disciplina de quem programa, mas porque não existe
sequer um lugar no código onde uma segunda fórmula poderia ser escrita.

## Contexto

O hub de Analytics (`AnalyticsSection`, `CreativeAnalyticsSection`,
`AnalyticsCampaignsSection`) já é, hoje, a fonte de verdade de tudo que um
relatório executivo precisaria dizer: KPIs, destaques do período, narrativa
("o que aprendemos"), criativos, campanhas. O botão "Exportar relatório" no
`AnalyticsHubHeader` está desabilitado ("Em breve") desde a etapa anterior,
deliberadamente desacoplado do antigo wizard de `client_reports`
(WhatsApp/PDF curto) — são dois produtos diferentes, e o `client_reports`
continua existindo sem alteração.

O risco que este documento existe pra evitar: implementar a exportação como
"pegar a tela e virar PDF" — o que amarraria documento a layout de tela,
misturaria cálculo com apresentação, e faria qualquer novo formato (página
web, e-mail) exigir reescrever tudo de novo.

## Visão geral do fluxo

```
Analytics (hub, período selecionado)
        │
        ▼
AnalyticsReportData         — dado puro (hero, kpis, destaques, criativos, campanhas, aprendizados...)
        │
        ▼
AnalyticsReportDocument     — estrutura (páginas + blocos), ainda sem tema nem HTML
        │
        ▼
ReportTheme                 — MITZA | White Label | (futuro: parceiro X)
        │
        ▼
Renderer                    — HTML (canônico) → PDF | página | e-mail (futuro)
```

Cinco camadas, cada uma só conhece a de baixo — nunca a de cima, nunca uma
camada pula outra:

1. **Dados** não sabe que existe página, tema ou formato de saída.
2. **Documento** não sabe que existe tema ou formato — só organiza o dado
   em páginas/blocos.
3. **Tema** não sabe que existe PDF ou HTML — é só um objeto de
   configuração (logo, nome de marca, cor de destaque, o que mostrar).
4. **Renderer** recebe documento + tema já prontos e só decide como
   desenhar.

## Camada 1 — `AnalyticsReportData` (dado puro)

Estrutura única, a mesma pra qualquer tema, estrutura de páginas ou formato
de saída — nunca "a versão PDF dos dados" e "a versão tela dos dados"
divergindo.

```ts
// src/lib/analytics-report/report-data.ts

export interface AnalyticsReportData {
  client: { id: string; name: string };
  period: { start: string; end: string; label: string }; // label já formatado

  summary: {
    headline: string;              // buildResultHeadline
    lede: string;                  // buildResultLede
    kpis: AnalyticsKpiCard[];      // buildAnalyticsKpiCards
    trend: AnalyticsTrend | null;  // já existente em ClientAnalyticsData
  };

  highlights: PeriodHighlight[];   // buildPeriodHighlights — mesmo array do card "Destaques"
  learnings: string[];             // buildLearningsNarrative — mesmas frases de "O que aprendemos"
  opportunities: string[];         // mesma lista estática de FUTURE_OPPORTUNITY_CATEGORIES
  creatives: CreativeSummary[];    // buildCreativeSummaries
  campaigns: CampaignSummary[];    // buildCampaignSummaries

  generatedAt: string;             // ISO, carimbo de quando o documento foi montado
}

export async function buildAnalyticsReportData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<AnalyticsReportData>
```

Aplicação direta da restrição não-negociável: `buildAnalyticsReportData`
chama exatamente as mesmas funções puras que já alimentam o hub na tela
(`fetchClientAnalyticsData`, `buildAnalyticsHero`, `buildResultHeadline`,
`buildResultLede`, `buildAnalyticsKpiCards`, `buildLearningsNarrative`,
`buildPeriodHighlights`, `buildCreativeSummaries`, `buildCampaignSummaries`)
— mesma garantia de "fonte única da verdade" já documentada em
`docs/DECISIONS.md` (Decisão 007).

Sem nenhuma tabela nova pra este dado — `AnalyticsReportData` é montada em
tempo de requisição a partir das mesmas fontes de sempre (`daily_spend`,
`daily_performance`/`performance_records`, `ad_creative_daily_metrics`).
Nada é persistido nesta camada.

## Camada 2 — `AnalyticsReportDocument` (estrutura do documento)

Camada nova desta revisão. `AnalyticsReportData` é **dado**; este é
**estrutura** — decide em que página cada coisa aparece e em que ordem,
sem saber nada de tema, fonte, cor ou HTML. Modelo genérico de
página→blocos, onde cada tipo de bloco é um "tipo de conteúdo conhecido",
nunca um conceito de negócio (o bloco não sabe o que é "criativo", só sabe
que é um `creative-cards` com uma lista dentro):

```ts
// src/lib/analytics-report/report-document.ts

export type AnalyticsReportBlock =
  | { type: "cover" }
  | { type: "hero"; headline: string; lede: string }
  | { type: "kpi-grid"; cards: AnalyticsKpiCard[] }
  | { type: "trend-chart"; trend: AnalyticsTrend }
  | { type: "highlight-cards"; highlights: PeriodHighlight[] }
  | { type: "narrative"; title: string; sentences: string[] }
  | { type: "creative-cards"; creatives: CreativeSummary[] }
  | { type: "campaign-table"; campaigns: CampaignSummary[] }
  | { type: "bullet-list"; title: string; items: string[] };

export interface AnalyticsReportPage {
  id: string; // "cover" | "summary" | "highlights" | "creatives" | "campaigns" | "learnings"
  blocks: AnalyticsReportBlock[];
}

export interface AnalyticsReportDocument {
  pages: AnalyticsReportPage[];
}

export function buildAnalyticsReportDocument(data: AnalyticsReportData): AnalyticsReportDocument {
  return {
    pages: [
      { id: "cover", blocks: [{ type: "cover" }] },
      {
        id: "summary",
        blocks: [
          { type: "hero", headline: data.summary.headline, lede: data.summary.lede },
          { type: "kpi-grid", cards: data.summary.kpis },
          ...(data.summary.trend ? [{ type: "trend-chart" as const, trend: data.summary.trend }] : []),
        ],
      },
      { id: "highlights", blocks: [{ type: "highlight-cards", highlights: data.highlights }] },
      { id: "creatives", blocks: [{ type: "creative-cards", creatives: data.creatives }] },
      { id: "campaigns", blocks: [{ type: "campaign-table", campaigns: data.campaigns }] },
      {
        id: "learnings",
        blocks: [
          { type: "narrative", title: "O que aprendemos", sentences: data.learnings },
          { type: "bullet-list", title: "Oportunidades", items: data.opportunities },
        ],
      },
    ],
  };
}
```

Por que esta camada existe separada de `AnalyticsReportData` (e não faz
parte de `buildAnalyticsReportData` direto): **paginação/agrupamento é uma
decisão de apresentação, não de dado**. Ela pode mudar sem nenhum impacto
em cálculo — por exemplo, uma versão "resumo de 1 página" (só capa +
resumo) ou uma futura apresentação em slides (1 bloco ≈ 1 slide) são só
outra função `build...Document` alternativa, lendo o MESMO
`AnalyticsReportData`, sem tocar em `report-data.ts` nem no renderer.
Também é o que mantém o Renderer "burro": ele nunca precisa saber o que é
uma "campanha" ou um "criativo" — só sabe desenhar um bloco `campaign-table`
ou `creative-cards`, dado o tipo. Isso empurra toda decisão de "o que é um
AnalyticsReport" pra um lugar só, testável sem HTML/CSS/PDF envolvidos.

## Camada 3 — `ReportTheme` (tema visual)

```ts
// src/lib/analytics-report/report-theme.ts

export interface ReportTheme {
  id: string;                  // "mitza" | "white_label" | futuro "partner_x"
  brandName: string | null;    // null = White Label, nenhum nome de marca aparece
  logoUrl: string | null;      // null = sem asset ainda; renderer cai pro fallback textual (ver abaixo)
  accentColor: string;         // cor de destaque do documento (nunca a marca MITZA hardcoded no renderer)
  showCoverBranding: boolean;  // capa institucional (MITZA) vs. capa neutra (White Label)
  footerText: string | null;   // null = sem rodapé institucional
}

export const REPORT_THEMES: Record<string, ReportTheme> = {
  mitza: {
    id: "mitza",
    brandName: "MITZA",
    logoUrl: null, // asset definitivo ainda não existe — ver "Logo institucional" abaixo
    accentColor: "#4169E1", // mesmo azul MITZA já usado na plataforma
    showCoverBranding: true,
    footerText: "Gerado por MITZA Analytics",
  },
  white_label: {
    id: "white_label",
    brandName: null,
    logoUrl: null,
    accentColor: "#18181B", // neutro (zinc-900) — sem cor de marca própria
    showCoverBranding: false,
    footerText: null,
  },
};
```

O renderer NUNCA lê `theme.id` pra decidir o que desenhar — só lê os campos
(`brandName`/`logoUrl`/`accentColor`/`showCoverBranding`/`footerText`).
Adicionar um tema novo ("Agência Parceira A") no futuro é adicionar uma
entrada nova em `REPORT_THEMES`, zero mudança no renderer — mesmo padrão já
usado em `PERFORMANCE_GOALS` (`lib/performance-goals.ts`).

### Logo institucional — decisão desta revisão

Sem bloquear a Fase 0/1 por causa disso: `logoUrl` começa `null` mesmo pro
tema `mitza`. O renderer da capa (Camada 4) trata `logoUrl: null` com o
MESMO padrão de degradação graciosa já usado em todo o resto da plataforma
(ex.: `CreativeThumbnail`) — sem logo configurado, mostra `brandName` como
texto ("MITZA" / "Analytics" empilhados), nunca quebra nem deixa a capa
vazia. Quando o SVG definitivo existir, é só preencher `logoUrl` — nenhuma
mudança estrutural no renderer.

### `clients.report_theme` — decisão desta revisão: cria já na Fase 1

Revisão anterior deste documento tratava isso como pré-requisito
futuro; nesta revisão, o usuário decidiu que o tema **pertence ao domínio
do cliente**, não ao botão de exportação nem ao relatório — por isso a
coluna é criada já na Fase 1, mesmo sem UI de seleção:

```sql
alter table clients add column if not exists report_theme text not null default 'mitza'
  check (report_theme in ('mitza', 'white_label'));
```

Todo cliente nasce/permanece `'mitza'` até uma UI de seleção existir
(Configurações > Clientes, mesmo padrão de `performance_goal` — fora do
escopo desta primeira implementação, ver Fase 4). A resolução do tema em
`resolveReportTheme(clientId)` já lê essa coluna desde a Fase 1, mesmo que
hoje ela só possa valer `'mitza'` na prática.

## Camada 4 — Renderer (documento + tema → formato)

**Decisão confirmada nesta revisão**: existe UM template visual canônico,
escrito em HTML/CSS — nunca dois templates (um "pra tela", um "pra PDF").
PDF é sempre HTML impresso; página compartilhável é sempre esse mesmo HTML
servido direto; e-mail (futuro) é uma versão resumida do mesmo HTML com um
link pra essa página.

```ts
// src/lib/analytics-report/renderers/html-renderer.tsx
export function renderReportHtml(document: AnalyticsReportDocument, theme: ReportTheme): string

// src/lib/analytics-report/renderers/pdf-renderer.ts
export async function renderReportPdf(html: string): Promise<Buffer>
```

`renderReportHtml` percorre `document.pages[].blocks[]` e desenha cada
bloco por `type` (um `switch`/dispatcher por tipo de bloco, nunca por
conceito de negócio) — layout de página impressa (`@page`, quebras via
`break-after: page`, tamanho A4, margens fixas), com stylesheet próprio,
mínimo e print-safe (sem `dark:`, sem depender de classe Tailwind acoplada
ao shell da aplicação — este documento tem um único estado visual,
"impresso"). `theme.showCoverBranding`/`theme.logoUrl`/`theme.brandName`
decidem só o que aparece no bloco `cover` e no rodapé — nenhum outro bloco
lê o tema condicionalmente além de `accentColor`.

`renderReportPdf` recebe o HTML já pronto e devolve um PDF — é a ÚNICA
peça que sabe que "PDF" existe.

### Técnica de renderização PDF — decisão confirmada: Chromium headless

```
AnalyticsReportDocument + Theme → HTML → (Chromium headless) → PDF
```

Confirmado nesta revisão, com a ressalva já prevista: sujeito à validação
real na Fase 0. Motivo da escolha (reafirmado pelo usuário): não é sobre
qualidade de PDF — é sobre nunca precisar de um segundo template.
`@react-pdf/renderer` foi descartado explicitamente por exigir seu próprio
sistema de layout (não é HTML/CSS real), o que recriaria, na prática, um
segundo frontend só pro relatório — exatamente a divergência estrutural
("no PDF ficou diferente da tela") que a restrição não-negociável deste
documento existe pra impedir.

| Técnica | A favor | Contra |
|---|---|---|
| **Chromium headless** (`puppeteer-core` + `@sparticuz/chromium`) — **escolhida** | Reaproveita o HTML/CSS exatamente como escrito; é o mesmo motor que serve a "página compartilhável" e o e-mail futuro — nenhum retrabalho | Function maior/mais lenta em serverless (cold start); precisa validar limite de tamanho/tempo do plano Vercel em uso — objeto da Fase 0 |
| `@react-pdf/renderer` — descartado | Leve, sem binário de Chromium | Layout próprio, não é HTML real — exigiria um segundo template |

## Camada 5 — Entrega (Server Action)

```ts
// src/app/clients/analytics-report-actions.ts
export async function exportAnalyticsReportAction(clientId: string, period: {start,end}, format: "pdf")
```

Fluxo completo: `buildAnalyticsReportData` → `buildAnalyticsReportDocument`
→ `resolveReportTheme(clientId)` → `renderReportHtml` → `renderReportPdf`
→ stream do PDF de volta pro navegador como download. **v1 não persiste
nada** — gerado sob demanda, sem armazenamento. "Link temporário"/"página
compartilhável" (visão de futuro) é uma adição de v2 que grava o HTML/PDF
no Supabase Storage com URL assinada expirável — custo marginal baixo
DEPOIS que o renderer HTML já existe, mas fora do escopo desta primeira
implementação.

## Estrutura de arquivos proposta

```
src/lib/analytics-report/
  report-data.ts           — AnalyticsReportData + buildAnalyticsReportData()
  report-document.ts        — AnalyticsReportDocument + buildAnalyticsReportDocument()
  report-theme.ts            — ReportTheme + REPORT_THEMES + resolveReportTheme()
  renderers/
    html-renderer.tsx         — template canônico único (React → HTML estático), dispatcher por block.type
    pdf-renderer.ts             — HTML → PDF (Chromium headless)
src/app/clients/
  analytics-report-actions.ts  — Server Action, aciona o botão "Exportar relatório"
supabase/
  clients-report-theme.sql      — migration da Fase 1 (clients.report_theme)
```

## Decisões arquiteturais desta proposta

- **AnalyticsReport é o produto; PDF é um formato** — nunca nomear
  internamente pelo formato de saída.
- **Restrição não-negociável**: nenhuma lógica própria no relatório — toda
  informação exibida reusa função já existente do Analytics.
- **Dado, estrutura, tema e renderização são camadas separadas**, cada uma
  só conhecendo a de baixo — `AnalyticsReportData` (dado) →
  `AnalyticsReportDocument` (páginas/blocos) → `ReportTheme` (config
  visual) → Renderer (formato final).
- **Um template, múltiplos formatos** — nunca um template por formato de
  saída. PDF é sempre "o HTML impresso", nunca uma reconstrução paralela.
- **Tema é dado, nunca lógica condicional no renderer** — o renderer lê
  campos de `ReportTheme`, nunca `if (theme.id === "mitza")`. Novo tema =
  nova entrada de configuração, zero mudança de código no renderer.
- **`clients.report_theme` é criada já na Fase 1** — o tema pertence ao
  domínio do cliente, não ao botão de exportação; existe mesmo sem UI de
  seleção, sempre `'mitza'` até essa UI existir.
- **Logo institucional não bloqueia a implementação** — `logoUrl: null`
  cai no mesmo padrão de degradação graciosa já usado na plataforma
  (fallback textual), trocado por asset real sem mudança estrutural.
- **v1 é stateless** — sem persistência de relatório gerado; armazenamento
  pra link compartilhável é uma etapa futura explícita, não implícita nesta.

## Fases de implementação propostas

- **Fase 0 — Validação técnica** (próximo passo, não iniciada): confirmar
  Chromium headless dentro do ambiente real de deploy (Vercel, região
  `gru1`) — teste mínimo HTML→PDF, medindo tamanho de function e tempo de
  resposta, antes de comprometer a arquitetura final da Camada 4.
- **Fase 1 — Dados, documento e tema**: `report-data.ts` (reaproveitando
  100% das funções já existentes), `report-document.ts`, `report-theme.ts`
  (os dois temas definidos) **e a migration `clients.report_theme`**
  (criada nesta fase, mesmo sem UI de seleção).
- **Fase 2 — Template HTML**: `html-renderer.tsx`, validado abrindo o HTML
  bruto no navegador antes de qualquer PDF — garante que o template em si
  está certo antes de somar a variável "conversão pra PDF".
- **Fase 3 — PDF e wiring**: `pdf-renderer.ts` + Server Action + religar o
  botão "Exportar relatório" (hoje "Em breve") no `AnalyticsHubHeader`.
- **Fase 4 — Fora de escopo por enquanto**: link compartilhável (Supabase
  Storage + URL assinada), e-mail, seletor de tema por cliente na UI de
  Configurações, temas de parceiros adicionais, outros formatos (ex.:
  apresentação).

## Decisões confirmadas nesta rodada de revisão

1. **Chromium headless**, confirmado — sujeito à validação da Fase 0.
2. **Logo institucional**: não bloqueia — `logoUrl: null` com fallback
   textual até o asset definitivo existir.
3. **`clients.report_theme`**: criada já na Fase 1, `'mitza'` como padrão,
   sem UI de seleção ainda.
4. **Camada `AnalyticsReportDocument`** adicionada entre dado e tema.
5. **Restrição não-negociável de reuso de lógica** formalizada como seção
   própria do documento.

Nenhuma pergunta em aberto bloqueando o início da Fase 0.
