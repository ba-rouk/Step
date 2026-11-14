-- Trigram indexes support the public menu's partial name/description search.
create extension if not exists pg_trgm;
create index if not exists store_products_name_trgm_idx
  on public.store_products using gin (name gin_trgm_ops);
create index if not exists store_products_description_trgm_idx
  on public.store_products using gin (description gin_trgm_ops);
