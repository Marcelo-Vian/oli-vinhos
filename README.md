# OLI Vinhos

Loja virtual responsiva para o catálogo 2026 da OLI Vinhos. O visitante pesquisa e filtra os rótulos, vê todos os detalhes, monta o carrinho e envia o pedido pelo WhatsApp. Não há pagamento, frete ou entrega: todo pedido é para retirada e depende da confirmação da loja.

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

Preencha `.env.local` com a URL e a chave pública `anon` do Supabase. Nunca use `service_role` no frontend.

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

1. Crie um repositório público e envie a branch `main`.
2. Em **Settings → Pages**, escolha **GitHub Actions** como fonte.
3. Em **Settings → Secrets and variables → Actions**:
   - crie a variável `VITE_SUPABASE_URL`;
   - crie o secret `VITE_SUPABASE_ANON_KEY` (é uma chave pública, mas o secret evita exposição nos logs).
4. Faça push na `main` ou execute manualmente o workflow **Build and deploy OLI Vinhos**.

O workflow instala as dependências, executa o build estático com `pnpm build:pages` e publica `dist-pages`. O caminho-base do repositório é calculado pelo próprio workflow, incluindo imagens e `/admin/`. Para novas versões, altere o projeto, confirme com `pnpm build` e `pnpm build:pages`, faça commit e push; o deploy é automático.

## Testes

```bash
pnpm build
pnpm test
```

O conjunto cobre renderização do catálogo e pode ser ampliado com um projeto Supabase de teste para os fluxos administrativos. Antes de publicar, valide busca, filtros, ordenação, detalhes, carrinho, persistência, limite de estoque, checkout e link do WhatsApp em desktop e celular.

## Regras preservadas

- preços idênticos ao PDF;
- pedido somente pelo WhatsApp;
- sem pagamento, frete ou entrega;
- envio do pedido não reduz estoque;
- nenhum dado de contato ou produto foi inventado;
- nenhuma senha ou chave administrativa está no repositório.
