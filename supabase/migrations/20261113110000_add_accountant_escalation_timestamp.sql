alter table public.store_orders
  add column if not exists accountant_notified_at timestamptz;
