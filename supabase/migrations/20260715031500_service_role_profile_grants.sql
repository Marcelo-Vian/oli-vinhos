-- A Edge Function administrativa usa service_role para gerenciar perfis.
-- RLS bypass não substitui os privilégios SQL da tabela.
grant select, insert, update, delete on table public.profiles to service_role;
