-- Pagamentos para retirada e avaliacoes de compras entregues.

alter table public.orders add column if not exists payment_method text not null default 'cash';
alter table public.orders add column if not exists payment_status text not null default 'pending';
alter table public.orders add column if not exists payment_provider text;
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists pix_copy_paste text;
alter table public.orders add column if not exists payment_expires_at timestamptz;
alter table public.orders add column if not exists paid_at timestamptz;

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('pix','cash'));
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (payment_status in ('pending','paid','expired','refunded','canceled'));

create table if not exists public.payment_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('pending','paid','expired','refunded','canceled')),
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payment_status_history_order_idx
  on public.payment_status_history(order_id, created_at);

alter table public.payment_status_history enable row level security;
drop policy if exists "Customers and staff read payment history" on public.payment_status_history;
create policy "Customers and staff read payment history" on public.payment_status_history
for select to authenticated using (
  exists (
    select 1 from public.orders
    where public.orders.id = payment_status_history.order_id
      and (public.orders.user_id = auth.uid() or public.is_staff())
  )
);

grant select on public.payment_status_history to authenticated;

create or replace function public.create_order(
  p_customer_name text,
  p_customer_phone text,
  p_pickup_date date,
  p_pickup_time time without time zone,
  p_notes text,
  p_items jsonb,
  p_payment_method text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_quantity integer;
  v_unit_price numeric(10,2);
  v_total numeric(10,2) := 0;
  v_payment_method text := lower(coalesce(p_payment_method, 'cash'));
begin
  if v_user_id is null then raise exception 'Faça login para concluir o pedido.'; end if;
  if v_payment_method not in ('pix','cash') then raise exception 'Escolha Pix ou dinheiro na retirada.'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Informe o nome completo.'; end if;
  if nullif(trim(p_customer_phone), '') is null then raise exception 'Informe o telefone.'; end if;
  if p_pickup_date < current_date then raise exception 'Escolha uma data de retirada válida.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'O carrinho está vazio.'; end if;

  insert into public.profiles (id, role, email, full_name, phone)
  values (v_user_id, 'customer', v_email, trim(p_customer_name), trim(p_customer_phone))
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone;

  insert into public.orders (
    user_id, customer_name, customer_email, customer_phone,
    pickup_date, pickup_time, notes, payment_method, payment_status
  ) values (
    v_user_id, trim(p_customer_name), v_email, trim(p_customer_phone),
    p_pickup_date, p_pickup_time, nullif(trim(p_notes), ''), v_payment_method, 'pending'
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 99 then raise exception 'Quantidade inválida.'; end if;

    select product.* into v_product
    from public.products as product
    where product.id = (v_item ->> 'product_id')::uuid and product.active = true;

    if not found then raise exception 'Um produto do carrinho não está mais disponível.'; end if;
    if v_product.quantity_available is not null and v_quantity > v_product.quantity_available then
      raise exception 'Estoque insuficiente para %.', v_product.name;
    end if;

    v_unit_price := coalesce(v_product.promotional_price, v_product.normal_price);
    v_total := v_total + (v_unit_price * v_quantity);

    insert into public.order_items (order_id, product_id, product_name, image_url, unit_price, quantity, line_total)
    values (v_order.id, v_product.id, v_product.name, v_product.image_url, v_unit_price, v_quantity, v_unit_price * v_quantity);
  end loop;

  update public.orders
  set subtotal = v_total,
      total = v_total,
      payment_provider = case when v_payment_method = 'pix' then 'homologation' else null end,
      payment_reference = case when v_payment_method = 'pix' then 'HML-' || order_number::text else null end,
      pix_copy_paste = case when v_payment_method = 'pix' then 'PIX-HOMOLOGACAO-OLI-' || order_number::text || '-' || replace(id::text, '-', '') else null end,
      payment_expires_at = case when v_payment_method = 'pix' then now() + interval '30 minutes' else null end
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'pending', 'Pedido recebido e aguardando confirmação.', v_user_id);
  insert into public.payment_status_history (order_id, status, note, changed_by)
  values (
    v_order.id,
    'pending',
    case when v_payment_method = 'pix'
      then 'Pix de homologação gerado. Não efetuar pagamento real.'
      else 'Pagamento em dinheiro será realizado na retirada.'
    end,
    v_user_id
  );
  return v_order;
end;
$$;

revoke all on function public.create_order(text,text,date,time without time zone,text,jsonb,text) from public;
grant execute on function public.create_order(text,text,date,time without time zone,text,jsonb,text) to authenticated;

create or replace function public.set_payment_status(
  p_order_id uuid,
  p_status text,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not public.is_staff() then raise exception 'Acesso da equipe necessário.'; end if;
  if p_status not in ('pending','paid','expired','refunded','canceled') then
    raise exception 'Status de pagamento inválido.';
  end if;

  update public.orders
  set payment_status = p_status,
      paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end
  where id = p_order_id
  returning * into v_order;

  if not found then raise exception 'Pedido não encontrado.'; end if;
  insert into public.payment_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, nullif(trim(p_note), ''), auth.uid());
  return v_order;
end;
$$;

revoke all on function public.set_payment_status(uuid,text,text) from public;
grant execute on function public.set_payment_status(uuid,text,text) to authenticated;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create index if not exists product_reviews_product_idx on public.product_reviews(product_id, status, created_at desc);
create index if not exists product_reviews_status_idx on public.product_reviews(status, created_at desc);

drop trigger if exists product_reviews_set_updated_at on public.product_reviews;
create trigger product_reviews_set_updated_at before update on public.product_reviews
for each row execute function public.set_updated_at();

alter table public.product_reviews enable row level security;
drop policy if exists "Public reads approved reviews" on public.product_reviews;
create policy "Public reads approved reviews" on public.product_reviews
for select using (status = 'approved' or user_id = auth.uid() or public.is_staff());

grant select on public.product_reviews to anon, authenticated;

create or replace function public.submit_product_review(
  p_product_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.product_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_review public.product_reviews;
begin
  if v_user_id is null then raise exception 'Faça login para avaliar.'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'Escolha uma nota de 1 a 5.'; end if;
  if not exists (
    select 1
    from public.orders
    join public.order_items on order_items.order_id = orders.id
    where orders.user_id = v_user_id
      and orders.status = 'delivered'
      and order_items.product_id = p_product_id
  ) then
    raise exception 'A avaliação é liberada após a retirada de uma compra deste produto.';
  end if;

  select coalesce(nullif(trim(full_name), ''), split_part(coalesce(email, 'Cliente OLI'), '@', 1))
  into v_name from public.profiles where id = v_user_id;

  insert into public.product_reviews (product_id, user_id, customer_name, rating, comment, status)
  values (p_product_id, v_user_id, coalesce(v_name, 'Cliente OLI'), p_rating, nullif(trim(p_comment), ''), 'pending')
  on conflict (product_id, user_id) do update set
    customer_name = excluded.customer_name,
    rating = excluded.rating,
    comment = excluded.comment,
    status = 'pending',
    updated_at = now()
  returning * into v_review;

  return v_review;
end;
$$;

revoke all on function public.submit_product_review(uuid,integer,text) from public;
grant execute on function public.submit_product_review(uuid,integer,text) to authenticated;

create or replace function public.moderate_product_review(
  p_review_id uuid,
  p_status text
)
returns public.product_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.product_reviews;
begin
  if not public.is_staff() then raise exception 'Acesso da equipe necessário.'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'Status de avaliação inválido.'; end if;
  update public.product_reviews set status = p_status where id = p_review_id returning * into v_review;
  if not found then raise exception 'Avaliação não encontrada.'; end if;
  return v_review;
end;
$$;

revoke all on function public.moderate_product_review(uuid,text) from public;
grant execute on function public.moderate_product_review(uuid,text) to authenticated;
