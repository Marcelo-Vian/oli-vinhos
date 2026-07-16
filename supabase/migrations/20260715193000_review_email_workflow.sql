-- Moderacao segura de avaliacoes por links enviados ao e-mail da operacao.

create table if not exists public.review_email_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  action text not null check (action in ('approve','reject')),
  token_hash text not null unique,
  authorized_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists review_email_actions_review_idx
  on public.review_email_actions(review_id, created_at desc);
create index if not exists review_email_actions_expiry_idx
  on public.review_email_actions(expires_at)
  where used_at is null;

alter table public.review_email_actions enable row level security;
revoke all on table public.review_email_actions from anon, authenticated;
grant select, insert, update, delete on table public.review_email_actions to service_role;

create or replace function public.apply_review_email_action(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.review_email_actions;
  v_review public.product_reviews;
  v_product_name text;
  v_status text;
begin
  select * into v_token
  from public.review_email_actions
  where token_hash = p_token_hash
  for update;

  if not found then raise exception 'Este link não é válido.'; end if;
  if v_token.used_at is not null then raise exception 'Esta decisão já foi registrada.'; end if;
  if v_token.expires_at < now() then raise exception 'Este link expirou.'; end if;

  select * into v_review
  from public.product_reviews
  where id = v_token.review_id
  for update;

  if not found then raise exception 'Avaliação não encontrada.'; end if;
  if v_review.status <> 'pending' then raise exception 'Esta avaliação já foi moderada.'; end if;

  v_status := case when v_token.action = 'approve' then 'approved' else 'rejected' end;
  update public.product_reviews
  set status = v_status, updated_at = now()
  where id = v_review.id
  returning * into v_review;

  update public.review_email_actions
  set used_at = now()
  where review_id = v_review.id and used_at is null;

  select name into v_product_name from public.products where id = v_review.product_id;
  return jsonb_build_object(
    'id', v_review.id,
    'action', v_token.action,
    'status', v_review.status,
    'customer_name', v_review.customer_name,
    'product_name', coalesce(v_product_name, 'Produto OLI')
  );
end;
$$;

revoke all on function public.apply_review_email_action(text) from public, anon, authenticated;
grant execute on function public.apply_review_email_action(text) to service_role;
