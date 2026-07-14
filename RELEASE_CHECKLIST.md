# Processo de versoes da OLI Vinhos

## Ambientes

- **Desenvolvimento:** branches `feature/*` e `fix/*`.
- **Homologacao:** branch `develop`, site privado e Supabase separado.
- **Producao:** branch `main`, GitHub Pages e Supabase de producao.

Nunca use o Supabase de producao para testar criacao, exclusao, pagamento ou
alteracao de estoque.

## Numeracao

- `v1.1.0`: nova funcionalidade compativel.
- `v1.1.1`: correcao de erro.
- `v2.0.0`: mudanca incompativel ou grande reestruturacao.

## Caminho de uma alteracao

1. Criar uma branch `feature/nome-da-funcionalidade` a partir de `develop`.
2. Implementar e enviar a alteracao. Os testes automaticos devem passar.
3. Integrar em `develop` e publicar na homologacao privada.
4. Executar os testes de aceite abaixo.
5. Abrir uma solicitacao de integracao de `develop` para `main`.
6. Depois da aprovacao, criar a tag da nova versao na `main`.
7. Executar manualmente a publicacao informando essa tag.
8. Confirmar a loja, o painel administrativo e o registro da versao.

## Testes de aceite

- Loja abre em computador e celular.
- Busca, filtros, detalhes e imagens funcionam.
- Cadastro, login, recuperacao e alteracao de senha funcionam.
- Carrinho respeita preco e estoque.
- Pedido aparece para o cliente e para a administracao.
- WhatsApp e e-mail contêm os mesmos itens e valores do pedido.
- Retirada nao solicita endereco nem frete.
- Perfis MASTER, administrador e gestor respeitam a hierarquia.
- Nenhum dado ou segredo de producao aparece nos registros de teste.

## Testes adicionais para pagamentos

- Dinheiro fica como pagamento na retirada.
- Pix gera QR Code e codigo copia e cola uma unica vez por pedido.
- Atualizar ou clicar novamente nao duplica a cobranca.
- Pagamento aprovado, recusado e expirado atualizam o pedido.
- O retorno do provedor e validado antes de alterar o status.
- Um pedido cancelado libera a reserva de estoque quando aplicavel.

## Retorno de emergencia

O codigo pode voltar para a tag anterior. Migracoes de banco devem ser
aditivas e compativeis com a versao anterior para que o retorno do site nao
cause perda de dados.

