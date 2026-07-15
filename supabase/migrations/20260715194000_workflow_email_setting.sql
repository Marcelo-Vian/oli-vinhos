-- E-mail operacional configurável pelo painel. Somente MASTER e administrador alteram.

create table if not exists public.store_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.store_settings (key, value)
values ('workflow_email', 'marcelo.vian@gmail.com')
on conflict (key) do nothing;

alter table public.store_settings enable row level security;
drop policy if exists "Staff reads store settings" on public.store_settings;
create policy "Staff reads store settings" on public.store_settings
for select to authenticated using (public.is_staff());

revoke all on table public.store_settings from anon, authenticated;
grant select on table public.store_settings to authenticated;
grant select, insert, update, delete on table public.store_settings to service_role;

create or replace function public.get_workflow_email()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_staff() then raise exception 'Acesso da equipe necessário.'; end if;
  select value into v_email from public.store_settings where key = 'workflow_email';
  return v_email;
end;
$$;

create or replace function public.set_workflow_email(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('master', 'admin') then
    raise exception 'Somente MASTER e administrador geral podem alterar o e-mail do workflow.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;

  insert into public.store_settings (key, value, updated_at, updated_by)
  values ('workflow_email', v_email, now(), auth.uid())
  on conflict (key) do update set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
  return v_email;
end;
$$;

revoke all on function public.get_workflow_email() from public, anon;
revoke all on function public.set_workflow_email(text) from public, anon;
grant execute on function public.get_workflow_email() to authenticated;
grant execute on function public.set_workflow_email(text) to authenticated;
