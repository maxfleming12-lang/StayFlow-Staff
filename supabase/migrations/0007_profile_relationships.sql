-- =====================================================================
-- StayFlow Staff — 0007 discoverable profile relationships
--
-- employment_details.user_id and emergency_contacts.user_id referenced
-- auth.users directly, so PostgREST could not infer a relationship
-- between them and `profiles`. Embedding them in a profiles query failed
-- with PGRST200 ("Could not find a relationship"), which meant the
-- management roster silently showed no staff at all.
--
-- profiles.id is itself a foreign key to auth.users(id), so adding a
-- second reference to profiles(id) is consistent, not contradictory: the
-- two columns always hold the same value. It makes the relationship
-- discoverable to PostgREST, and — importantly — an embedded resource is
-- still filtered by its own RLS policies, so a supervisor embedding
-- employment_details receives null rather than a pay rate.
-- =====================================================================

alter table employment_details
  drop constraint if exists employment_details_profile_fk;

alter table employment_details
  add constraint employment_details_profile_fk
  foreign key (user_id) references profiles(id) on delete cascade;

alter table emergency_contacts
  drop constraint if exists emergency_contacts_profile_fk;

alter table emergency_contacts
  add constraint emergency_contacts_profile_fk
  foreign key (user_id) references profiles(id) on delete cascade;

comment on constraint employment_details_profile_fk on employment_details is
  'Makes the profiles -> employment_details relationship discoverable to
   PostgREST. RLS on employment_details still applies to the embed.';

comment on constraint emergency_contacts_profile_fk on emergency_contacts is
  'Makes the profiles -> emergency_contacts relationship discoverable to
   PostgREST. RLS on emergency_contacts still applies to the embed.';
