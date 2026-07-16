-- Mantem Pix ficticio em homologacao e usa a chave fixa somente no projeto de producao.

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
  if v_payment_method not in ('pix','cash') then raise exception 'Escolha Pix ou dinheiro na retirada.'; end if;
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

-- As funções de e-mail usam o cliente administrativo e precisam consultar o
-- pedido completo, seus itens e as avaliações, além das tabelas de workflow.
grant select, insert, update, delete on table
  public.products,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.payment_status_history,
  public.product_reviews,
  public.order_email_actions,
  public.review_email_actions,
  public.store_settings
to service_role;
