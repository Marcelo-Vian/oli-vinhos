-- Links de acao por e-mail para a operacao da loja em homologacao.
-- O token bruto existe somente no e-mail; o banco armazena apenas seu hash.

create table if not exists public.order_email_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null check (action in ('confirm_payment','confirm_order','preparing','ready','delivered')),
  token_hash text not null unique,
  authorized_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists order_email_actions_order_idx
  on public.order_email_actions(order_id, created_at desc);
create index if not exists order_email_actions_expiry_idx
  on public.order_email_actions(expires_at)
  where used_at is null;

alter table public.order_email_actions enable row level security;
revoke all on table public.order_email_actions from anon, authenticated;
grant select, insert, update, delete on table public.order_email_actions to service_role;

create or replace function public.apply_order_email_action(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.order_email_actions;
  v_order public.orders;
  v_note text;
begin
  select * into v_token
  from public.order_email_actions
  where token_hash = p_token_hash
  for update;

  if not found then raise exception 'Este link não é válido.'; end if;
  if v_token.used_at is not null then raise exception 'Este link já foi utilizado.'; end if;
  if v_token.expires_at < now() then raise exception 'Este link expirou.'; end if;

  select * into v_order
  from public.orders
  where id = v_token.order_id
  for update;

  if not found then raise exception 'Pedido não encontrado.'; end if;

  if v_token.action = 'confirm_payment' then
    if v_order.payment_method <> 'pix' then raise exception 'Este pedido não utiliza Pix.'; end if;
    if v_order.payment_status <> 'pending' then raise exception 'O pagamento não está pendente.'; end if;
    update public.orders
    set payment_status = 'paid', paid_at = coalesce(paid_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Pix confirmado pelo link operacional enviado para ' || v_token.authorized_email || '.';
    insert into public.payment_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'paid', v_note, null);

  elsif v_token.action = 'confirm_order' then
    if v_order.status <> 'pending' then raise exception 'O pedido não está pendente.'; end if;
    if v_order.payment_method = 'pix' and v_order.payment_status <> 'paid' then
      raise exception 'Confirme primeiro o pagamento Pix.';
    end if;
    update public.orders
    set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Pedido confirmado pelo link operacional enviado para ' || v_token.authorized_email || '.';
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'confirmed', v_note, null);

  elsif v_token.action = 'preparing' then
    if v_order.status <> 'confirmed' then raise exception 'Confirme primeiro o pedido.'; end if;
    update public.orders set status = 'preparing' where id = v_order.id returning * into v_order;
    v_note := 'Separação iniciada pelo link operacional enviado para ' || v_token.authorized_email || '.';
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'preparing', v_note, null);

  elsif v_token.action = 'ready' then
    if v_order.status <> 'preparing' then raise exception 'O pedido ainda não está em separação.'; end if;
    update public.orders set status = 'ready' where id = v_order.id returning * into v_order;
    v_note := 'Pedido marcado como pronto pelo link operacional enviado para ' || v_token.authorized_email || '.';
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'ready', v_note, null);

  elsif v_token.action = 'delivered' then
    if v_order.status <> 'ready' then raise exception 'O pedido ainda não está pronto para retirada.'; end if;
    update public.orders
    set status = 'delivered', delivered_at = coalesce(delivered_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Retirada confirmada pelo link operacional enviado para ' || v_token.authorized_email || '.';
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'delivered', v_note, null);
  end if;

  update public.order_email_actions set used_at = now() where id = v_token.id;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_email', v_order.customer_email,
    'customer_phone', v_order.customer_phone,
    'total', v_order.total,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'status', v_order.status,
    'pickup_date', v_order.pickup_date,
    'pickup_time', v_order.pickup_time,
    'action', v_token.action,
    'authorized_email', v_token.authorized_email
  );
end;
$$;

revoke all on function public.apply_order_email_action(text) from public, anon, authenticated;
grant execute on function public.apply_order_email_action(text) to service_role;
