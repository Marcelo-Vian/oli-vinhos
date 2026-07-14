-- Separa administrador geral, gestor da loja e cliente.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer','manager','admin'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','manager')
  );
$$;

drop policy if exists "Public reads active products" on public.products;
create policy "Public reads active products" on public.products for select
using (active = true or public.is_staff());
drop policy if exists "Admins insert products" on public.products;
create policy "Admins insert products" on public.products for insert to authenticated
with check (public.is_staff());
drop policy if exists "Admins update products" on public.products;
create policy "Admins update products" on public.products for update to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Admins delete products" on public.products;
create policy "Admins delete products" on public.products for delete to authenticated
using (public.is_staff());

drop policy if exists "Admins read profiles" on public.profiles;
create policy "Admins read profiles" on public.profiles for select to authenticated
using (public.is_staff());

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images" on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.is_staff());
drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images" on storage.objects for update to authenticated
using (bucket_id = 'product-images' and public.is_staff())
with check (bucket_id = 'product-images' and public.is_staff());
drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images" on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and public.is_staff());

drop policy if exists "Customers and admins read orders" on public.orders;
create policy "Customers and admins read orders" on public.orders for select to authenticated
using ((select auth.uid()) = user_id or public.is_staff());

create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not public.is_staff() then raise exception 'Acesso da equipe necessário.'; end if;
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

