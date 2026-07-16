# Platform Operational Workspace — Execution First

## Objetivo do documento

Registro da etapa "MITZA Operational Workspace 1.0 — Execution First".
Diferente das etapas anteriores (Constitution, Integrity Waves, Feel), o
objetivo aqui não é consistência técnica nem percepção estética — é
**produtividade operacional**: transformar a página do cliente (a "Sprint",
no vocabulário já estabelecido nas etapas anteriores) de um painel de
informações num painel de execução, onde o gestor entende em menos de 2
segundos (1) o que precisa fazer agora, (2) o que já foi feito e (3) se a
conta está saudável — sem rolar a página nem expandir nada.

Escopo: `src/app/clients/[id]/page.tsx` e os componentes que ela monta
(`AccountFollowUpPanel`, `MonthInvestmentSummary`, `PerformanceSummarySection`,
`SprintCard`/`SprintCardBody`, `TaskList`, `EssentialInfoPanel`). Nenhuma
mudança em banco, regra de negócio, cálculo, integração ou permissão —
só posição, ordem, destaque, agrupamento, densidade e peso visual.

---

## PARTE 1 — Operational Audit

| Elemento | Categoria | Prioridade | Valor operacional | Frequência de uso | Espaço ocupado | Valor entregue |
|---|---|---|---|---|---|---|
| Identidade (nome + status + ações) | Contexto | Alta | Orientação básica | Toda visita | Pequeno | Alto |
| Ações do cabeçalho (Ver relatório/Editar/Atualizar Meta) | Configuração | Baixa | Utilitário | Ocasional | Pequeno | Médio |
| Seletor de mês | Contexto | Média | Navegação temporal | Ocasional (maioria fica no mês atual) | Pequeno | Médio |
| KPIs do mês (Investimento/Resultados/Custo) | Consulta | Média | Leitura, não-acionável | Alta | Médio | Alto, mas passivo |
| Última revisão de conta / reunião / entrega | Contexto | Média | Situacional | Alta | Médio | Alto |
| Histórico do mês (recolhido) | Histórico | Baixa | Auditoria | Baixa | Mínimo (colapsado) | Alto quando necessário, raro |
| Investimento do mês (planejado/realizado/barra/recomendação) | Consulta | Média-alta | Recomendação é acionável | Alta | Grande | Alto |
| Detalhes do investimento (recolhido) | Consulta | Baixa | Diagnóstico | Baixa | Mínimo (colapsado) | Médio |
| Performance do mês (secundário) | Consulta | Baixa | Comparação com meta | Baixa-média | Pequeno-médio | Médio |
| Sprint card — linha resumo | Consulta/Execução | Alta | Ponto de entrada | Alta | Pequeno | Alto |
| Performance da sprint (linha investido/resultado/custo/objetivo) | Consulta+Execução | Alta | Editável | Alta | Pequeno (já compacto) | Alto |
| Última execução (texto) | Contexto | Baixa | Situacional | Alta | Mínimo | Baixo-médio |
| **Próxima ação** | **Execução** | **Máxima** | **A resposta central da etapa** | Deveria ser a 1ª coisa vista | Mínimo | **Máximo** |
| Tarefas da sprint (lista + progresso) | Execução | Alta | Ação direta | Altíssima | Médio | Altíssimo |
| Otimizações/Revisões de conta da sprint | Execução | Média-alta | Ação direta | Média | Médio | Alto |
| Comentários (recolhido) | Histórico | Baixa | Contexto de equipe | Baixa | Mínimo | Médio |
| Outras tarefas (sem sprint) | Execução | Média | Ação direta | Baixa (maioria das tarefas tem sprint) | Variável | Médio |
| Informações essenciais (recolhido) | Configuração/Contexto estrutural | Baixíssima | Onboarding/referência | Rara | Mínimo | Alto quando necessário, raro no dia a dia |

**Achado central**: o único elemento com prioridade/valor operacional
**máximos** — Próxima Ação — é também o único cujo espaço ocupado e
posição no fluxo de leitura NÃO refletiam essa prioridade. Todo o resto da
tabela já estava razoavelmente bem calibrado pelas etapas anteriores
(Density/Feel/Integrity); o desalinhamento estava concentrado num ponto só.

---

## PARTE 2 — Hierarchy Audit

**Percurso visual ANTES** (ordem real em que o olho encontra cada coisa,
sem rolar nem expandir):

1. Nome do cliente + badge de status
2. Ações do cabeçalho (Ver relatório/Editar/Atualizar Meta)
3. Seletor de mês
4. KPIs (Investimento total / Resultados / Custo por resultado) — consulta
5. Última revisão de conta + reunião/entrega — contexto
6. Investimento do mês (texto + barra + recomendação) — consulta
7. Performance do mês (quando existe) — consulta
8. Título "Sprints de {mês}"
9. Linha resumo do card da sprint atual (já aberta por padrão)
10. Performance da sprint — consulta
11. "Última execução" — contexto
12. **Próxima ação** — 12º elemento, exige que os 11 anteriores já tenham
    sido processados pelo olho, mesmo com a sprint atual já expandida por
    padrão

**Resposta à pergunta da Parte 2**: não. A ordem real de leitura era
consulta → consulta → consulta → execução, exatamente o oposto da ordem
real de trabalho do gestor (que decide "o que eu faço agora" antes de
"como estão os números").

**Percurso visual DEPOIS**:

1. Nome do cliente + badge de status
2. Ações do cabeçalho
3. Seletor de mês
4. **Foco agora** — selo de ritmo do mês (saúde) + Próxima Ação com CTA
   primário — 4º elemento, sem rolar, sem expandir
5. Acompanhamento da conta (KPIs/contexto)
6. Investimento do mês
7. Performance do mês
8. Sprints (detalhe de execução — tarefas/otimizações)
9. Outras tarefas
10. Informações essenciais

Nenhum conflito de hierarquia identificado depois da mudança: cada bloco
abaixo do "Foco agora" é estritamente consulta/histórico, na mesma ordem
que já vinha sendo refinada pelas etapas anteriores.

---

## PARTE 3 — Execution Flow

Fluxo auditado: Abrir Sprint → Executar → Executar → Consultar → Fechar.

**Antes**: Abrir Sprint → Consultar (KPIs) → Consultar (Investimento) →
Consultar (Performance) → *finalmente* Executar (Próxima Ação, dentro do
card já expandido) → Executar (tarefas) → Fechar. Três blocos de consulta
interrompiam o fluxo antes da primeira ação ficar visível.

**Depois**: Abrir Sprint → Executar (Foco agora, CTA imediato) → Executar
(tarefas dentro da sprint) → Consultar (o resto, quando o gestor quiser) →
Fechar. Nenhuma informação de consulta foi removida — só deixou de ser a
primeira coisa no caminho de quem está tentando agir.

---

## PARTE 4 — Information Density

Índice qualitativo (valor operacional ÷ espaço ocupado), maior = melhor:

| Bloco | Espaço | Valor acionável | Índice |
|---|---|---|---|
| Foco agora (novo) | Mínimo | Máximo | Muito alto |
| Performance da sprint | Pequeno (já compactado em waves anteriores) | Alto | Alto |
| Sprint card — linha resumo | Pequeno | Alto | Alto |
| Tarefas da sprint | Médio | Altíssimo | Alto |
| KPIs do mês | Médio | Médio (passivo) | Médio |
| Investimento do mês | Grande | Médio-alto | Médio |
| Informações essenciais (recolhido) | Mínimo | Alto quando necessário | Alto (já bem resolvido) |

**Desperdício identificado**: nenhum bloco novo de desperdício — as etapas
de Densidade/Feel/Integrity anteriores já haviam comprimido a maior parte
da página (Performance da sprint reduzida ~50% em waves passadas,
detalhes de investimento/histórico já recolhidos por padrão). O único
desperdício real era estrutural, não visual: o espaço da primeira dobra
inteiro sendo ocupado por consulta enquanto a única informação acionável
da página não tinha espaço nenhum reservado ali.

---

## PARTE 5 — Primary Action

**Pergunta**: a Próxima Ação parece a ação principal? O gestor entende de
imediato que aquilo é o próximo passo?

**Resposta antes**: não. Ela vivia dentro do card da sprint (que exige
scroll pra alcançar), usava o mesmo estilo visual (`SECONDARY_ACTION_BUTTON_CLASSES`
— borda cinza) de toda ação secundária da página (Cancelar, Excluir,
Registrar otimização, + Tarefa) — ou seja, a ação mais importante da tela
tinha exatamente o mesmo peso visual que as mais triviais.

**Resposta depois**: sim. Reposicionada pro topo da página (`SprintFocusBar`,
antes de qualquer bloco de consulta) e redesenhada com o único botão de
estilo primário sólido (`bg-brand`/texto branco) fora dos formulários da
página — a primeira vez que esta tela distingue visualmente "a ação que
importa" de "uma ação qualquer". Nenhuma regra de cálculo mudou
(`computeNextAction` é chamado sem alteração).

---

## PARTE 6 — Secondary Actions

Auditados: Performance, Última execução, Objetivo, Revisões, Comentários,
Configurações. Nenhum deles competia originalmente em peso visual com a
Próxima Ação (todos já usavam estilo secundário/discreto) — o problema não
era peso excessivo dos secundários, era a ausência de um primário
verdadeiro pra comparar. Com o novo CTA primário no topo, a ação
equivalente dentro do card da sprint atual foi **removida** (não apenas
enfraquecida) via a prop `hideNextAction`, pra nunca repetir a mesma frase
duas vezes na mesma página — a única duplicação real encontrada nesta
auditoria.

---

## PARTE 7 — Operational Grouping

A página já não agrupa por tipo técnico de dado dentro de cada bloco (ex.:
"Execução da sprint" já junta tarefas + otimizações no mesmo nível, não
"tabela tasks" separada de "tabela account_reviews") — esse reagrupamento
foi feito em etapas anteriores (Etapa 74, Sprint Workspace). O que faltava
era o agrupamento no nível da PÁGINA INTEIRA: hoje ela segue
Execução → Contexto → Consulta → Consulta, na ordem definida pela Parte 2.

---

## PARTE 8 — Visual Weight

Tipografia, contraste, botões e divisórias já estavam bem calibrados
pelas etapas de Densidade/Feel — nenhum elemento "grita" sem necessidade
(sem cores de alerta fora de contexto, sem negrito excessivo). O único
ajuste de peso desta etapa foi o oposto do que normalmente se corrige:
**dar mais peso**, pela primeira vez nesta tela, a um único CTA — a régua
de "reduzir o que compete" já estava aplicada; faltava a régua de "destacar
o que decide".

---

## PARTE 9 — Cognitive Load

Nenhum item novo de "o gestor precisa pensar" foi encontrado além do já
resolvido em etapas anteriores (rótulos ambíguos, estados vazios sem
padrão, texto duplicado) — essas já foram tratadas nas Waves de Integrity/
Density. O ganho cognitivo desta etapa é indireto: ao responder "o que eu
faço agora" sem exigir que o gestor primeiro processe 3 blocos de números,
o esforço de leitura antes da primeira decisão cai, mesmo sem remover
nenhuma informação da página.

---

## PARTE 10 — Workspace Rhythm

Sprints futuras/concluídas continuam com o mesmo componente
(`SprintCard`/`SprintCardBody`) e o mesmo ritmo visual de sempre — a
mudança desta etapa (`hideNextAction`) só tem efeito na sprint atual
(único caso em que `computeNextAction` produzia conteúdo visível), então
nenhuma diferença nova foi introduzida entre sprints do mesmo cliente nem
entre clientes.

---

## PARTE 11 — First Fold

**Antes**: em qualquer resolução comum de desktop, a primeira dobra
mostrava identidade + seletor de mês + os 3 KPIs + o início de "Última
revisão de conta" — nenhum CTA de execução visível sem rolar.

**Depois**: a primeira dobra agora inclui o selo de ritmo do mês e a
Próxima Ação com CTA, antes de qualquer KPI. O gestor decide o que fazer
sem precisar rolar — exatamente o critério da Parte 11.

---

## PARTE 12 — Eye Tracking

Contagem de elementos distintos que o olho processa antes de alcançar uma
ação executável (mesma metodologia da Parte 2):

- **Antes**: 12 elementos (ver Parte 2).
- **Depois**: 4 elementos (nome, badge, seletor de mês, Foco agora).

Redução de ~66% no número de blocos processados antes da primeira decisão
executável.

---

## PARTE 13 — Operational Score

| Critério | Antes | Depois |
|---|---|---|
| Execução (visibilidade da Próxima Ação) | 3 | 9 |
| Consulta | 8 | 8 |
| Histórico | 8 | 8 |
| Configuração | 8 | 8 |
| Hierarquia (ordem reflete prioridade real) | 4 | 9 |
| Densidade | 8 | 8 |
| Primeira dobra | 3 | 9 |
| Clareza (CTA reconhecível como principal) | 4 | 9 |
| CTA (peso visual proporcional à importância) | 4 | 9 |
| Fluxo (Executar antes de Consultar) | 4 | 8 |
| **Resultado final (média)** | **5,4** | **8,5** |

Densidade/Consulta/Histórico/Configuração mantidos — já estavam bem
resolvidos pelas etapas anteriores e não faziam parte do problema
identificado nesta auditoria.

---

## Itens adiados (candidatos a uma etapa futura, não implementados aqui)

1. Reintroduzir um indicador de "saúde da conta" mais completo
   (`computeAccountHealth`/`buildAttentionAlerts`) — deliberadamente NÃO
   feito: exigiria novas consultas (dias de inatividade, sincronização,
   etc.) e essa lista de alertas foi removida da Sprint por decisão
   explícita de uma etapa anterior ("a Sprint é área de execução, não
   painel de alertas"). Em vez disso, esta etapa reaproveitou o
   `SpendStatus` já computado (zero consulta nova) como proxy de saúde —
   suficiente para o "menos de 2 segundos" pedido, sem reabrir aquela
   decisão.
2. Tornar "Atualizar performance"/"Configurar objetivo" um clique único a
   partir do topo da página (hoje: âncora que rola até a sprint já aberta,
   depois um clique) — o mecanismo de revelação (`peer-checked` via
   checkbox) é local ao card da sprint por design; torná-lo acionável à
   distância exigiria convertê-lo em estado de Client Component, fora do
   escopo de "baixo risco" desta etapa.
3. Reordenar internamente "Acompanhamento da Conta" vs. "Investimento do
   mês" — mantidos na ordem atual; ambos já são consulta/contexto e a
   mudança de maior impacto (promover Execução) já resolve o problema
   central sem precisar mexer na ordem relativa entre os dois.
4. Qualquer mudança na tela `/sprints` (painel agregado da agência) — fora
   do escopo desta etapa (que trata da Sprint = página do cliente); o
   componente compartilhado (`SprintCard`) só muda de comportamento onde
   `hideNextAction` é passado explicitamente, o que só acontece na página
   do cliente.
