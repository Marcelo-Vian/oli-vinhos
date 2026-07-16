# OLI Vinhos

Loja virtual responsiva para o catálogo 2026 da OLI Vinhos. O visitante pesquisa e filtra os rótulos, monta o carrinho, registra o pedido e acompanha cada etapa. O pagamento é manual por Pix ou dinheiro e todo pedido é somente para retirada.

## Tecnologias

- React, TypeScript, Vite e Vinext
- Supabase Database, Auth e Storage
- CSS responsivo sem tema genérico
- GitHub Actions e GitHub Pages

O site continua utilizável caso o Supabase falhe: os 16 produtos verificados no PDF são carregados como catálogo de contingência. O carrinho é salvo no `localStorage`.

## Executar localmente

Requisitos: Node.js 22.13 ou superior e pnpm 11.

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Preencha `.env.local` com a URL e a chave `publishable` do Supabase. Nunca use `secret` ou `service_role` no frontend.

## Configurar o Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e execute `supabase/schema.sql`.
3. Execute `supabase/seed.sql` para carregar os 16 vinhos e preços do PDF.
4. Em Authentication, crie o primeiro usuário com e-mail e senha.
5. Copie o UUID desse usuário e execute:

```sql
insert into public.profiles (id, role)
values ('UUID_DO_USUARIO', 'admin')
on conflict (id) do update set role = 'admin';
```

O script cria a tabela de produtos, índices, atualização automática de datas, bucket público `product-images` e políticas RLS. Visitantes leem apenas produtos ativos. Somente usuários autenticados com `profiles.role = 'admin'` podem criar, editar, excluir ou enviar imagens.

## Variáveis

Use as variáveis listadas em `.env.example`. Os nomes `NEXT_PUBLIC_*` também são aceitos pelo build Vinext; mantenha os pares com o mesmo valor.

## Administração

Acesse `/admin` e entre com o usuário promovido a administrador. O painel permite:

- pesquisar, filtrar e ordenar visualmente os produtos;
- cadastrar, editar, excluir, ativar e desativar;
- alterar preço normal, promoção e estoque;
- editar origem, uva, safra, teor, volume, descrição e harmonização;
- enviar imagens ao Storage;
- marcar destaque, poucas unidades e pendência de revisão.

As alterações no Supabase aparecem na loja na próxima atualização da página. Se o estoque não estiver informado (`NULL`), o site mostra “Sob confirmação”, pois o PDF não contém quantidades.

## Dados e imagens da loja

Nome, WhatsApp e e-mail ficam centralizados em `app/data/store-config.ts`. Não havia endereço nem horário de retirada no PDF, por isso esses campos não foram inventados nem exibidos.

O catálogo de contingência fica em `app/data/products.ts`. As imagens extraídas do PDF estão em `public/products`. Consulte `PRODUCTS_REVIEW.md` para campos ausentes e pendências.

## Publicação no GitHub Pages

1. Em **Settings → Pages**, escolha **GitHub Actions** como fonte.
2. Em **Settings → Secrets and variables → Actions**:
   - crie a variável `VITE_SUPABASE_URL`;
   - crie o secret `VITE_SUPABASE_PUBLISHABLE_KEY` (é uma chave pública, mas o secret evita exposição nos logs).
3. Configure `olivinhos.aucaris.com` como domínio personalizado do GitHub Pages.
4. Execute manualmente o workflow **Publicar OLI Vinhos em producao** e informe
    uma tag de versao que aponte para o estado atual da branch `main`.

O workflow instala as dependências, executa lint, testes e o build estático antes
de publicar `dist-pages`. A produção não é publicada automaticamente por um
push.

## Desenvolvimento, homologação e versões

- `feature/*` e `fix/*`: trabalho em andamento;
- `develop`: homologação privada, com banco separado;
- `main`: versão aprovada para produção.

Pull Requests para `main` executam lint, testes e os dois builds. Cada publicação
de produção deve ter uma tag (`v1.1.0`, `v1.1.1` etc.) e aprovação manual. O
procedimento completo e os testes obrigatórios estão em
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

Senhas, tokens, `service_role`, chaves de pagamento e arquivos `.env` nunca
devem ser versionados. O build público contém apenas a chave `publishable` do
Supabase; toda autorização real continua protegida por RLS e funções do banco.
O repositório permanece público enquanto a produção utilizar o GitHub Pages no
plano gratuito.

## Testes

```bash
pnpm build
pnpm test
```

O conjunto cobre renderização do catálogo e pode ser ampliado com um projeto Supabase de teste para os fluxos administrativos. Antes de publicar, valide busca, filtros, ordenação, detalhes, carrinho, persistência, limite de estoque, checkout e link do WhatsApp em desktop e celular.

## Regras preservadas

- preços idênticos ao PDF;
- pedido registrado e acompanhado na conta do cliente;
- pagamento manual por Pix ou dinheiro, sem cartão;
- sem frete ou entrega;
- envio do pedido não reduz estoque;
- nenhum dado de contato ou produto foi inventado;
- nenhuma senha ou chave administrativa está no repositório.
