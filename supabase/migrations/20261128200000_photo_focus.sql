-- =====================================================================
-- Step 9b: photo position on cards.
-- Run once, after 20261128190000_checkout_price_check.sql.
--
-- Cards show photos in a 4:5 frame. The seller picks what shows:
--   focus_x / focus_y = the point of the photo at the middle of the frame
--                       (0–100 %, default 50 = center)
--   zoom              = 1 to 3 (100 %–300 %, default 1)
-- The photo file itself is never cropped or changed. Who can change these:
-- members of the shop (existing photo rules).
-- =====================================================================

alter table public.product_photos
  add column focus_x numeric(5,2) not null default 50,
  add column focus_y numeric(5,2) not null default 50,
  add column zoom    numeric(4,3) not null default 1,
  add constraint product_photos_focus_x_range check (focus_x between 0 and 100),
  add constraint product_photos_focus_y_range check (focus_y between 0 and 100),
  add constraint product_photos_zoom_range    check (zoom between 1 and 3);
