-- =====================================================================
-- StayFlow Staff — 0010 availability notification category
--
-- Availability decisions were being filed under `leave_update` for want
-- of a better value. That is wrong in a way that matters: notification
-- preferences let a staff member mute categories, so someone muting
-- leave updates would silently stop hearing about availability, and the
-- notification centre's category filter would group unrelated items.
--
-- ADD VALUE is safe inside a migration on PostgreSQL 12+, provided the
-- new value is not itself used in the same transaction — it is not.
-- =====================================================================

alter type notification_category add value if not exists 'availability_update';
