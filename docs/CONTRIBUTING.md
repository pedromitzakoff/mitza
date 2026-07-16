# Guia de Desenvolvimento da Plataforma Mitza

## Índice

- [Capítulo 1: Propósito](#capítulo-1-propósito)
- [Capítulo 2: Fluxo obrigatório para qualquer implementação](#capítulo-2-fluxo-obrigatório-para-qualquer-implementação)
- [Capítulo 3: Caso exista conflito](#capítulo-3-caso-exista-conflito)
- [Capítulo 4: Antes de escrever código](#capítulo-4-antes-de-escrever-código)
- [Capítulo 5: Implementação](#capítulo-5-implementação)
- [Capítulo 6: Validação](#capítulo-6-validação)
- [Capítulo 7: Antes do push](#capítulo-7-antes-do-push)
- [Capítulo 8: Numeração de decisões em branches paralelas](#capítulo-8-numeração-de-decisões-em-branches-paralelas)
- [Capítulo 9: Atualização da documentação](#capítulo-9-atualização-da-documentação)
- [Capítulo 10: Guardrails para assistentes de IA](#capítulo-10-guardrails-para-assistentes-de-ia)
- [Capítulo 11: Princípio mais importante](#capítulo-11-princípio-mais-importante)

---

## Capítulo 1: Propósito

Este documento existe para garantir que toda evolução da plataforma
permaneça alinhada ao Manifesto e aos Princípios Arquiteturais.

O objetivo não é acelerar implementações. O objetivo é manter consistência
no produto.

## Capítulo 2: Fluxo obrigatório para qualquer implementação

Sempre que receber um pedido de implementação, seguir obrigatoriamente
esta ordem.

### Passo 1

Ler `/docs/PLATFORM_MANIFESTO.md`.

### Passo 2

Ler `/docs/ARCHITECTURE_PRINCIPLES.md`.

### Passo 3

Consultar `/docs/DECISIONS.md` para verificar se já existe alguma decisão
relacionada.

### Passo 3.1

Consultar `/docs/PLATFORM_INTEGRITY.md` — a Constituição da plataforma:
qual é o conceito oficial que o pedido afeta, qual sua fonte da verdade,
sua superfície de edição oficial e sua representação (label/cor/badge)
já definidas ali. Se o pedido toca mais de uma superfície do mesmo
conceito, seguir o fluxo obrigatório de mudança transversal em
`/docs/HOW_WE_BUILD_FEATURES.md` (Concept Impact Assessment antes de
propor).

### Passo 4

Auditar cuidadosamente a implementação atual. Identificar:

- componentes existentes
- banco de dados
- Server Actions
- RPCs
- hooks
- funções
- relacionamentos
- arquitetura existente
- **todas as superfícies (telas/componentes) onde o conceito afetado já
  aparece** — nunca alterar apenas a tela onde o pedido chegou sem
  verificar as demais

Sempre reutilizar o que já existe quando possível.

### Passo 5

Somente depois propor a implementação.

## Capítulo 3: Caso exista conflito

Se o pedido do usuário entrar em conflito com `PLATFORM_MANIFESTO`,
`ARCHITECTURE_PRINCIPLES` ou `DECISIONS`, não implementar imediatamente.

Primeiro explicar:

- qual é o conflito;
- por que ele existe;
- quais impactos pode gerar;
- sugerir uma alternativa alinhada.

## Capítulo 4: Antes de escrever código

Responder internamente às seguintes perguntas:

1. Qual problema operacional esta implementação resolve?
2. A qual módulo pertence?
   - Operação
   - Financeiro
   - Comercial
   - Administração
   - Analytics
   - Automações
3. Ela reduz carga cognitiva?
4. Ela reduz cliques?
5. Ela reduz troca de contexto?
6. Ela mantém fonte única da verdade?
7. Ela respeita a responsabilidade de cada tela?
8. Ela trabalha para o gestor ou faz o gestor trabalhar para a plataforma?

Caso alguma resposta seja negativa, justificar antes da implementação.

## Capítulo 5: Implementação

Durante a implementação:

- reutilizar componentes existentes;
- evitar duplicação de lógica;
- evitar duplicação de dados;
- preservar arquitetura;
- manter compatibilidade;
- evitar criar novas abstrações quando não forem necessárias.

Sempre preferir evolução incremental.

## Capítulo 6: Validação

Antes de considerar uma implementação concluída, executar:

- typecheck
- lint
- build

Corrigir erros encontrados. Somente depois apresentar o resultado.

## Capítulo 7: Antes do push

Nunca fazer push automaticamente.

Nunca abrir Pull Request automaticamente.

Nunca executar deploy automaticamente.

Sempre parar após a implementação. Apresentar:

- resumo executivo;
- arquivos alterados;
- migrations;
- riscos;
- limitações;
- próximos passos.

Aguardar aprovação do usuário.

## Capítulo 8: Numeração de decisões em branches paralelas

Em branches de desenvolvimento, a numeração das decisões pode ser
provisória. A numeração definitiva deve ser atribuída apenas quando a
alteração for incorporada à branch principal.

Ou seja: ao registrar uma decisão nova em `DECISIONS.md` numa branch que
ainda não foi mesclada, trate o número seguinte como um rascunho — outra
branch em paralelo pode registrar sua própria decisão nova com o mesmo
número, sem que isso seja um erro de quem escreveu. O número final é
resolvido no momento do merge para a branch principal, conferindo qual
decisão (se houver mais de uma) já ocupa aquele número ali.

Uma decisão que já foi mesclada, implementada e referenciada em código ou
no `CHANGELOG.md` nunca deve ser renumerada — o histórico oficial do
projeto prevalece sobre a ordem cronológica em que as ideias surgiram.
Quem estiver mesclando por último ajusta a numeração da sua própria
branch, não a que já está publicada.

## Capítulo 9: Atualização da documentação

Sempre que uma implementação modificar a arquitetura da plataforma,
verificar se é necessário atualizar:

- `PLATFORM_MANIFESTO.md`
- `ARCHITECTURE_PRINCIPLES.md`
- `DECISIONS.md`
- `ROADMAP.md`
- `CHANGELOG.md`

Nunca deixar documentação desatualizada em relação ao código.

## Capítulo 10: Guardrails para assistentes de IA

Versão condensada do checklist completo em
`/docs/HOW_WE_BUILD_FEATURES.md` — vale tanto pra um dev quanto pra um
assistente de IA implementando uma etapa:

- Não criar componente semelhante sem procurar o oficial primeiro.
- Não criar enum, label ou badge local sem consultar `status-registry.ts`.
- Não criar Server Action nova sem seguir o contrato oficial (`{error?}` +
  `revalidatePath`; `redirect()` só para navegação de verdade).
- Não exibir erro técnico cru; não criar empty state manual; não criar
  popover/drawer ad-hoc.
- Não alterar um conceito sem mapear todas as superfícies onde aparece.
- Não generalizar prematuramente sem um segundo uso real já existente.
- Não implementar uma recomendação futura (roadmap, "candidato") sem
  aprovação explícita — recomendação não é aprovação.
- Sempre diferenciar, no relatório final, o que foi **auditado como
  fato**, o que foi **decidido e aprovado**, e o que é **hipótese ou
  sugestão**.

## Capítulo 11: Princípio mais importante

Toda decisão deve respeitar esta regra:

> A Plataforma trabalha para o gestor. O gestor nunca deve trabalhar para
> a Plataforma.

Sempre que houver dúvida entre duas soluções, escolher aquela que:

- reduz carga cognitiva;
- reduz cliques;
- preserva contexto;
- aumenta previsibilidade;
- melhora a operação.
