-- Let a signed-in customer see orders made earlier as a guest using
-- the same authenticated email address. Keep guest order insertion private.
ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.store_orders
SET customer_email = lower(btrim(customer_email))
WHERE customer_email IS NOT NULL
  AND customer_email <> lower(btrim(customer_email));

CREATE INDEX IF NOT EXISTS store_orders_customer_email_created_idx
  ON public.store_orders (lower(btrim(customer_email)), created_at DESC)
  WHERE customer_email IS NOT NULL;

GRANT SELECT ON public.store_orders TO authenticated;

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
          lower(btrim(coalesce((SELECT auth.jwt() ->> 'email'), '')))
    )
  );

NOTIFY pgrst, 'reload schema';
