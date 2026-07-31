# AnalyticsReport — Resultados da Fase 0 (validação técnica)

## Pergunta que esta fase respondia

"Chromium Headless é viável pra arquitetura que queremos?" — nada além
disso. Sem `AnalyticsReportData`/`Document`/`Theme`, sem dado real do
Analytics, sem botão de exportação. Ver escopo completo em
`docs/ANALYTICS_REPORT_EXPORT_ARCHITECTURE.md`.

## Biblioteca utilizada

- **`puppeteer-core@25.4.0`** — driver do protocolo Chrome DevTools, sem
  baixar um Chromium próprio (usa o binário do `@sparticuz/chromium`).
- **`@sparticuz/chromium@149.0.0`** — build de Chromium empacotado
  especificamente pra AWS Lambda/serverless (Vercel usa o mesmo runtime por
  baixo), ~62MB comprimido (Brotli), decodificado sob demanda em `/tmp`
  na primeira chamada.

Ambas adicionadas como dependências reais do projeto (`package.json`) —
não descartadas ao fim da Fase 0, porque são exatamente o que a Fase 1 em
diante vai usar.

## Como foi executado

Script isolado, fora de qualquer rota da aplicação:
`scripts/analytics-report-phase0/generate-test-pdf.ts`
(`npm run analytics-report:phase0`).

Gera uma página HTML de teste 100% autocontida — nenhum dado do Analytics,
nenhuma chamada de rede — e mede cada etapa:

1. **Fontes**: 2 famílias reais (Crimson Pro serifada + Bricolage Grotesque
   sem serifa), cada uma incorporada via `@font-face` + `data:` URI
   (regular + bold) — mesma técnica que o `html-renderer.tsx` real vai usar.
2. **Imagem**: um SVG existente do próprio projeto (`public/globe.svg`),
   incorporado como `data:image/svg+xml;base64`.
3. **Gráfico**: barras simples em CSS/SVG puro (proxy pro
   `AnalyticsTrendChart` real).
4. **Tabela**: layout de campanhas (nome, investimento, resultado, CPA) —
   mesmo formato da sub-seção Campanhas.
5. **Quebra de página**: `@page { size: A4; margin: 20mm 18mm }` +
   `break-after: page`, com uma seção de 18 parágrafos repetidos
   deliberadamente forçando overflow pra mais de 1 página física.
6. **Rodapé dinâmico**: `displayHeaderFooter` + `footerTemplate` com
   `pageNumber`/`totalPages` — mesmo mecanismo que o rodapé institucional
   (`theme.footerText`) vai usar.

Cada fase foi cronometrada (`performance.now()`) e a memória real do
processo do Chromium (não do processo Node.js orquestrador — são processos
do SO separados) somada via `ps` sobre a árvore de processos.

Executado 6 vezes (3 antes + 3 depois de um ajuste de `waitUntil`, ver
"Limitações encontradas") no ambiente local (Linux x86_64, Node 22) — **não**
num deploy Vercel real (ver "Compatibilidade com Vercel" abaixo pra essa
ressalva importante).

## Tempo médio de geração

De 3 execuções consecutivas, na configuração final:

| Etapa | Tempo médio |
|---|---|
| Resolver `executablePath()` do Chromium | 0 ms (binário já extraído em `/tmp` após a 1ª execução) |
| `browser.launch()` | ~70 ms |
| `page.setContent()` (HTML autocontido) | ~110 ms |
| `page.pdf()` | ~45 ms |
| **Total (fim a fim)** | **~400 ms** |

## Tamanho médio do PDF

**54 KB**, 5 páginas (capa + resumo + campanhas + 2 páginas de texto de
teste que forçaram a quebra). Fontes/imagem embutidas estão incluídas
nesse tamanho — nada é referenciado externamente.

## Limitações encontradas

1. **`page.pdf()` devolve `Uint8Array`, não `Buffer`**, em versões
   recentes de `puppeteer-core` — `Uint8Array.prototype.toString(encoding)`
   ignora o argumento e quebra qualquer inspeção de conteúdo (silenciosamente,
   sem erro) até envolver em `Buffer.from(...)`. Só afetou o script de
   diagnóstico deste spike (contagem de páginas), não a geração do PDF em
   si — mas é uma pegadinha real a documentar pra quem for escrever
   `pdf-renderer.ts` na Fase 3.
2. **`waitUntil: "networkidle0"` custava ~900ms extras por geração**, mesmo
   com HTML 100% autocontido (sem nenhuma requisição de rede) — Chromium
   espera a janela de silêncio de rede de qualquer forma. Trocado pra
   `waitUntil: "load"`, consistente com a premissa arquitetural de que o
   template real nunca depende de recursos externos — resultado: tempo
   total caiu de ~1.3s pra ~400ms. **Decisão registrada pra Fase 2**: o
   `html-renderer.tsx` real deve manter essa mesma garantia (tudo embutido),
   e `pdf-renderer.ts` deve usar `"load"`, nunca `"networkidle0"`.
3. **`process.memoryUsage()` do processo Node não mede o Chromium** — o
   navegador roda num processo do SO separado (`browser.process()`), então
   a métrica de memória precisou somar a árvore de processos via `ps`
   (implementado no próprio script). Isso não é uma limitação da
   tecnologia, só uma pegadinha de instrumentação — mas relevante pra quem
   for medir isso de novo no futuro (ex.: dentro de uma function real,
   onde `ps` pode não estar disponível — a métrica de memória de produção
   deve vir dos logs/observabilidade da própria Vercel, não replicar esse
   truque).
4. **`@sparticuz/chromium.headless` não existe como propriedade** na versão
   testada (só `args`/`graphics`/`executablePath`) — a API mudou desde
   versões mais antigas documentadas em tutoriais desatualizados. Usar
   `headless: true` no `puppeteer.launch()` funciona (o binário já embute
   as flags de headless nos seus próprios `args`).
5. **Binário decompacta ~191MB em `/tmp`** na primeira execução (a partir
   dos ~62MB comprimidos em Brotli que vêm no pacote). Bem dentro de
   limites típicos de `/tmp` em serverless, mas é o número real, não uma
   estimativa.
6. **`import.meta.dirname` + `readFileSync` pra ler assets (fontes/imagem)
   quebra o build do Next.js** quando o arquivo que lê está fora de `src/`
   — o build falhou com `TypeError: The "path" argument must be of type
   string. Received undefined` ao tentar empacotar a rota de smoke test
   apontando pros mesmos arquivos de fonte do script local. Causa: o
   Turbopack reescreve o caminho do módulo bundlado, então
   `import.meta.dirname` em tempo de execução não aponta mais pro
   diretório fonte original. **Decisão registrada pra Fase 2**: o
   `html-renderer.tsx` real vai precisar ler assets (se algum dia precisar
   de arquivo em disco, e não só `data:` URIs já prontos) via
   `path.join(process.cwd(), ...)` — nunca `import.meta.dirname`/
   `__dirname` — e, se necessário, declarar `outputFileTracingIncludes` no
   `next.config.ts` pra garantir que a Vercel empacote o arquivo junto da
   function. A rota de smoke test contornou isso simplesmente não lendo
   nenhum arquivo (`build-smoke-html.ts`, HTML 100% inline) — essa questão
   de empacotamento é ortogonal à pergunta "Chromium roda?", por isso não
   valia misturar as duas neste teste.

Nenhuma limitação encontrada quebra a arquitetura proposta — todas foram
contornáveis com o próprio Chromium headless, sem precisar de nenhum
componente adicional.

## Compatibilidade com Vercel

**Validado localmente com as bibliotecas exatas de produção — NÃO
validado num deploy Vercel real nesta sessão.** Esta sessão não tem acesso
a um deploy/projeto Vercel conectado a este repositório, então não foi
possível confirmar diretamente:

- Comportamento de cold start dentro do runtime específico da Vercel
  (pode diferir do ambiente local usado aqui).
- Se o tamanho do pacote da function (~75MB de `node_modules` só destas
  duas dependências, mais o resto da aplicação) permanece dentro do
  limite de deployment do plano em uso.
- Comportamento de `/tmp` gravável entre invocações frias no ambiente real
  da Vercel (localmente, `/tmp` é persistente entre execuções do mesmo
  processo; numa function serverless, cada cold start normalmente começa
  com `/tmp` vazio — então o custo de decompressão de ~191MB tende a
  acontecer a cada cold start real, não só uma vez).

O que FOI confirmado, com alta confiança de que se repete em produção
(mesmas bibliotecas, mesma arquitetura de processo, Linux x86_64 — a
mesma família de ambiente que a Vercel usa por baixo): o código roda,
gera PDF corretamente, com fontes/imagem/quebra de página/rodapé
funcionando, em ~400ms e ~50-160MB de RSS — números que cabem com folga
larga em qualquer configuração de memória de function da Vercel (padrão
de 1024MB).

**Rota de smoke test já preparada e validada localmente**:
`src/app/api/dev/analytics-report-phase0-smoke/route.ts` — mesma técnica
(Chromium headless), HTML de teste próprio sem leitura de arquivo
(`build-smoke-html.ts`, ver limitação 6), bloqueada em produção
(`VERCEL_ENV === "production"` → 404) e atrás do mesmo `CRON_SECRET` já
usado por outras rotas administrativas do projeto.

**Como rodar o smoke test real**: fazer deploy deste branch num Preview
Deployment da Vercel (automático, se o GitHub App da Vercel já estiver
instalado neste repositório) e chamar:

```
GET https://<preview-url>/api/dev/analytics-report-phase0-smoke?secret=<CRON_SECRET>
GET https://<preview-url>/api/dev/analytics-report-phase0-smoke?secret=<CRON_SECRET>&format=pdf
```

A primeira chamada devolve JSON com `timingsMs`/`pdf.sizeKb` (comparar com
os números desta página); a segunda devolve o PDF de verdade pra abrir no
navegador. Chamar uma vez a frio (primeiro acesso, mede cold start) e
outra em seguida (a quente). **Esta sessão não tem acesso a um deploy/
projeto Vercel conectado**, então essa chamada final precisa ser feita
por quem tiver acesso ao painel da Vercel — depois é só reportar os
números de volta pra fechar esta validação. Depois de confirmado, apagar
a rota inteira (`src/app/api/dev/analytics-report-phase0-smoke/`) — ela
nunca deve ir pra produção.

## Decisão final

**Aprovado, condicional a um smoke test real na Vercel antes da Fase 1.**

A tecnologia funciona exatamente como a arquitetura previa: HTML
autocontido → Chromium headless → PDF fiel (fontes/imagem/quebra de
página/rodapé corretos), rápido (~400ms) e leve (~160MB de pico, ~54KB de
saída). Nenhum limite técnico encontrado que invalide a decisão de
Chromium headless sobre `@react-pdf/renderer` — a vantagem central que
motivou essa escolha (um template único, reaproveitável pra PDF/HTML/
e-mail) se sustenta.

A única lacuna é que a validação aconteceu num ambiente local equivalente,
não no deploy Vercel real — por isso a aprovação é condicional a esse
smoke test, não incondicional. Se esse teste real confirmar os números
próximos aos daqui, a Fase 1 pode começar sem nenhuma outra ressalva.
