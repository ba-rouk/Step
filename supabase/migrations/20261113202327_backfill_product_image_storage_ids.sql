-- Recover the original Storage object path for legacy images migrated from image_url/image_urls.
-- This enables the normal Storage API removal flow when a staff member deletes a migrated image.
update public.product_images
set public_id = regexp_replace(
  split_part(url, '?', 1),
  '^https?://[^/]+/storage/v1/object/public/step-town-media/',
  ''
)
where public_id is null
  and split_part(url, '?', 1) ~ '^https?://[^/]+/storage/v1/object/public/step-town-media/.+';
