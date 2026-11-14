-- Let a signed-in customer see orders made earlier as a guest using
-- the same verified account email. Keep guest order insertion private.
ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.store_orders
SET customer_email = lower(btrim(customer_email))
WHERE customer_email IS NOT NULL
  AND customer_email <> lower(btrim(customer_email));

CREATE INDEX IF NOT EXISTS store_orders_customer_email_created_idx
  ON public.store_orders (customer_email, created_at DESC)
  WHERE customer_email IS NOT NULL;

-- Older order snapshots did not include product photos. Recover their current
-- primary image from the catalogue where the original product still exists.
UPDATE public.store_orders AS so
SET items = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN NULLIF(entry.item->>'image_url', '') IS NOT NULL THEN entry.item
      WHEN COALESCE(primary_image.url, product.image_url) IS NOT NULL
        THEN jsonb_set(entry.item, '{image_url}', to_jsonb(COALESCE(primary_image.url, product.image_url)), true)
      ELSE entry.item
    END ORDER BY entry.ord
  ), '[]'::jsonb)
  FROM jsonb_array_elements(so.items) WITH ORDINALITY AS entry(item, ord)
  LEFT JOIN public.store_products AS product
    ON product.id = CASE
      WHEN entry.item->>'product_id' ~* '^[0-9a-f-]{36}$'
      THEN (entry.item->>'product_id')::uuid
      ELSE NULL
    END
  LEFT JOIN LATERAL (
    SELECT url
    FROM public.product_images
    WHERE product_id = product.id
    ORDER BY position ASC
    LIMIT 1
  ) AS primary_image ON true
)
WHERE jsonb_typeof(so.items) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(so.items) AS entry(item)
    WHERE NULLIF(entry.item->>'image_url', '') IS NULL
      AND NULLIF(entry.item->>'product_id', '') IS NOT NULL
  );

GRANT SELECT ON public.store_orders TO authenticated;

-- Only a verified account email can unlock guest orders associated with it.
-- Keep the lookup in a non-exposed schema and scope it to auth.uid().
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_verified_customer_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(u.email))
  FROM auth.users AS u
  WHERE u.id = (SELECT auth.uid())
    AND u.email_confirmed_at IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_verified_customer_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_verified_customer_email() TO authenticated;

DROP POLICY IF EXISTS "Customers read orders by account or exact email" ON public.store_orders;
CREATE POLICY "Customers read orders by account or exact email"
  ON public.store_orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR (
      customer_email IS NOT NULL
      AND lower(btrim(customer_email)) =
          (SELECT private.current_verified_customer_email())
    )
  );

NOTIFY pgrst, 'reload schema';
