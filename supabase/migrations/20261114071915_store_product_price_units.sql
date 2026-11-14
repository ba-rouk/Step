ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS price_unit text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS price_unit_label text;

ALTER TABLE public.store_products
  DROP CONSTRAINT IF EXISTS store_products_price_unit_check;

ALTER TABLE public.store_products
  ADD CONSTRAINT store_products_price_unit_check
  CHECK (price_unit IN ('unit', 'kg', 'g', 'litre', 'dozen', 'serving', 'tray', 'other'));

ALTER TABLE public.store_products
  DROP CONSTRAINT IF EXISTS store_products_price_unit_label_check;

ALTER TABLE public.store_products
  ADD CONSTRAINT store_products_price_unit_label_check
  CHECK (price_unit_label IS NULL OR char_length(btrim(price_unit_label)) BETWEEN 1 AND 32);

UPDATE public.store_products
SET price_unit = 'unit'
WHERE price_unit IS NULL OR btrim(price_unit) = '';
