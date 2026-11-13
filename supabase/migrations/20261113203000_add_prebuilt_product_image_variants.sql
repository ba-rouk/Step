-- Store static responsive variants so image srcset works without on-demand transformation plans.
alter table public.product_images
  add column if not exists variants jsonb not null default '{}'::jsonb;

comment on column public.product_images.variants is
  'Pre-generated public image variants keyed by pixel width (e.g. 480, 800, 1200); avoids paid on-demand transformations.';
