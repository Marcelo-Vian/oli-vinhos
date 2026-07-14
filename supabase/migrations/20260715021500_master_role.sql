-- Papel MASTER: proprietário protegido, acima dos demais acessos.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer','manager','admin','master'));

-- ID confirmado anteriormente para a conta proprietária.
update public.profiles
set role = 'master'
where id = 'ba227c6c-4610-4732-a6f9-c7b6f66a0874'::uuid;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('master','admin'));
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('master','admin','manager'));
$$;

