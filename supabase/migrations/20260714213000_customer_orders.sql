-- Clientes, pedidos, itens e histórico de status da OLI Vinhos.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id and profile.email is null;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity (start with 1001) unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  pickup_date date not null,
  pickup_time time without time zone not null,
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','delivered','canceled')),
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  email_sent_at timestamptz,
  confirmed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  image_url text,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('pending','confirmed','preparing','ready','delivered','canceled')),
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id, created_at);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, email, full_name, phone)
  values (
    new.id,
    'customer',
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

create or replace function public.create_order(
  p_customer_name text,
  p_customer_phone text,
  p_pickup_date date,
  p_pickup_time time without time zone,
  p_notes text,
  p_items jsonb
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
begin
  if v_user_id is null then raise exception 'Faça login para concluir o pedido.'; end if;
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

  insert into public.orders (user_id, customer_name, customer_email, customer_phone, pickup_date, pickup_time, notes)
  values (v_user_id, trim(p_customer_name), v_email, trim(p_customer_phone), p_pickup_date, p_pickup_time, nullif(trim(p_notes), ''))
  returning * into v_order;

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

  update public.orders set subtotal = v_total, total = v_total where id = v_order.id returning * into v_order;
  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'pending', 'Pedido recebido e aguardando confirmação.', v_user_id);
  return v_order;
end;
$$;

create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário.'; end if;
  if not (p_status = any(array['pending','confirmed','preparing','ready','delivered','canceled']::text[])) then
    raise exception 'Status inválido.';
  end if;

  update public.orders
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
  where id = p_order_id
  returning * into v_order;

  if not found then raise exception 'Pedido não encontrado.'; end if;
  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, nullif(trim(p_note), ''), auth.uid());
  return v_order;
end;
$$;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

drop policy if exists "Customers and admins read orders" on public.orders;
create policy "Customers and admins read orders" on public.orders for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "Customers and admins read order items" on public.order_items;
create policy "Customers and admins read order items" on public.order_items for select to authenticated
using (exists (select 1 from public.orders where public.orders.id = order_items.order_id));

drop policy if exists "Customers and admins read order history" on public.order_status_history;
create policy "Customers and admins read order history" on public.order_status_history for select to authenticated
using (exists (select 1 from public.orders where public.orders.id = order_status_history.order_id));

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.profiles, public.orders, public.order_items, public.order_status_history to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke all on function public.create_order(text,text,date,time without time zone,text,jsonb) from public;
grant execute on function public.create_order(text,text,date,time without time zone,text,jsonb) to authenticated;
revoke all on function public.set_order_status(uuid,text,text) from public;
grant execute on function public.set_order_status(uuid,text,text) to authenticated;
