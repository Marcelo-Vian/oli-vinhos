-- Mensagem opcional ao cliente em todas as etapas e cancelamento seguro por e-mail.

alter table public.order_email_actions
  drop constraint if exists order_email_actions_action_check;
alter table public.order_email_actions
  add constraint order_email_actions_action_check
  check (action in ('confirm_payment','confirm_order','preparing','ready','delivered','cancel'));

create or replace function public.set_order_status(
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
  v_previous_payment_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then raise exception 'Acesso da equipe necessário.'; end if;
  if p_status not in ('pending','confirmed','preparing','ready','delivered','canceled') then
    raise exception 'Status inválido.';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'A mensagem ao cliente deve ter no máximo 500 caracteres.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p_status = 'canceled' and v_order.status in ('delivered', 'canceled') then
    raise exception 'Um pedido entregue ou já cancelado não pode ser cancelado.';
  end if;

  v_previous_payment_status := v_order.payment_status;
  update public.orders
  set status = p_status,
      payment_status = case when p_status = 'canceled' and payment_status = 'pending' then 'canceled' else payment_status end,
      confirmed_at = case when p_status in ('confirmed','preparing') then coalesce(confirmed_at, now()) else confirmed_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, v_note, auth.uid());

  if p_status = 'canceled' and v_previous_payment_status = 'pending' then
    insert into public.payment_status_history (order_id, status, note, changed_by)
    values (p_order_id, 'canceled', 'Pagamento pendente cancelado junto com o pedido.', auth.uid());
  end if;
  return v_order;
end;
$$;

revoke all on function public.set_order_status(uuid,text,text) from public;
grant execute on function public.set_order_status(uuid,text,text) to authenticated;

create or replace function public.apply_order_email_action(
  p_token_hash text,
  p_customer_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.order_email_actions;
  v_order public.orders;
  v_note text;
  v_previous_payment_status text;
  v_customer_message text := nullif(trim(coalesce(p_customer_message, '')), '');
begin
  if char_length(coalesce(v_customer_message, '')) > 500 then
    raise exception 'A mensagem ao cliente deve ter no máximo 500 caracteres.';
  end if;

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

  if v_token.action = 'cancel' then
    if v_order.status in ('delivered', 'canceled') then
      raise exception 'Um pedido entregue ou já cancelado não pode ser cancelado.';
    end if;

    v_previous_payment_status := v_order.payment_status;
    update public.orders
    set status = 'canceled',
        payment_status = case when payment_status = 'pending' then 'canceled' else payment_status end
    where id = v_order.id
    returning * into v_order;

    v_note := 'Pedido cancelado pelo link operacional enviado para ' || v_token.authorized_email || '.';
    if v_customer_message is not null then
      v_note := v_note || ' Mensagem ao cliente: ' || v_customer_message;
    end if;
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'canceled', v_note, null);

    if v_previous_payment_status = 'pending' then
      insert into public.payment_status_history (order_id, status, note, changed_by)
      values (v_order.id, 'canceled', 'Pagamento pendente cancelado junto com o pedido.', null);
    end if;

  elsif v_token.action = 'confirm_payment' then
    if v_order.payment_method <> 'pix' then raise exception 'Este pedido não utiliza Pix.'; end if;
    if v_order.payment_status <> 'pending' then raise exception 'O pagamento não está pendente.'; end if;
    update public.orders
    set payment_status = 'paid', paid_at = coalesce(paid_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Pix confirmado pelo link operacional enviado para ' || v_token.authorized_email || '.';
    if v_customer_message is not null then v_note := v_note || ' Mensagem ao cliente: ' || v_customer_message; end if;
    insert into public.payment_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'paid', v_note, null);

  elsif v_token.action in ('confirm_order', 'preparing') then
    if v_order.status not in ('pending', 'confirmed') then
      raise exception 'O pedido já saiu da etapa de confirmação e separação.';
    end if;
    if v_order.payment_method = 'pix' and v_order.payment_status <> 'paid' then
      raise exception 'Confirme primeiro o pagamento Pix.';
    end if;
    update public.orders
    set status = 'preparing', confirmed_at = coalesce(confirmed_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Pedido confirmado e separação iniciada pelo link operacional enviado para ' || v_token.authorized_email || '.';
    if v_customer_message is not null then v_note := v_note || ' Mensagem ao cliente: ' || v_customer_message; end if;
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'preparing', v_note, null);

  elsif v_token.action = 'ready' then
    if v_order.status <> 'preparing' then raise exception 'O pedido ainda não está em separação.'; end if;
    update public.orders set status = 'ready' where id = v_order.id returning * into v_order;
    v_note := 'Pedido marcado como pronto para retirada pelo link operacional enviado para ' || v_token.authorized_email || '.';
    if v_customer_message is not null then v_note := v_note || ' Mensagem ao cliente: ' || v_customer_message; end if;
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'ready', v_note, null);

  elsif v_token.action = 'delivered' then
    if v_order.status <> 'ready' then raise exception 'O pedido ainda não está pronto para retirada.'; end if;
    update public.orders
    set status = 'delivered', delivered_at = coalesce(delivered_at, now())
    where id = v_order.id
    returning * into v_order;
    v_note := 'Retirada confirmada pelo link operacional enviado para ' || v_token.authorized_email || '.';
    if v_customer_message is not null then v_note := v_note || ' Mensagem ao cliente: ' || v_customer_message; end if;
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (v_order.id, 'delivered', v_note, null);
  else
    raise exception 'A ação deste link não é reconhecida.';
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
    'authorized_email', v_token.authorized_email,
    'customer_message', v_customer_message
  );
end;
$$;

revoke all on function public.apply_order_email_action(text,text) from public, anon, authenticated;
grant execute on function public.apply_order_email_action(text,text) to service_role;
