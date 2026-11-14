-- Step Town: canonical Cake category, catalog keys/indexes, guest orders and account carts.
-- Idempotent and data-preserving: move products before removing a duplicate legacy category.
DO $$
DECLARE
  v_old_id uuid;
  v_cake_id uuid;
BEGIN
  SELECT id INTO v_cake_id
  FROM public.store_categories
  WHERE slug = 'cake' OR lower(btrim(name)) = 'cake'
  ORDER BY CASE WHEN slug = 'cake' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT id INTO v_old_id
  FROM public.store_categories
  WHERE slug = 'wedding-cakes'
     OR lower(btrim(name)) IN ('wedding cakes', 'wedding cake')
  ORDER BY CASE WHEN slug = 'wedding-cakes' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_old_id IS NOT NULL AND v_cake_id IS NOT NULL AND v_old_id <> v_cake_id THEN
    UPDATE public.store_products SET category_id = v_cake_id WHERE category_id = v_old_id;
    DELETE FROM public.store_categories WHERE id = v_old_id;
  ELSIF v_old_id IS NOT NULL THEN
    UPDATE public.store_categories SET name = 'Cake', slug = 'cake' WHERE id = v_old_id;
  ELSIF v_cake_id IS NULL THEN
    INSERT INTO public.store_categories(name, slug, description, sort_order, is_active)
    VALUES ('Cake', 'cake', 'Made-to-order cakes for weddings and celebrations.', 3, true);
  END IF;
END $$;

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS slug text;
UPDATE public.store_products
SET slug = COALESCE(NULLIF(slug, ''), trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')))
WHERE slug IS NULL OR slug = '';

WITH duplicates AS (
  SELECT id, slug,
         row_number() OVER (PARTITION BY slug ORDER BY created_at, id) AS position
  FROM public.store_products
)
UPDATE public.store_products p
SET slug = CASE WHEN d.position = 1 THEN d.slug ELSE d.slug || '-' || left(p.id::text, 6) END
FROM duplicates d
WHERE p.id = d.id AND d.position > 1;

CREATE OR REPLACE FUNCTION public.set_store_product_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_base text;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    v_base := trim(both '-' from regexp_replace(lower(btrim(NEW.name)), '[^a-z0-9]+', '-', 'g'));
    IF v_base = '' THEN v_base := 'product'; END IF;
    NEW.slug := v_base;
    IF EXISTS (SELECT 1 FROM public.store_products p WHERE p.slug = NEW.slug AND p.id IS DISTINCT FROM NEW.id) THEN
      NEW.slug := v_base || '-' || left(COALESCE(NEW.id, gen_random_uuid())::text, 6);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS store_products_set_slug ON public.store_products;
CREATE TRIGGER store_products_set_slug
BEFORE INSERT OR UPDATE OF name, slug ON public.store_products
FOR EACH ROW EXECUTE FUNCTION public.set_store_product_slug();

CREATE UNIQUE INDEX IF NOT EXISTS store_products_slug_uidx ON public.store_products (slug);
CREATE INDEX IF NOT EXISTS store_products_public_menu_idx
  ON public.store_products (is_available, is_visible, sort_order, id);
CREATE INDEX IF NOT EXISTS store_products_category_menu_idx
  ON public.store_products (category_id, is_available, is_visible, sort_order, id);
CREATE INDEX IF NOT EXISTS product_images_product_position_idx
  ON public.product_images (product_id, position, id);

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS order_description text,
  ADD COLUMN IF NOT EXISTS requested_time text;

CREATE SEQUENCE IF NOT EXISTS public.step_town_order_number_seq START WITH 1001;
SELECT setval(
  'public.step_town_order_number_seq',
  GREATEST(1000, COALESCE(MAX(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '')::bigint), 1000)),
  true
) FROM public.store_orders;
UPDATE public.store_orders
SET order_number = 'ST-' || nextval('public.step_town_order_number_seq')::text
WHERE order_number IS NULL OR btrim(order_number) = '';

CREATE OR REPLACE FUNCTION public.set_step_town_order_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := 'ST-' || nextval('public.step_town_order_number_seq')::text;
  END IF;
  RETURN NEW;
END $;
DROP TRIGGER IF EXISTS store_orders_set_order_number ON public.store_orders;
CREATE TRIGGER store_orders_set_order_number
BEFORE INSERT ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.set_step_town_order_number();
CREATE UNIQUE INDEX IF NOT EXISTS store_orders_order_number_uidx
  ON public.store_orders(order_number);

ALTER TABLE public.store_orders
  DROP CONSTRAINT IF EXISTS store_orders_requested_time_check;
ALTER TABLE public.store_orders
  ADD CONSTRAINT store_orders_requested_time_check
  CHECK (requested_time IS NULL OR requested_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_order_description_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_order_description_check
  CHECK (order_description IS NULL OR char_length(order_description) <= 4000);
CREATE INDEX IF NOT EXISTS store_orders_customer_created_idx
  ON public.store_orders (customer_id, created_at DESC);

GRANT SELECT ON public.store_orders TO authenticated;
DROP POLICY IF EXISTS "Customers read their own store orders" ON public.store_orders;
CREATE POLICY "Customers read their own store orders"
  ON public.store_orders FOR SELECT TO authenticated
  USING (customer_id = auth.uid());
DROP POLICY IF EXISTS "Active staff read store orders" ON public.store_orders;
CREATE POLICY "Active staff read store orders"
  ON public.store_orders FOR SELECT TO authenticated
  USING (private.staff_has_role(ARRAY['manager','accountant','cashier']::text[]));

CREATE TABLE IF NOT EXISTS public.customer_cart_items (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.customer_cart_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_cart_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_cart_items TO authenticated;
DROP POLICY IF EXISTS "Customers read their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers read their own cart" ON public.customer_cart_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers add to their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers add to their own cart" ON public.customer_cart_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers update their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers update their own cart" ON public.customer_cart_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers remove from their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers remove from their own cart" ON public.customer_cart_items
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Order writes must go through the rate-limited Node API using its server-only service key.
-- The public key remains read-only for the menu and cannot insert orders directly.
DROP POLICY IF EXISTS "Public visitors can submit store orders" ON public.store_orders;
REVOKE INSERT ON public.store_orders FROM anon, authenticated;
GRANT INSERT, SELECT ON public.store_orders TO service_role;
);
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_order_description_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_order_description_check
  CHECK (order_description IS NULL OR char_length(order_description) <= 4000);
CREATE INDEX IF NOT EXISTS store_orders_customer_created_idx
  ON public.store_orders (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_cart_items (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.customer_cart_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_cart_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_cart_items TO authenticated;
DROP POLICY IF EXISTS "Customers read their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers read their own cart" ON public.customer_cart_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers add to their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers add to their own cart" ON public.customer_cart_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers update their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers update their own cart" ON public.customer_cart_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Customers remove from their own cart" ON public.customer_cart_items;
CREATE POLICY "Customers remove from their own cart" ON public.customer_cart_items
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Order writes must go through the rate-limited Node API with its server-only service key.
DROP POLICY IF EXISTS "Public visitors can submit store orders" ON public.store_orders;
REVOKE INSERT ON public.store_orders FROM anon, authenticated;
GRANT INSERT, SELECT ON public.store_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.step_town_order_number_seq TO service_role;
