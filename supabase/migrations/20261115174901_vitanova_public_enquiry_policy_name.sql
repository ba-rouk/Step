DO $vitanova_policy_names$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='enquiries'
      AND policyname='Public visitors can submit Step Town enquiries'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='enquiries'
      AND policyname='Public visitors can submit Vitanova enquiries'
  ) THEN
    ALTER POLICY "Public visitors can submit Step Town enquiries"
      ON public.enquiries RENAME TO "Public visitors can submit Vitanova enquiries";
  END IF;
END
$vitanova_policy_names$;
