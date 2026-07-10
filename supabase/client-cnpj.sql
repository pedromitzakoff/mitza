-- Etapa 34: CNPJ do cliente (Configurações > Clientes).
--
-- Não existe campo equivalente em `clients` — nenhum dos campos de
-- identificação/contato da Etapa 27 guarda documento. Coluna nova,
-- opcional, sem migrar/apagar nenhum dado existente: toda linha atual
-- nasce com cnpj nulo.
--
-- Armazenamos só dígitos (a formatação "00.000.000/0000-00" é só de
-- interface — ver src/lib/cnpj.ts); a checagem abaixo garante isso no
-- banco também, sem depender só da validação da aplicação.

alter table clients
  add column if not exists cnpj text
    check (cnpj is null or cnpj ~ '^[0-9]{14}$');
