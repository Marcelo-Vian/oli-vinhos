-- Limites de entrada e antispam para pedidos/avaliacoes publicos.

alter table public.profiles
  drop constraint if exists profiles_full_name_length_check,
  drop constraint if exists profiles_phone_length_check;

alter table public.profiles
  add constraint profiles_full_name_length_check
    check (full_name is null or char_length(full_name) <= 120) not valid,
  add constraint profiles_phone_length_check
    check (phone is null or char_length(phone) <= 30) not valid;

alter table public.profiles validate constraint profiles_full_name_length_check;
alter table public.profiles validate constraint profiles_phone_length_check;

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
  v_issuer text := coalesce(auth.jwt() ->> 'iss', '');
  v_is_production boolean;
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_quantity integer;
  v_unit_price numeric(10,2);
  v_total numeric(10,2) := 0;
  v_payment_method text := lower(coalesce(p_payment_method, 'cash'));
begin
  v_is_production := v_issuer like '%njxteblisfryhfmtimwm%';

  if v_user_id is null then raise exception 'Faça login para concluir o pedido.'; end if;
  if nullif(trim(coalesce(v_email, '')), '') is null or char_length(v_email) > 254 then
    raise exception 'O e-mail da conta é inválido.';
  end if;
  if v_payment_method not in ('pix','cash') then raise exception 'Escolha Pix ou dinheiro na retirada.'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Informe o nome completo.'; end if;
  if char_length(trim(p_customer_name)) > 120 then raise exception 'O nome deve ter no máximo 120 caracteres.'; end if;
  if nullif(trim(p_customer_phone), '') is null then raise exception 'Informe o telefone.'; end if;
  if char_length(trim(p_customer_phone)) > 30 then raise exception 'O telefone deve ter no máximo 30 caracteres.'; end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'As observações devem ter no máximo 1000 caracteres.'; end if;
  if p_pickup_date < current_date then raise exception 'Escolha uma data de retirada válida.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'O carrinho está vazio.'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'O carrinho excede o limite de 50 itens diferentes.'; end if;

  -- Serializa pedidos do mesmo usuário para que chamadas concorrentes também
  -- respeitem o limite de criação.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text)::bigint);
  if (
    select count(*)
    from public.orders
    where user_id = v_user_id and created_at >= now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Limite de pedidos atingido. Aguarde antes de tentar novamente.';
  end if;

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
      payment_provider = case
        when v_payment_method = 'pix' and v_is_production then 'manual_pix'
        when v_payment_method = 'pix' then 'homologation'
        else null
      end,
      payment_reference = case
        when v_payment_method = 'pix' and v_is_production then 'PIX-' || order_number::text
        when v_payment_method = 'pix' then 'HML-' || order_number::text
        else null
      end,
      pix_copy_paste = case
        when v_payment_method = 'pix' and v_is_production then '11968669167'
        when v_payment_method = 'pix' then 'PIX-HOMOLOGACAO-OLI-' || order_number::text || '-' || replace(id::text, '-', '')
        else null
      end,
      payment_expires_at = case
        when v_payment_method = 'pix' and not v_is_production then now() + interval '30 minutes'
        else null
      end
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'pending', 'Pedido recebido e aguardando confirmação.', v_user_id);
  insert into public.payment_status_history (order_id, status, note, changed_by)
  values (
    v_order.id,
    'pending',
    case
      when v_payment_method = 'pix' and v_is_production then 'Pagamento Pix aguardando confirmação manual.'
      when v_payment_method = 'pix' then 'Pix de homologação gerado. Não efetuar pagamento real.'
      else 'Pagamento em dinheiro será realizado na retirada.'
    end,
    v_user_id
  );
  return v_order;
end;
$$;

revoke all on function public.create_order(text,text,date,time without time zone,text,jsonb,text) from public;
grant execute on function public.create_order(text,text,date,time without time zone,text,jsonb,text) to authenticated;

create or replace function public.submit_product_review(
  p_order_item_id uuid,
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
  v_item public.order_items;
  v_review public.product_reviews;
begin
  if v_user_id is null then raise exception 'Faça login para avaliar.'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'Escolha uma nota de 1 a 5.'; end if;
  if char_length(coalesce(p_comment, '')) > 1000 then raise exception 'O comentário deve ter no máximo 1000 caracteres.'; end if;

  select item.* into v_item
  from public.order_items as item
  join public.orders as customer_order on customer_order.id = item.order_id
  where item.id = p_order_item_id
    and customer_order.user_id = v_user_id
    and customer_order.status = 'delivered';

  if not found or v_item.product_id is null then
    raise exception 'A avaliação é liberada somente para um item de uma compra entregue.';
  end if;

  select coalesce(nullif(trim(full_name), ''), split_part(coalesce(email, 'Cliente OLI'), '@', 1))
  into v_name from public.profiles where id = v_user_id;

  insert into public.product_reviews (
    order_item_id, product_id, user_id, customer_name, rating, comment, status
  ) values (
    v_item.id, v_item.product_id, v_user_id, coalesce(v_name, 'Cliente OLI'),
    p_rating, nullif(trim(p_comment), ''), 'pending'
  )
  on conflict (order_item_id) do update set
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
