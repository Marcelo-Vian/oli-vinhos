-- OLI Vinhos - estrutura completa para Supabase
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','manager','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  producer text,
  country text,
  region text,
  type text,
  grape text,
  grape_composition text,
  vintage integer,
  volume text,
  alcohol_content text,
  classification text,
  description text,
  pairing text,
  service_temperature text,
  normal_price numeric(10,2) not null check (normal_price >= 0),
  promotional_price numeric(10,2) check (promotional_price is null or promotional_price >= 0),
  quantity_available integer check (quantity_available is null or quantity_available >= 0),
  image_url text,
  featured boolean not null default false,
  active boolean not null default true,
  low_stock boolean not null default false,
  pending_review boolean not null default false,
  information_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_active_idx on public.products(active);
create index if not exists products_featured_idx on public.products(featured) where active = true;
create index if not exists products_country_idx on public.products(country);
create index if not exists products_type_idx on public.products(type);
create index if not exists products_grape_idx on public.products(grape);
create index if not exists products_price_idx on public.products(normal_price);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','manager'));
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;

drop policy if exists "Public reads active products" on public.products;
create policy "Public reads active products" on public.products for select using (active = true or public.is_staff());
drop policy if exists "Admins insert products" on public.products;
create policy "Admins insert products" on public.products for insert to authenticated with check (public.is_staff());
drop policy if exists "Admins update products" on public.products;
create policy "Admins update products" on public.products for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Admins delete products" on public.products;
create policy "Admins delete products" on public.products for delete to authenticated using (public.is_staff());

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "Admins read profiles" on public.profiles;
create policy "Admins read profiles" on public.profiles for select to authenticated using (public.is_staff());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads product images" on storage.objects;
create policy "Public reads product images" on storage.objects for select using (bucket_id = 'product-images');
drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_staff());
drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.is_staff()) with check (bucket_id = 'product-images' and public.is_staff());
drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.is_staff());

-- Depois de criar o usuário no Auth, promova-o com:
-- insert into public.profiles (id, role) values ('UUID_DO_USUARIO', 'admin')
-- on conflict (id) do update set role = 'admin';
