# Platform Feel — Auditoria de Percepção

## Objetivo do documento

Registro da etapa "MITZA Platform Feel 1.0" — uma auditoria de
EXPERIÊNCIA, não de código. Enquanto `PLATFORM_INTEGRITY.md` responde "a
plataforma se comporta de forma consistente?", este documento responde
"como a plataforma FAZ o gestor se sentir?". Complementar, não substitui
nenhum dos dois.

Convenção: cada nota é a leitura de quem já usou a plataforma
intensamente ao longo de dezenas de etapas anteriores — não é medição
instrumentada (não há sessão de usuário gravada nesta rodada), é
avaliação de produto informada por como cada tela foi desenhada e por
onde a linguagem visual/motion já documentada (`ARCHITECTURE_PRINCIPLES.md`
Caps. 22-28, `globals.css`) se aplica ou não de forma pareja.

---

## PARTE 1 — Platform Feel Audit (por área)

**Visão Geral** — a primeira tela do dia. Feel: *organizada, mas ainda
densa*. Depois de várias rodadas de "Refinamento de Densidade" ela
consegue mostrar Resultados, Investimento, Indicadores e Prioridades sem
rolar demais — isso transmite controle. O que ainda pesa: a tabela por
gestor no fim da página compete com o bloco de Prioridades por atenção
(os dois "gritam" no mesmo nível visual), então o olhar não sabe
imediatamente qual dos dois é a ação do dia.

**Clientes** — feel *utilitário, neutro*. Cumpre bem seu papel de lista/
filtro, mas não comunica nada além disso — não é ruim, só não tem
personalidade própria (aceitável para uma tela de navegação pura).

**Sprint Atual (Sprints)** — feel *o mais maduro da plataforma*. Depois
de Interaction Engine + Context Memory, esta é a única tela onde o gestor
realmente sente "a interface trabalha comigo": concluir uma tarefa é
instantâneo, o scroll não pula, o card que estava aberto continua aberto.
É o padrão-ouro contra o qual todas as outras telas deveriam ser medidas.

**Mensal / Relatórios** — feel *pesado, de formulário*. Muitas seções
sequenciais (Resumo, Performance, Execução, Comportamento por sprint,
Linha do tempo, Análise do gestor, Pendências, Próximos passos, Status) —
tecnicamente organizado, mas percebido como "preencher um relatório", não
como usar um produto. É a tela que mais se parece com trabalho
administrativo puro.

**Cliente (página individual)** — feel *investigativo, mas correto*. É
deliberadamente uma tela de profundidade (Manifesto Cap. 16), então
alguma densidade é esperada e até desejável — o gestor que abre a página
de um cliente já decidiu que quer se aprofundar.

**Equipe** — feel *administrativo simples*. Tabela + drawer, sem
fricção perceptível, mas também sem nenhum polimento de "prazer" — é a
tela mais "só funciona" da plataforma.

**Configurações** — feel *técnico*, apropriado pro público (só admin).

**Sidebar** — feel *estável e discreta* — o elemento da plataforma que
menos chama atenção pra si mesma, o que é exatamente o objetivo (Manifesto
Cap. 16 de `ARCHITECTURE_PRINCIPLES.md`).

**Drawers** — feel *consistente na entrada, inconsistente na saída*: só
um drawer (tarefa, na tela Sprints) anima ao fechar; os outros somem
abruptamente. Perceptível para quem usa vários drawers na mesma sessão.

**Popovers/Menus** — feel *leve e correto* — nascem do próprio botão,
nunca deslizam de lugar nenhum.

**Tooltips** — antes desta etapa, o único elemento flutuante que
aparecia sem nenhuma transição (feel *seco*, destoando do resto).
Corrigido nesta etapa (ver Parte 10).

**Toasts** — antes desta etapa, desaparecia de um frame pro outro (feel
*abrupto*) enquanto tudo mais que "sai de cena" na plataforma (drawer,
linha excluída) tinha uma transição de saída. Corrigido nesta etapa.

**Context Memory** — feel *mágico quando funciona* (voltar da tela de
tarefa e encontrar tudo exatamente como estava), mas só existe em
Sprints — nas outras telas com conteúdo expansível (Cliente, Relatórios)
sua ausência não é sentida como bug, só como uma tela "mais simples".

**Interaction Engine** — feel *confiável* nos poucos lugares onde já
está — concluir/excluir tarefa, comentar, editar objetivo. A inconsistência
é de COBERTURA, não de qualidade: onde existe, é ótimo; onde não existe
(criar cliente, registrar revisão), a espera por redirect quebra o ritmo
que o resto da plataforma já construiu.

---

## PARTE 2 — Flow Audit (por impacto)

1. **Maior impacto** — criar/editar tarefa e criar/editar cliente exigem
   sair da tela atual pra uma página cheia, mesmo sendo operações
   frequentes — quebra de continuidade real (Manifesto Cap. 18/20).
2. Registrar revisão de conta é um fluxo de formulário completo (drawer),
   mas sem o retorno instantâneo que o resto do Interaction Engine já
   entrega — o gestor espera um pouco mais que o esperado depois de anos
   de uso do resto da plataforma.
3. A tela de Relatórios exige rolar por 8+ seções sequenciais sem nenhum
   atalho — informação real, mas apresentada como se fosse tudo igualmente
   urgente.
4. Nenhuma confirmação desnecessária foi encontrada nos fluxos otimistas
   já existentes (excluir tarefa pede confirmação inline — apropriado,
   destrutivo). Nenhuma confirmação FALTANDO foi encontrada onde deveria
   haver.
5. Nenhum clique duplicado real foi encontrado (o padrão "linha inteira
   clicável" já resolveu isso em Sprints).

---

## PARTE 3 — Rhythm Audit

**Achado central**: quatro animações de entrada (`mitza-backdrop-in`,
`mitza-panel-in`, `mitza-toast-in`, `mitza-menu-in`) usavam valores de
duração/curva escritos à mão (`150ms ease-out`, `180ms ease-out`, `180ms
ease-out`, `120ms ease-out`) — de uma etapa anterior ao sistema de tokens
(`--motion-*`/`--ease-enter`/`--ease-exit`). Tudo que veio DEPOIS
("Interaction Physics 1.0" em diante: modal, saída de drawer, saída de
linha, pressable, chevron) já usa os tokens. Resultado: a curva de
aceleração real (`ease-out` genérico do navegador vs. `--ease-enter`,
uma cubic-bezier própria) diferia entre os elementos mais antigos e mais
novos — sutil, mas é exatamente o tipo de inconsistência que "ritmo único"
deveria eliminar. Corrigido nesta etapa (ver Parte 10).

**Tooltip sem entrada, Toast sem saída** — os dois casos concretos onde a
"família" de movimento simplesmente não existia. Corrigidos.

**Accordion** — abertura anima (grid-template-rows) só no protótipo
piloto de UMA sprint; todo o resto dos accordions da plataforma abre/
fecha instantaneamente. Isso é uma decisão já registrada (não uma
inconsistência nova) — mantido como está, fora do escopo desta etapa
(generalizar exigiria mudança estrutural).

---

## PARTE 4 — Confidence Audit

Onde o Interaction Engine já existe (concluir/excluir tarefa, comentar,
editar objetivo, campos inline): confirmação imediata e proporcional —
nem excessiva, nem insuficiente. Onde ainda depende de redirect (criar
tarefa/cliente, registrar revisão, relatórios): o gestor tem que esperar
a página recarregar pra saber que deu certo — não é dúvida sobre SE
funcionou, é uma fração de segundo a mais de espera que o resto da
plataforma já eliminou, o que faz esse atraso ser mais perceptível por
contraste. Nenhum feedback exagerado foi encontrado em lugar nenhum.

---

## PARTE 5 — Cognitive Load Audit

A Visão Geral e a tela de Relatórios são as duas com mais informação
simultânea. Na Visão Geral, a densidade já foi trabalhada em várias
etapas anteriores e está no ponto — o risco atual não é volume, é
HIERARQUIA (Prioridades vs. tabela por gestor competindo, ver Parte 1).
Em Relatórios, o volume é inerente ao que a tela precisa comunicar
(fechamento mensal) — não há corte óbvio sem perder informação real.
Nada foi identificado como candidato claro a "desaparecer" ou "virar
automático" sem tocar em regra de negócio — esse tipo de corte pertence a
uma etapa de produto, não a uma etapa de "feel".

---

## PARTE 6 — Visual Weight Audit (listado, não alterado)

- Tabela por gestor na Visão Geral — mesmo peso visual do bloco de
  Prioridades, competindo por atenção.
- Sequência de 8+ seções da tela de Relatórios — nenhuma se destaca como
  "a mais importante agora".
- Nenhum elemento foi encontrado "parecendo um dashboard" fora de
  contexto — a linguagem `overview-*` já é consistente onde usada.

---

## PARTE 7 — Perception Audit

O sistema parece **rápido e confiável** nas telas que já passaram pelo
Interaction Engine (Sprints, e agora comentário/concluir tarefa em
qualquer lugar). Parece **"apenas funciona"** — correto, mas não
memorável — nas telas administrativas (Equipe, Configurações) e no fluxo
de Relatórios. Não parece pesado em lugar nenhum (a densidade nunca virou
poluição), mas também ainda não parece uniformemente "premium": os dois
pontos que quebravam a sensação de produto cuidado (tooltip sem entrada,
toast sumindo abruptamente) eram pequenos, mas exatamente o tipo de
detalhe que separa "funciona" de "parece caro".

---

## PARTE 8 — Microfrustrações encontradas

| Local | Causa | Impacto | Frequência | Proposta | Risco |
|---|---|---|---|---|---|
| Tooltip (qualquer tela) | Aparece sem transição, único elemento flutuante assim | Baixo, mas contínuo | Alta (hover é comum) | Animação de entrada consistente com popovers | Baixíssimo — **implementado** |
| Toast (qualquer tela) | Desaparece sem transição | Baixo, mas contínuo | Alta (toda mutação com feedback) | Animação de saída simétrica à entrada | Baixo — **implementado** |
| Backdrop/Painel/Menu (drawers e popovers) | Curva de animação diferente (`ease-out` genérico) do resto da plataforma | Muito baixo isoladamente, cumulativo | Alta | Migrar pros tokens `--ease-enter` | Baixíssimo — **implementado** |
| Criar/editar tarefa e cliente | Página cheia + redirect, sem resposta instantânea | Médio | Média (menos frequente que concluir tarefa) | Migrar pro Interaction Engine | Alto — **não implementado nesta etapa** (estrutural) |
| Registrar revisão de conta | Mesma espera de redirect | Médio | Média | Idem | Alto — **não implementado** |
| Prioridades vs. tabela por gestor (Visão Geral) | Mesmo peso visual, competem por atenção | Médio | Alta (primeira tela do dia) | Redesenhar hierarquia entre os dois blocos | Médio — **não implementado** (mudança de layout, fora do escopo desta etapa) |

---

## PARTE 9 — Platform Feel Score

| Dimensão | Nota | Justificativa |
|---|---|---|
| Flow | 7 | Sprints é exemplar; criar/editar tarefa/cliente ainda quebra continuidade. |
| Rhythm | 8 (era 6) | Corrigidas as 4 animações fora do token system + tooltip/toast — família agora coerente. |
| Confidence | 8 | Onde o Interaction Engine existe, é sólido; onde não existe, a espera é curta mas perceptível por contraste. |
| Continuity | 7 | Context Memory só em Sprints; resto das telas perde scroll/expansão ao navegar. |
| Cognitive Load | 7 | Densidade já bem trabalhada; hierarquia da Visão Geral é o ponto fraco. |
| Motion | 8 (era 6) | Mesma correção da Rhythm — motion agora é uma linguagem única, não duas coexistindo. |
| Responsiveness | 8 | Nenhum loading desnecessário encontrado; padrão de pending é consistente onde existe. |
| Interaction | 7 | Cobertura do Interaction Engine ainda parcial (ver Wave 2/3). |
| Consistency | 8 | Wave 1/2 já resolveram a maior parte; Rhythm era o resíduo visível restante. |
| Premium Feel | 7 (era 6) | Os dois detalhes que mais "denunciavam" um produto incompleto (tooltip, toast) foram corrigidos. |

**Média geral: 7,5/10** (era ~6,8 antes desta etapa).

---

## Melhorias implementadas nesta etapa

Ver commit "Platform Feel 1.0 — Implementation": unificação das 4
animações de entrada (`mitza-backdrop-in`, `mitza-panel-in`,
`mitza-toast-in`, `mitza-menu-in`) para os tokens `--motion-*`/
`--ease-enter`; animação de entrada nova para o Tooltip
(`mitza-tooltip-in`); animação de saída nova para o Toast
(`mitza-toast-out`, com desmonte adiado até ela terminar).

## Recomendações para Platform Feel 2.0

1. Resolver a hierarquia visual entre Prioridades e a tabela por gestor
   na Visão Geral (mudança de layout — fora do escopo de uma etapa
   "somente feel").
2. Estender o Interaction Engine para criar/editar tarefa, criar/editar
   cliente e registrar revisão de conta (mudança estrutural — candidata
   de Wave 3 da Constituição, não desta etapa).
3. Estender Context Memory além da tela Sprints (Cliente, Relatórios).
4. Avaliar dar entrada animada ao accordion fora do piloto único
   existente hoje.
