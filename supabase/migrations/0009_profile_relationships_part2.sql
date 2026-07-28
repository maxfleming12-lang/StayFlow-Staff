-- =====================================================================
-- StayFlow Staff — 0009 remaining profile relationships
--
-- 0007 fixed employment_details and emergency_contacts after the
-- management roster silently showed no staff. The same defect exists on
-- every other table whose user_id references auth.users directly:
-- PostgREST cannot infer a relationship to `profiles`, so embedding a
-- staff name in a query fails with PGRST200.
--
-- Fixed here in one pass rather than one at a time as each screen is
-- built and breaks. profiles.id is itself a foreign key to auth.users(id),
-- so these references always hold the same value; they make the
-- relationship discoverable, and an embedded resource is still filtered
-- by its own RLS policies.
-- =====================================================================

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('leave_requests',      'user_id'),
      ('staff_availability',  'user_id'),
      ('shifts',              'user_id'),
      ('timesheets',          'user_id'),
      ('clock_events',        'user_id'),
      ('shift_acknowledgements', 'user_id'),
      ('timesheet_adjustment_requests', 'user_id'),
      ('task_assignments',    'user_id'),
      ('task_comments',       'user_id'),
      ('notifications',       'user_id'),
      ('push_subscriptions',  'user_id'),
      ('document_acknowledgements', 'user_id'),
      ('announcement_acknowledgements', 'user_id'),
      ('calendar_tokens',     'user_id')
    ) as t(table_name, column_name)
  loop
    execute format(
      'alter table %I drop constraint if exists %I',
      target.table_name, target.table_name || '_profile_fk');

    execute format(
      'alter table %I add constraint %I foreign key (%I)
         references profiles(id) on delete cascade',
      target.table_name,
      target.table_name || '_profile_fk',
      target.column_name);
  end loop;
end $$;

-- The reviewer/approver columns are also worth embedding — a manager's
-- name next to a decision is more useful than their uuid.
alter table leave_requests drop constraint if exists leave_requests_reviewer_profile_fk;
alter table leave_requests
  add constraint leave_requests_reviewer_profile_fk
  foreign key (reviewed_by) references profiles(id) on delete set null;

comment on constraint leave_requests_profile_fk on leave_requests is
  'Makes profiles -> leave_requests discoverable to PostgREST so a staff
   name can be embedded. RLS on both tables still applies.';
