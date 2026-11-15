DO $vitanova_staff_brand$
DECLARE
  fn record;
  definition text;
BEGIN
  FOR fn IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('staff_update_order', 'staff_update_enquiry')
      AND p.prokind = 'f'
  LOOP
    definition := pg_get_functiondef(fn.oid);
    IF position('Active Step Town staff access required.' IN definition) > 0 THEN
      definition := replace(
        definition,
        'Active Step Town staff access required.',
        'Active Vitanova staff access required.'
      );
      EXECUTE definition;
    END IF;
  END LOOP;
END
$vitanova_staff_brand$;
