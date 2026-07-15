# Princípios Arquiteturais da Plataforma Mitza

## Objetivo do documento

Documentar os padrões arquiteturais e as convenções técnicas já
estabelecidos no código da Mitza, para que novas implementações — feitas
por qualquer pessoa ou agente — sigam a mesma filosofia técnica em vez de
reinventar uma abordagem diferente a cada etapa.

## Como deve ser utilizado

Consultado antes de implementar uma funcionalidade nova, para manter
consistência com os padrões já existentes (ex.: como uma Server Action
decide para onde redirecionar, onde vive uma regra de negócio central,
como uma migration nova deve ser estruturada). Também serve de referência
ao revisar código — um padrão que diverge do que está aqui deve ter uma
justificativa clara ou motivar uma atualização deste documento.

## Quem deve atualizá-lo

Quem implementa uma etapa que introduz um padrão arquitetural novo ou
consolida um já existente (dev ou agente responsável pela etapa).

## Quando deve ser atualizado

Sempre que um novo padrão arquitetural relevante for estabelecido, ou um
padrão existente for alterado de forma que afete implementações futuras.

---

## Capítulo 1 — A Plataforma é construída em camadas

A plataforma será desenvolvida em módulos independentes. Cada
funcionalidade deve pertencer claramente a apenas um módulo.

Estrutura atual:

1. Operação (fase atual)
2. Financeiro
3. Comercial
4. Administração
5. Analytics
6. Automações

Não implementar funcionalidades de módulos futuros dentro do módulo
Operação apenas para centralizar tudo.

## Capítulo 2 — A Operação é o centro da Plataforma

Neste momento todo desenvolvimento deve priorizar exclusivamente a
operação.

A operação é responsável por:

- Clientes
- Sprints
- Tarefas
- Otimizações
- Investimentos
- Relatórios
- Contexto operacional

Outros módulos serão construídos posteriormente.

## Capítulo 3 — Responsabilidade de cada tela

### Visão Geral

Objetivo: responder "Onde devo agir?"

Nunca executar operação. Nunca substituir Sprint.

### Sprints

Objetivo: executar o trabalho diário.

Deve ser a principal área operacional. Toda decisão de UX deve reduzir:

- cliques
- troca de contexto
- carga cognitiva

### Cliente

Objetivo: investigar profundamente uma conta.

Guardar contexto. Histórico. Informações estratégicas.

### Relatórios

Objetivo: comunicar o trabalho realizado.

Nunca executar operação.

## Capítulo 4 — Uma tela não deve assumir o papel da outra

Sprint não deve virar Dashboard.

Dashboard não deve virar Cliente.

Cliente não deve virar Sprint.

Cada tela possui uma única responsabilidade principal.

## Capítulo 5 — Fonte única da verdade

Toda informação importante deve possuir apenas uma fonte oficial.

Nunca criar duas representações diferentes do mesmo dado.

Nunca sincronizar manualmente dados duplicados.

Sempre reutilizar a estrutura existente quando possível.

## Capítulo 6 — Uma ação gera todos os efeitos necessários

Sempre que possível:

> uma única ação
>
> ↓
>
> gera automaticamente:
>
> - histórico
> - indicadores
> - contexto
> - eventos
> - atualizações derivadas

O gestor nunca deve registrar duas vezes a mesma informação.

## Capítulo 7 — Desktop primeiro

A plataforma é otimizada inicialmente para Desktop. Desktop é a principal
estação operacional.

Mobile será otimizado posteriormente. Mobile deve priorizar:

- consultas
- acompanhamento
- pequenas ações
- atualizações rápidas

## Capítulo 8 — Performance

Performance não deve ser otimizada prematuramente.

Primeiro:

- regras de negócio
- arquitetura
- estabilidade

Depois será executada uma fase exclusiva de performance. Ela incluirá:

- auditoria
- queries
- índices
- cache
- optimistic updates
- re-renderização
- UX Desktop
- UX Mobile

## Capítulo 9 — Reduzir carga cognitiva

Toda implementação deve responder:

- Ela reduz carga mental?
- Ela reduz cliques?
- Ela reduz troca de contexto?
- Ela reduz necessidade de memória?

Caso contrário, reavaliar a implementação.

## Capítulo 10 — Não copiar o ClickUp

A plataforma não deve copiar interfaces. Nem arquitetura. Nem fluxo.

Apenas princípios de produtividade quando fizer sentido.

O objetivo é resolver problemas específicos da operação de tráfego.

## Capítulo 11 — Escalabilidade

Toda implementação deve funcionar para:

- 30 clientes.
- 100 clientes.
- 500 clientes.

Sem alterar arquitetura.

## Capítulo 12 — Checklist obrigatório para novas features

Antes de qualquer implementação responder:

1. A qual módulo pertence?
2. Reduz carga cognitiva?
3. Reduz cliques?
4. Reduz troca de contexto?
5. Mantém fonte única da verdade?
6. Respeita responsabilidade das telas?
7. É compatível com o Manifesto?

Caso alguma resposta seja negativa, justificar antes de implementar.

## Capítulo 13 — Navegação

A navegação da plataforma deve privilegiar continuidade.

Sempre que possível:

- expandir ao invés de abrir páginas;
- editar ao invés de navegar;
- permanecer no mesmo contexto;
- preservar scroll;
- preservar filtros;
- preservar expansões;
- preservar mês selecionado.

A troca de tela deve ser exceção.

## Capítulo 14 — Estrutura Hierárquica

A plataforma deve comunicar claramente a hierarquia da operação.

> Cliente
>
> ↓
>
> Sprint
>
> ↓
>
> Contexto
>
> ↓
>
> Ações
>
> ↓
>
> Histórico

Essa relação deve ser percebida visualmente.

A navegação deve privilegiar árvores hierárquicas ao invés de múltiplos
cards independentes.

## Capítulo 15 — Densidade Visual

Sempre buscar alta densidade operacional. Isso significa mostrar mais
contexto utilizando menos espaço. Não significa poluir a interface.

Reduzir:

- espaços vazios;
- margens excessivas;
- textos redundantes;
- divisórias desnecessárias;
- componentes repetidos;
- cabeçalhos duplicados.

## Capítulo 16 — A navegação ocupa o menor espaço possível

Navegação existe para dar contexto, não para competir com a operação.

Menus, barras, filtros, cabeçalhos e qualquer elemento estrutural devem
ocupar apenas o espaço necessário para cumprir sua função — nunca mais que
isso.

Toda área recuperada de um elemento estrutural deve se converter em área
útil de trabalho para o gestor.

## Capítulo 17 — Área operacional em primeiro lugar

Toda decisão de UX deve priorizar o aumento da área operacional útil.

Sempre que um elemento estrutural competir com a área operacional, sua
existência deve ser questionada.

Antes de adicionar qualquer elemento novo à interface, a pergunta
obrigatória é:

> Isso ajuda o gestor a trabalhar ou apenas ocupa espaço?

Se a resposta for "apenas ocupa espaço", o elemento não deve existir.

## Capítulo 18 — Continuidade acima de transição

O objetivo da interface não é animar.

É preservar contexto.

Toda transição deve comunicar continuidade entre estados.

Nunca apenas mover elementos.

## Capítulo 19 — Navegação é exceção

Redirecionar, recarregar e trocar de rota são o último recurso, não o
primeiro.

Um redirecionamento só é justificável quando o destino é genuinamente
outra tela — nunca quando serve apenas para confirmar que uma ação deu
certo no lugar onde ela já estava sendo feita.

Antes de qualquer `redirect()`, a pergunta é: essa navegação é necessária
para a integridade da aplicação, ou é apenas o caminho mais simples de
implementar?

## Capítulo 20 — Atualização local acima de navegação

Antes de implementar qualquer ação que envolva navegação, a pergunta
obrigatória é:

> O usuário realmente precisa navegar?
> O resultado pode ser refletido localmente?
> Ele perde contexto se navegar?
> Existe uma forma de confirmar a ação sem trocar de página?

A atualização local deve ser sempre a primeira opção.

A navegação deve ser sempre a última.

## Capítulo 21 — Medir antes de otimizar

Nenhuma otimização de performance deve ser implementada sem identificar o
gargalo e comparar o estado antes e depois.

## Capítulo 22 — Movimento comunica continuidade

Toda animação deve conectar dois estados da interface e nunca existir
apenas como decoração.

## Capítulo 23 — Componentes semelhantes devem se comportar da mesma maneira

Velocidade, easing, duração, foco, hover e feedback devem ser consistentes
em toda a plataforma.
