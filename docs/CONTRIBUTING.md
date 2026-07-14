# Guia de Desenvolvimento da Plataforma Mitza

## Índice

- [Capítulo 1: Propósito](#capítulo-1-propósito)
- [Capítulo 2: Fluxo obrigatório para qualquer implementação](#capítulo-2-fluxo-obrigatório-para-qualquer-implementação)
- [Capítulo 3: Caso exista conflito](#capítulo-3-caso-exista-conflito)
- [Capítulo 4: Antes de escrever código](#capítulo-4-antes-de-escrever-código)
- [Capítulo 5: Implementação](#capítulo-5-implementação)
- [Capítulo 6: Validação](#capítulo-6-validação)
- [Capítulo 7: Antes do push](#capítulo-7-antes-do-push)
- [Capítulo 8: Atualização da documentação](#capítulo-8-atualização-da-documentação)
- [Capítulo 9: Princípio mais importante](#capítulo-9-princípio-mais-importante)

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

## Capítulo 8: Atualização da documentação

Sempre que uma implementação modificar a arquitetura da plataforma,
verificar se é necessário atualizar:

- `PLATFORM_MANIFESTO.md`
- `ARCHITECTURE_PRINCIPLES.md`
- `DECISIONS.md`
- `ROADMAP.md`
- `CHANGELOG.md`

Nunca deixar documentação desatualizada em relação ao código.

## Capítulo 9: Princípio mais importante

Toda decisão deve respeitar esta regra:

> A Plataforma trabalha para o gestor. O gestor nunca deve trabalhar para
> a Plataforma.

Sempre que houver dúvida entre duas soluções, escolher aquela que:

- reduz carga cognitiva;
- reduz cliques;
- preserva contexto;
- aumenta previsibilidade;
- melhora a operação.
