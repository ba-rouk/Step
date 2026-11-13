-- Step Town staff operations: additive changes only.
-- Preserve legacy enquiry statuses while enabling the requested sales pipeline.
ALTER TABLE public.enquiries
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS converted_order_id uuid;
ALTER TABLE public.enquiries DROP CONSTRAINT IF EXISTS enquiries_status_check;
ALTER TABLE public.enquiries ADD CONSTRAINT enquiries_status_check
  CHECK (status = ANY (ARRAY['new','contacted','quoted','won','lost','confirmed','closed']::text[]));
ALTER TABLE public.enquiries DROP CONSTRAINT IF EXISTS enquiries_internal_notes_check;
ALTER TABLE public.enquiries ADD CONSTRAINT enquiries_internal_notes_check
  CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 3000);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enquiries_converted_order_id_fkey' AND conrelid='public.enquiries'::regclass) THEN
    ALTER TABLE public.enquiries ADD CONSTRAINT enquiries_converted_order_id_fkey
      FOREIGN KEY (converted_order_id) REFERENCES public.store_orders(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_cancellation_reason_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 1000);
CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON public.enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_created_at_idx ON public.store_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS store_order_payments_recorded_at_idx ON public.store_order_payments (recorded_at DESC);

CREATE OR REPLACE FUNCTION public.staff_update_order(
  p_order_id uuid, p_status text DEFAULT NULL, p_estimated_total numeric DEFAULT NULL,
  p_update_total boolean DEFAULT false, p_notes text DEFAULT NULL,
  p_update_notes boolean DEFAULT false, p_cancel_reason text DEFAULT NULL
) RETURNS public.store_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$
DECLARE v_role text; v_old public.store_orders%ROWTYPE; v_new public.store_orders%ROWTYPE;
BEGIN
  SELECT sp.role INTO v_role FROM public.staff_profiles sp
  WHERE sp.user_id=auth.uid() AND sp.is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('manager','accountant','cashier') THEN
    RAISE EXCEPTION 'Active Step Town staff access required.' USING ERRCODE='42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('new','confirmed','preparing','ready','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid order status.' USING ERRCODE='22023';
  END IF;
  IF v_role='cashier' AND (p_update_total OR p_update_notes) THEN
    RAISE EXCEPTION 'Only an Accountant or Manager can correct order details.' USING ERRCODE='42501';
  END IF;
  IF p_update_total AND p_estimated_total IS NOT NULL AND p_estimated_total<0 THEN
    RAISE EXCEPTION 'Order total cannot be negative.' USING ERRCODE='22023';
  END IF;
  IF p_status='cancelled' AND (p_cancel_reason IS NULL OR char_length(btrim(p_cancel_reason))<3) THEN
    RAISE EXCEPTION 'Enter a cancellation reason.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_old FROM public.store_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE='P0002'; END IF;
  UPDATE public.store_orders SET
    status=COALESCE(p_status,status),
    estimated_total=CASE WHEN p_update_total THEN p_estimated_total ELSE estimated_total END,
    notes=CASE WHEN p_update_notes THEN p_notes ELSE notes END,
    cancellation_reason=CASE WHEN p_status='cancelled' THEN left(btrim(p_cancel_reason),1000)
      WHEN p_status IS NOT NULL THEN NULL ELSE cancellation_reason END,
    acknowledged_at=CASE WHEN p_status IS NOT NULL AND p_status<>'new' THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,
    updated_at=now(), updated_by=auth.uid()
  WHERE id=p_order_id RETURNING * INTO v_new;
  IF v_old.status IS DISTINCT FROM v_new.status THEN
    INSERT INTO public.store_order_events(order_id,actor_id,event_type,old_status,new_status,description)
    VALUES(p_order_id,auth.uid(),'status_change',v_old.status,v_new.status,'Order status changed by '||v_role);
  END IF;
  INSERT INTO public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(auth.uid(),v_role,CASE WHEN v_old.status IS DISTINCT FROM v_new.status THEN 'order_status_changed' ELSE 'order_corrected' END,
    'store_order',p_order_id::text,jsonb_build_object('old_status',v_old.status,'new_status',v_new.status,
    'total_updated',p_update_total,'notes_updated',p_update_notes,'cancellation_reason_set',(v_new.status='cancelled')));
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.staff_update_enquiry(
  p_enquiry_id uuid, p_status text DEFAULT NULL,
  p_internal_notes text DEFAULT NULL, p_update_notes boolean DEFAULT false
) RETURNS public.enquiries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$
DECLARE v_role text; v_old public.enquiries%ROWTYPE; v_new public.enquiries%ROWTYPE;
BEGIN
  SELECT sp.role INTO v_role FROM public.staff_profiles sp
  WHERE sp.user_id=auth.uid() AND sp.is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('manager','accountant','cashier') THEN
    RAISE EXCEPTION 'Active Step Town staff access required.' USING ERRCODE='42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('new','contacted','quoted','won','lost','confirmed','closed') THEN
    RAISE EXCEPTION 'Invalid enquiry status.' USING ERRCODE='22023';
  END IF;
  IF p_update_notes AND p_internal_notes IS NOT NULL AND char_length(p_internal_notes)>3000 THEN
    RAISE EXCEPTION 'Internal notes must be 3000 characters or fewer.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_old FROM public.enquiries WHERE id=p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enquiry not found.' USING ERRCODE='P0002'; END IF;
  UPDATE public.enquiries SET status=COALESCE(p_status,status),
    internal_notes=CASE WHEN p_update_notes THEN p_internal_notes ELSE internal_notes END
  WHERE id=p_enquiry_id RETURNING * INTO v_new;
  INSERT INTO public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(auth.uid(),v_role,'enquiry_updated','enquiry',p_enquiry_id::text,
    jsonb_build_object('old_status',v_old.status,'new_status',v_new.status,'internal_notes_updated',p_update_notes));
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.staff_convert_enquiry_to_order(
  p_enquiry_id uuid, p_estimated_total numeric DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS public.store_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$
DECLARE v_role text; v_enquiry public.enquiries%ROWTYPE; v_order public.store_orders%ROWTYPE;
BEGIN
  SELECT sp.role INTO v_role FROM public.staff_profiles sp
  WHERE sp.user_id=auth.uid() AND sp.is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('manager','accountant') THEN
    RAISE EXCEPTION 'Accountant or Manager access required to convert enquiries.' USING ERRCODE='42501';
  END IF;
  IF p_estimated_total IS NOT NULL AND p_estimated_total<0 THEN
    RAISE EXCEPTION 'Order total cannot be negative.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_enquiry FROM public.enquiries WHERE id=p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enquiry not found.' USING ERRCODE='P0002'; END IF;
  IF v_enquiry.converted_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'This enquiry has already been converted.' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.store_orders(customer_name,customer_phone,fulfillment,requested_date,delivery_location,notes,items,estimated_total,price_needs_confirmation)
  VALUES(v_enquiry.name,v_enquiry.phone,'event',v_enquiry.event_date,v_enquiry.event_location,
    left(COALESCE(NULLIF(btrim(p_notes),''),v_enquiry.details,''),3000),
    jsonb_build_array(jsonb_build_object('name','Event enquiry: '||v_enquiry.service,'category','Event catering',
      'quantity',1,'unit_price',p_estimated_total,'line_total',p_estimated_total)),
    p_estimated_total,(p_estimated_total IS NULL))
  RETURNING * INTO v_order;
  UPDATE public.enquiries SET converted_order_id=v_order.id,status='won' WHERE id=p_enquiry_id;
  INSERT INTO public.store_order_events(order_id,actor_id,event_type,new_status,description)
  VALUES(v_order.id,auth.uid(),'created_from_enquiry','new','Order created from enquiry '||p_enquiry_id::text);
  INSERT INTO public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(auth.uid(),v_role,'enquiry_converted_to_order','enquiry',p_enquiry_id::text,
    jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number));
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.staff_update_order_payment(
  p_payment_id uuid,p_method text,p_amount numeric,p_reference text DEFAULT NULL,p_notes text DEFAULT NULL
) RETURNS public.store_order_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$
DECLARE v_role text; v_payment public.store_order_payments%ROWTYPE;
BEGIN
  SELECT sp.role INTO v_role FROM public.staff_profiles sp
  WHERE sp.user_id=auth.uid() AND sp.is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('manager','accountant') THEN
    RAISE EXCEPTION 'Accountant or Manager access required to correct payments.' USING ERRCODE='42501';
  END IF;
  IF p_method NOT IN ('cash','mobile_money') OR p_amount IS NULL OR p_amount<=0 THEN
    RAISE EXCEPTION 'Enter a valid payment method and positive amount.' USING ERRCODE='22023';
  END IF;
  UPDATE public.store_order_payments SET method=p_method,amount=p_amount,
    reference=NULLIF(left(btrim(p_reference),160),''),notes=NULLIF(left(btrim(p_notes),1000),'')
  WHERE id=p_payment_id RETURNING * INTO v_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(auth.uid(),v_role,'payment_corrected','store_order_payment',p_payment_id::text,
    jsonb_build_object('order_id',v_payment.order_id,'method',p_method,'amount',p_amount));
  RETURN v_payment;
END $$;

CREATE OR REPLACE FUNCTION public.staff_delete_order_payment(p_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$
DECLARE v_role text; v_payment public.store_order_payments%ROWTYPE;
BEGIN
  SELECT sp.role INTO v_role FROM public.staff_profiles sp
  WHERE sp.user_id=auth.uid() AND sp.is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('manager','accountant') THEN
    RAISE EXCEPTION 'Accountant or Manager access required to remove payments.' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.store_order_payments WHERE id=p_payment_id RETURNING * INTO v_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
  VALUES(auth.uid(),v_role,'payment_deleted','store_order_payment',p_payment_id::text,
    jsonb_build_object('order_id',v_payment.order_id,'amount',v_payment.amount));
  RETURN true;
END $$;

REVOKE UPDATE ON TABLE public.store_orders FROM authenticated;
REVOKE UPDATE ON TABLE public.enquiries FROM authenticated;
REVOKE ALL ON FUNCTION public.staff_update_order(uuid,text,numeric,boolean,text,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_update_enquiry(uuid,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_convert_enquiry_to_order(uuid,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_update_order_payment(uuid,text,numeric,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_delete_order_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_update_order(uuid,text,numeric,boolean,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_enquiry(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_convert_enquiry_to_order(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_order_payment(uuid,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_delete_order_payment(uuid) TO authenticated;
