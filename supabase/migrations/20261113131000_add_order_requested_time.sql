alter table public.store_orders
  add column if not exists requested_time text;

alter table public.store_orders
  drop constraint if exists store_orders_requested_time_check;

alter table public.store_orders
  add constraint store_orders_requested_time_check
  check (requested_time is null or requested_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
