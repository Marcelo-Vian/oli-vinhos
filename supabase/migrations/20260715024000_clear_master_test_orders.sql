-- Limpeza solicitada dos pedidos de teste da conta proprietária MASTER.
do $$
declare
  deleted_count integer;
begin
  delete from public.orders
  where user_id = 'ba227c6c-4610-4732-a6f9-c7b6f66a0874'::uuid;

  get diagnostics deleted_count = row_count;
  raise notice 'Pedidos de teste removidos da conta MASTER: %', deleted_count;
end
$$;
