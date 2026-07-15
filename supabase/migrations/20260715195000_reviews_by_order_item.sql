-- Cada avaliação pertence a uma linha específica de uma compra entregue.

alter table public.product_reviews
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict;

update public.product_reviews as review
set order_item_id = (
  select item.id
  from public.order_items as item
  join public.orders as customer_order on customer_order.id = item.order_id
  where item.product_id = review.product_id
    and customer_order.user_id = review.user_id
    and customer_order.status = 'delivered'
  order by customer_order.delivered_at desc nulls last, customer_order.created_at desc
  limit 1
)
where review.order_item_id is null;

alter table public.product_reviews
  drop constraint if exists product_reviews_product_id_user_id_key;
alter table public.product_reviews
  drop constraint if exists product_reviews_order_item_id_key;
alter table public.product_reviews
  add constraint product_reviews_order_item_id_key unique (order_item_id);

drop function if exists public.submit_product_review(uuid,integer,text);

create function public.submit_product_review(
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

  select item.* into v_item
  from public.order_items as item
  join public.orders as customer_order on customer_order.id = item.order_id
  where item.id = p_order_item_id
    and customer_order.user_id = v_user_id
    and customer_order.status = 'delivered';

  if not found then
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
