# Exportação do Analytics — Documento de Arquitetura

## Status

**Proposta — não implementada.** Este documento existe pra ser discutido e
aprovado antes de qualquer linha de código (pedido explícito do usuário:
"essa funcionalidade vai ficar na plataforma por anos, vale gastar uma hora
desenhando ela"). Nenhuma implementação começa até este desenho ser
validado.

## Objetivo da arquitetura

Fazer o botão "Exportar relatório" do hub de Analytics gerar um documento
executivo de verdade — não um print da tela, não uma segunda cópia dos
cálculos — e desenhar essa geração de um jeito que sirva pra qualquer
formato de saída futuro (PDF hoje; página compartilhável, link temporário,
e-mail, impressão amanhã) sem reescrever nada quando esses formatos forem
adicionados.

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
web, e-mail) exigir reescrever tudo de novo. O pedido explícito do usuário
foi o oposto: separar **geração dos dados**, **estrutura do documento**,
**tema visual** e **renderização**, do mesmo jeito que o resto da MITZA já
separa configuração de lógica (ex.: `PERFORMANCE_GOALS`,
`import_sources` — nenhum `if (objetivo === "leads")`/`if (fonte === "X")`
espalhado pelo código; aqui, nenhum `if (tema === "mitza")` espalhado pelo
renderizador).

## Visão geral do fluxo

```
Analytics (hub, período selecionado)
        │
        ▼
AnalyticsReportBuilder            — monta o conteúdo, sem saber de tema/formato
        │
        ▼
AnalyticsReportData                — estrutura única, serializável, sem HTML/CSS
        │
        ▼
ReportTheme                        — MITZA | White Label | (futuro: parceiro X)
        │
        ▼
Renderer                           — HTML (canônico) → PDF | página | e-mail (futuro)
```

Quatro camadas, cada uma só conhece a de baixo — nunca a de cima, nunca uma
camada pula outra:

1. **Dados** não sabe que existe tema ou formato de saída.
2. **Tema** não sabe que existe PDF ou HTML — é só um objeto de configuração
   (logo, nome de marca, cor de destaque, o que mostrar/esconder).
3. **Renderer** recebe dados + tema já prontos e só decide como desenhar.

## Camada 1 — `AnalyticsReportData` (geração dos dados)

Estrutura única, a mesma pra qualquer tema e qualquer formato de saída —
nunca "a versão PDF dos dados" e "a versão tela dos dados" divergindo.

```ts
// src/lib/analytics-report/report-data.ts

export interface AnalyticsReportData {
  client: {
    id: string;
    name: string;
  };
  period: {
    start: string;
    end: string;
    label: string; // já formatado, ex.: "1 a 31 de julho de 2026"
  };
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

**Regra não-negociável desta camada**: `buildAnalyticsReportData` nunca
recalcula nada com uma fórmula própria — ela chama exatamente as mesmas
funções puras que já alimentam o hub na tela (`fetchClientAnalyticsData`,
`buildAnalyticsHero`, `buildResultHeadline`, `buildResultLede`,
`buildAnalyticsKpiCards`, `buildLearningsNarrative`, `buildPeriodHighlights`,
`buildCreativeSummaries`, `buildCampaignSummaries`). Isso garante, por
construção, que o relatório NUNCA diz um número diferente do que a tela
mostra — mesma garantia que a MITZA já sustenta entre Analytics e Reports
hoje (Decisão 007 — Fonte única da verdade, `docs/DECISIONS.md`). Se um
número no PDF algum dia divergir da tela, é sempre um bug de wiring
(chamando a função errada), nunca uma segunda fórmula desalinhada.

Sem nenhuma tabela nova — `AnalyticsReportData` é montada em tempo de
requisição a partir das mesmas fontes de sempre (`daily_spend`,
`daily_performance`/`performance_records`, `ad_creative_daily_metrics`).
Nada é persistido nesta camada.

## Camada 2 — `ReportTheme` (tema visual)

```ts
// src/lib/analytics-report/report-theme.ts

export interface ReportTheme {
  id: string;                     // "mitza" | "white_label" | futuro "partner_x"
  brandName: string | null;       // null = White Label, nenhum nome de marca aparece
  logoUrl: string | null;         // null = sem logo na capa/rodapé
  accentColor: string;            // cor de destaque do documento (nunca a marca MITZA hardcoded no renderer)
  showCoverBranding: boolean;     // capa institucional (MITZA) vs. capa neutra (White Label)
  footerText: string | null;      // null = sem rodapé institucional
}

export const REPORT_THEMES: Record<string, ReportTheme> = {
  mitza: {
    id: "mitza",
    brandName: "MITZA",
    logoUrl: "/mitza-logo.svg", // a definir — precisa existir como asset público
    accentColor: "#4169E1",     // mesmo azul MITZA já usado na plataforma
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

### Como o tema é resolvido pra um cliente — lacuna real, sinalizada aqui

Hoje **não existe, em nenhuma tabela, um sinal de qual tema um cliente
deveria usar**. `organizations` existe desde a Etapa 55 (preparação
multi-agência), mas só tem uma linha semeada ("Organização principal") e
não é referenciada por `clients`; White Label é uma decisão por CLIENTE
("clientes atendidos através de parceiros e terceirizações"), não por
organização inteira. Antes deste tema poder ser escolhido de verdade, falta
uma migration simples:

```sql
alter table clients add column if not exists report_theme text not null default 'mitza'
  check (report_theme in ('mitza', 'white_label'));
```

configurável em Configurações > Clientes (mesmo padrão de
`performance_goal`). **Isso não faz parte desta etapa de arquitetura** — só
fica registrado aqui porque é um pré-requisito real: sem essa coluna, os
dois temas existem e são testáveis no código, mas todo cliente sai sempre
como `mitza` até a coluna existir e alguém marcar um cliente como
`white_label`.

## Camada 3 — Renderer (estrutura do documento + renderização)

**Decisão central desta arquitetura**: existe UM template visual canônico,
escrito em HTML/CSS — nunca dois templates (um "pra tela", um "pra PDF").
PDF é sempre HTML impresso; página compartilhável é sempre esse mesmo HTML
servido direto; e-mail (futuro) é uma versão resumida do mesmo HTML com um
link pra essa página. Escrever o template uma vez, em HTML, é o que permite
"nunca mais reconstruir um relatório" — só adicionar um jeito novo de
entregar o mesmo HTML.

```ts
// src/lib/analytics-report/renderers/html-renderer.tsx
export function renderReportHtml(data: AnalyticsReportData, theme: ReportTheme): string

// src/lib/analytics-report/renderers/pdf-renderer.ts
export async function renderReportPdf(html: string): Promise<Buffer>
```

`renderReportHtml` é um componente React renderizado pra string estática
(`renderToStaticMarkup`) — layout de página impressa (`@page`, quebras de
página via `break-after: page`, tamanho A4, margens fixas), com seu próprio
stylesheet mínimo e print-safe (sem `dark:`, sem depender de nenhuma classe
Tailwind acoplada ao shell da aplicação — este documento tem um único
estado visual, "impresso", nunca dois temas de sistema). Estrutura de
páginas (baseada no exemplo do usuário):

1. Capa — nome do cliente, "Analytics", período. Logo/nome de marca só
   quando `theme.showCoverBranding`.
2. Resumo Executivo — headline, lide, KPIs, gráfico de evolução.
3. Destaques do período — os mesmos cards de "O que mais chamou atenção".
4. Criativos — cards organizados (mesmo corte de dado da tela).
5. Campanhas — tabela consolidada.
6. Aprendizados e Oportunidades — "O que aprendemos" + "Oportunidades".
7. Rodapé (todas as páginas) — `theme.footerText`, quando existir.

`renderReportPdf` recebe esse HTML já pronto e devolve um PDF — é a ÚNICA
peça que sabe que "PDF" existe. Duas técnicas possíveis, com trade-offs
reais (a decidir antes da Fase 0 de implementação, não neste documento):

| Técnica | A favor | Contra |
|---|---|---|
| **Chromium headless** (`puppeteer-core` + `@sparticuz/chromium`) | Reaproveita o HTML/CSS exatamente como escrito (mesma fidelidade tipográfica, `@page`/quebras reais); é o mesmo motor que vai servir a "página compartilhável" — nenhum retrabalho | Function maior/mais lenta em serverless (cold start); precisa validar limite de tamanho/tempo do plano Vercel em uso |
| **`@react-pdf/renderer`** (sem navegador) | Leve, previsível em serverless, sem binário de Chromium | Sistema de layout próprio (não é HTML/CSS real) — exigiria um SEGUNDO template, só pra PDF, quebrando a decisão central acima |

**Recomendação preliminar**: Chromium headless, exatamente porque preserva
"um template só" — é a opção que sustenta o pedido do usuário de nunca
reconstruir o relatório pra cada formato novo. A ser confirmado com uma
Fase 0 de validação técnica (ver "Fases de implementação") antes de
comprometer a arquitetura final.

## Camada 4 — Entrega (Server Action)

```ts
// src/app/clients/analytics-report-actions.ts
export async function exportAnalyticsReportAction(clientId: string, period: {start,end}, format: "pdf")
```

Fluxo: `buildAnalyticsReportData` → `resolveReportTheme(clientId)` →
`renderReportHtml` → `renderReportPdf` → stream do PDF de volta pro
navegador como download. **v1 não persiste nada** — gerado sob demanda,
sem armazenamento. "Link temporário"/"página compartilhável" (pedido do
usuário como visão de futuro) é uma adição de v2 que grava o HTML/PDF no
Supabase Storage com URL assinada expirável — custo marginal baixo DEPOIS
que o renderer HTML já existe, mas fora do escopo desta primeira
implementação.

## Estrutura de arquivos proposta

```
src/lib/analytics-report/
  report-data.ts          — AnalyticsReportData + buildAnalyticsReportData()
  report-theme.ts          — ReportTheme + REPORT_THEMES + resolveReportTheme()
  renderers/
    html-renderer.tsx       — template canônico único (React → HTML estático)
    pdf-renderer.ts          — HTML → PDF (Chromium headless)
src/app/clients/
  analytics-report-actions.ts  — Server Action, aciona o botão "Exportar relatório"
```

## Decisões arquiteturais desta proposta

- **Um template, múltiplos formatos** — nunca um template por formato de
  saída. PDF é sempre "o HTML impresso", nunca uma reconstrução paralela.
- **Dados nunca recalculados** — o relatório chama as mesmas funções puras
  já usadas pela tela do Resumo Executivo/Criativos/Campanhas, nunca uma
  segunda fórmula. Mesma garantia de "fonte única da verdade" já
  documentada em `docs/DECISIONS.md` (Decisão 007).
- **Tema é dado, nunca lógica condicional no renderer** — o renderer lê
  campos de `ReportTheme`, nunca `if (theme.id === "mitza")`. Novo tema =
  nova entrada de configuração, zero mudança de código no renderer.
- **Nenhuma tabela nova nesta etapa** — `AnalyticsReportData` é sempre
  montada em tempo de requisição; a única mudança de schema prevista
  (`clients.report_theme`) é um pré-requisito sinalizado, não parte desta
  proposta de arquitetura.
- **v1 é stateless** — sem persistência de relatório gerado; armazenamento
  pra link compartilhável é uma etapa futura explícita, não implícita nesta.

## Fases de implementação propostas (nenhuma iniciada ainda)

- **Fase 0 — Validação técnica**: confirmar a técnica de renderização PDF
  dentro do ambiente real de deploy (Vercel, região `gru1`) — um teste
  mínimo HTML→PDF via Chromium headless, medindo tamanho de function e
  tempo de resposta, antes de comprometer a arquitetura final da Camada 3.
- **Fase 1 — Dados e tema**: `report-data.ts` (reaproveitando 100% das
  funções já existentes) + `report-theme.ts` (os dois temas definidos,
  resolução fixa em `"mitza"` até a coluna `clients.report_theme` existir).
- **Fase 2 — Template HTML**: `html-renderer.tsx`, validado abrindo o HTML
  bruto no navegador antes de qualquer PDF — garante que o template em si
  está certo antes de somar a variável "conversão pra PDF".
- **Fase 3 — PDF e wiring**: `pdf-renderer.ts` + Server Action + religar o
  botão "Exportar relatório" (hoje "Em breve") no `AnalyticsHubHeader`.
- **Fase 4 — Fora de escopo por enquanto**: link compartilhável (Supabase
  Storage + URL assinada), e-mail, seletor de tema por cliente na UI de
  Configurações, temas de parceiros adicionais.

## Perguntas em aberto pra validar antes da Fase 0

1. Confirma a recomendação de Chromium headless (`puppeteer-core` +
   `@sparticuz/chromium`) sobre `@react-pdf/renderer`, mesmo com o custo
   de function maior em serverless?
2. O logo institucional da MITZA (`theme.mitza.logoUrl`) já existe como
   asset, ou precisa ser criado/fornecido antes da Fase 2?
3. `clients.report_theme` (a coluna nova sinalizada acima) deve ser criada
   junto com a Fase 1, mesmo sem UI de seleção ainda (deixando todo cliente
   fixo em `"mitza"` por enquanto), ou só quando a UI de seleção também for
   implementada?
