# Princípios de Arquitetura

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

## Estrutura de capítulos

### 1. Stack e Estrutura do Projeto

### 2. Padrões de Server Actions

### 3. Camada de Regras de Negócio Centralizadas

### 4. Convenções de Banco de Dados e Migrations

### 5. Padrões de Componentes de Interface

### 6. Testes e Validação
