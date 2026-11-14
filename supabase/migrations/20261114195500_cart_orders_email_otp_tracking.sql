-- Secure cart/order lifecycle, verified-email history and durable message delivery.
-- Orders remain writable only by the service-role order endpoint.

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_token text;

ALTER TABLE public.store_orders
  ALTER COLUMN tracking_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE public.store_orders
SET tracking_token = encode(gen_random_bytes(16), 'hex')
WHERE tracking_token IS NULL OR tracking_token = '';

UPDATE public.store_orders
SET user_id = customer_id
WHERE user_id IS NULL AND customer_id IS NOT NULL;

ALTER TABLE public.store_orders
  ALTER COLUMN tracking_token SET NOT NULL;

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS customer_email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(customer_email)), '')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS store_orders_tracking_token_uidx
  ON public.store_orders(tracking_token);

CREATE INDEX IF NOT EXISTS store_orders_customer_email_normalized_created_idx
  ON public.store_orders(customer_email_normalized, created_at DESC)
  WHERE customer_email_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS store_orders_user_created_idx
  ON public.store_orders(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','email_change')),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);

CREATE INDEX IF NOT EXISTS login_codes_email_created_idx
  ON public.login_codes(email_normalized, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS login_codes_expiry_idx
  ON public.login_codes(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.login_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  event_type text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_verification_events_email_created_idx
  ON public.login_verification_events(email_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('order_confirmation','login_code','order_push')),
  recipient text,
  order_id uuid REFERENCES public.store_orders(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_ready_idx
  ON public.email_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending','processing');

ALTER TABLE public.login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.login_codes, public.login_verification_events, public.email_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.login_codes, public.login_verification_events, public.email_outbox TO service_role;

REVOKE INSERT ON public.store_orders FROM anon, authenticated;
DROP POLICY IF EXISTS "Customers can place their own store orders" ON public.store_orders;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_verified_customer_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(u.email))
  FROM auth.users AS u
  JOIN public.customer_profiles AS cp ON cp.user_id = u.id
  WHERE u.id = (SELECT auth.uid())
    AND u.email_confirmed_at IS NOT NULL
    AND cp.email_verified_at IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_verified_customer_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_verified_customer_email() TO authenticated;

DROP POLICY IF EXISTS "Customers and staff can view allowed store orders" ON public.store_orders;
CREATE POLICY "Customers and staff can view allowed store orders"
  ON public.store_orders
  FOR SELECT TO authenticated
  USING (
    private.staff_has_role(ARRAY['manager'::text, 'accountant'::text, 'cashier'::text])
    OR (
      (SELECT private.current_verified_customer_email()) IS NOT NULL
      AND (
        customer_id = (SELECT auth.uid())
        OR user_id = (SELECT auth.uid())
        OR customer_email_normalized = (SELECT private.current_verified_customer_email())
      )
    )
  );

GRANT SELECT ON public.store_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_step_login_code(
  p_email text,
  p_code_hash text,
  p_purpose text,
  p_target_user_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.login_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.login_codes
  WHERE email_normalized = lower(btrim(p_email))
    AND purpose = p_purpose
    AND target_user_id IS NOT DISTINCT FROM p_target_user_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF v_row.consumed_at IS NOT NULL THEN RETURN 'used'; END IF;
  IF v_row.expires_at <= now() THEN
    UPDATE public.login_codes SET consumed_at = now() WHERE id = v_row.id;
    RETURN 'expired';
  END IF;
  IF v_row.attempts >= 5 THEN
    UPDATE public.login_codes SET consumed_at = now() WHERE id = v_row.id;
    RETURN 'locked';
  END IF;
  IF v_row.code_hash <> p_code_hash THEN
    UPDATE public.login_codes
    SET attempts = attempts + 1,
        consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE NULL END
    WHERE id = v_row.id;
    RETURN CASE WHEN v_row.attempts + 1 >= 5 THEN 'locked' ELSE 'invalid' END;
  END IF;

  UPDATE public.login_codes SET consumed_at = now() WHERE id = v_row.id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_step_login_code(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_step_login_code(text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_step_email_jobs(p_limit integer DEFAULT 8)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH ready AS (
    SELECT id
    FROM public.email_outbox
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
    ORDER BY next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 8), 25))
  )
  UPDATE public.email_outbox AS job
  SET status = 'processing',
      attempts = job.attempts + 1,
      locked_at = now()
  FROM ready
  WHERE job.id = ready.id
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_step_email_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_step_email_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_step_order_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order jsonb;
BEGIN
  v_order := jsonb_build_object(
    'order_number', NEW.order_number,
    'tracking_token', NEW.tracking_token,
    'customer_name', NEW.customer_name,
    'customer_email', NEW.customer_email,
    'fulfillment', NEW.fulfillment,
    'requested_date', NEW.requested_date,
    'requested_time', NEW.requested_time,
    'delivery_location', NEW.delivery_location,
    'order_description', NEW.order_description,
    'notes', NEW.notes,
    'items', NEW.items,
    'estimated_total', NEW.estimated_total
  );

  INSERT INTO public.email_outbox(job_type, recipient, order_id, payload)
  VALUES ('order_push', NULL, NEW.id, jsonb_build_object('order_id', NEW.id));

  IF NULLIF(lower(btrim(NEW.customer_email)), '') IS NOT NULL THEN
    INSERT INTO public.email_outbox(job_type, recipient, order_id, payload)
    VALUES ('order_confirmation', lower(btrim(NEW.customer_email)), NEW.id, jsonb_build_object('order', v_order));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_step_order_notifications ON public.store_orders;
CREATE TRIGGER enqueue_step_order_notifications
AFTER INSERT ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.enqueue_step_order_notifications();

REVOKE ALL ON FUNCTION public.enqueue_step_order_notifications() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
