-- =====================================================================
-- StayFlow Staff — Row Level Security test suite
--
-- Run against a freshly seeded local stack:
--   supabase db reset
--   docker exec -i supabase_db_stayflow-staff \
--     psql -U postgres -d postgres -f - < supabase/tests/rls_test.sql
--
-- Each check asserts what a given role CAN and CANNOT reach. Results are
-- printed as a table; any FAIL row means a policy is not doing its job.
--
-- Impersonation works by setting the `authenticated` role and the JWT
-- claims Supabase derives auth.uid() from — the same path a real request
-- takes, so these tests exercise the actual policies rather than a mock.
-- =====================================================================

\set ON_ERROR_STOP on
\pset pager off

-- Helpers live in a throwaway schema that is dropped at the end of the run.
-- act_as() sets JWT claims, so it must never persist in a real database.
drop schema if exists rls_harness cascade;
create schema rls_harness;
-- act_as() switches to the `authenticated` role mid-block, so that role
-- needs USAGE to call the harness back. Scoped to this throwaway schema,
-- which is dropped at the end of the run.
grant usage on schema rls_harness to authenticated, anon;
set search_path = rls_harness, public;

create temporary table rls_results (
  seq        serial,
  area       text,
  actor      text,
  expectation text,
  outcome    text
);

create or replace function rls_harness.record_check(
  p_area text, p_actor text, p_expectation text, p_passed boolean
) returns void language plpgsql as $$
begin
  insert into rls_results (area, actor, expectation, outcome)
  values (p_area, p_actor, p_expectation,
          case when p_passed then 'PASS' else 'FAIL' end);
end;
$$;

/** Impersonate a seeded user for subsequent statements in this transaction. */
create or replace function rls_harness.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true);
end;
$$;

/** Drop back to superuser so the harness can write its own results. */
create or replace function rls_harness.act_as_harness() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on all functions in schema rls_harness to authenticated, anon;

do $$
declare
  org_id       uuid := '00000000-0000-4000-8000-000000000001';
  coastal_id   uuid := '00000000-0000-4000-8000-000000000010';
  lodge_id     uuid := '00000000-0000-4000-8000-000000000011';
  u_owner      uuid := '00000000-0000-4000-8000-000000000100';
  u_manager    uuid := '00000000-0000-4000-8000-000000000101';
  u_supervisor uuid := '00000000-0000-4000-8000-000000000102';
  u_staff1     uuid := '00000000-0000-4000-8000-000000000103';  -- Coastal
  u_staff3     uuid := '00000000-0000-4000-8000-000000000105';  -- Holiday Lodge
  n            integer;
  ok           boolean;
  shift_ccm    uuid;
  ts_id        uuid;
  team_mgmt    uuid := '00000000-0000-4000-8000-000000000020';
  rival_org    uuid := '99999999-0000-4000-8000-000000000001';
  rival_user   uuid := '99999999-0000-4000-8000-000000000002';
  rival_ts     uuid := '11111111-0000-4000-8000-000000000001';
  mgr_ts       uuid := '11111111-0000-4000-8000-000000000002';
begin
  -- ==============================================================
  -- Fixtures created as the harness (service context)
  -- ==============================================================
  perform rls_harness.act_as_harness();

  insert into shifts (id, organisation_id, property_id, user_id,
                      starts_at, ends_at, status, is_open_shift)
  values (gen_random_uuid(), org_id, coastal_id, u_staff1,
          now() + interval '1 day', now() + interval '1 day 8 hours',
          'published', false)
  returning id into shift_ccm;

  insert into timesheets (id, organisation_id, property_id, user_id,
                          work_date, actual_start, actual_end,
                          paid_hours, status)
  values (gen_random_uuid(), org_id, coastal_id, u_staff1,
          current_date, now() - interval '8 hours', now(), 7.5, 'approved')
  returning id into ts_id;

  -- ==============================================================
  -- CONFIDENTIAL EMPLOYMENT DATA
  -- ==============================================================
  perform rls_harness.act_as(u_supervisor);
  select count(*) into n from employment_details where user_id <> u_supervisor;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('employment_details', 'supervisor',
    'cannot read colleagues'' pay rates', n = 0);

  perform rls_harness.act_as(u_supervisor);
  select count(*) into n from emergency_contacts where user_id <> u_supervisor;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('emergency_contacts', 'supervisor',
    'cannot read colleagues'' emergency contacts', n = 0);

  perform rls_harness.act_as(u_manager);
  select count(*) into n from employment_details;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('employment_details', 'manager',
    'can read pay rates across the organisation', n >= 7);

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from employment_details;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('employment_details', 'staff',
    'sees own employment record only', n = 1);

  -- A staff member must not be able to give themselves a pay rise.
  perform rls_harness.act_as(u_staff1);
  begin
    update employment_details set hourly_rate = 999 where user_id = u_staff1;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('employment_details', 'staff',
    'cannot edit own pay rate', ok);

  -- ==============================================================
  -- PROPERTY BOUNDARIES
  -- ==============================================================
  perform rls_harness.act_as(u_staff3);   -- Holiday Lodge only
  select count(*) into n from shifts where property_id = coastal_id;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shifts', 'staff (Holiday Lodge)',
    'cannot see Coastal Comfort shifts', n = 0);

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from shifts where id = shift_ccm;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shifts', 'staff (Coastal)',
    'can see own published shift', n = 1);

  -- A draft shift must stay invisible to the staff member it names.
  perform rls_harness.act_as_harness();
  update shifts set status = 'draft' where id = shift_ccm;
  perform rls_harness.act_as(u_staff1);
  select count(*) into n from shifts where id = shift_ccm;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shifts', 'staff',
    'cannot see an unpublished draft shift', n = 0);
  update shifts set status = 'published' where id = shift_ccm;

  -- ==============================================================
  -- TIMESHEETS
  -- ==============================================================
  perform rls_harness.act_as(u_staff1);
  begin
    update timesheets set actual_start = now() - interval '12 hours'
      where id = ts_id;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;   -- blocked by policy or by the guard trigger
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'staff',
    'cannot alter an APPROVED timesheet', ok);

  -- Even on an open timesheet, hours are not theirs to rewrite.
  perform rls_harness.act_as_harness();
  update timesheets set status = 'submitted' where id = ts_id;
  perform rls_harness.act_as(u_staff1);
  begin
    update timesheets set paid_hours = 99 where id = ts_id;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'staff',
    'cannot rewrite hours on an open timesheet', ok);

  -- But they may acknowledge and add their own note.
  perform rls_harness.act_as(u_staff1);
  begin
    update timesheets set staff_note = 'Finished late, extra linen run.',
                          staff_acknowledged_at = now()
      where id = ts_id;
    get diagnostics n = row_count;
    ok := (n = 1);
  exception when others then
    ok := false;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'staff',
    'can acknowledge hours and add a note', ok);

  -- ==============================================================
  -- PRIVILEGE ESCALATION
  -- ==============================================================
  perform rls_harness.act_as(u_staff1);
  begin
    insert into user_roles (organisation_id, user_id, role)
    values (org_id, u_staff1, 'owner');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('user_roles', 'staff',
    'cannot grant themselves the owner role', ok);

  perform rls_harness.act_as(u_manager);
  begin
    insert into user_roles (organisation_id, user_id, role)
    values (org_id, u_manager, 'administrator');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('user_roles', 'manager',
    'cannot promote themselves to administrator', ok);

  perform rls_harness.act_as(u_staff1);
  begin
    update profiles set is_active = true, organisation_id = org_id
      where id = u_staff1;
    ok := true;   -- no-op update of unchanged values is fine
  exception when others then
    ok := true;
  end;
  -- The real test: flipping the flag on a *different* value.
  begin
    update profiles set is_active = false where id = u_staff1;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('profiles', 'staff',
    'cannot change their own active status', ok);

  -- ==============================================================
  -- APPEND-ONLY TABLES
  -- ==============================================================
  perform rls_harness.act_as_harness();
  insert into clock_events (organisation_id, property_id, user_id, event_type)
  values (org_id, coastal_id, u_staff1, 'clock_in');

  perform rls_harness.act_as(u_staff1);
  begin
    update clock_events set event_type = 'clock_out' where user_id = u_staff1;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('clock_events', 'staff',
    'cannot rewrite an attendance event', ok);

  perform rls_harness.act_as(u_owner);
  begin
    delete from clock_events;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('clock_events', 'owner',
    'cannot delete attendance events either', ok);

  perform rls_harness.act_as(u_owner);
  begin
    delete from audit_logs;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('audit_logs', 'owner',
    'cannot delete audit entries', ok);

  perform rls_harness.act_as(u_manager);
  select count(*) into n from audit_logs;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('audit_logs', 'manager',
    'cannot read audit logs (owner only)', n = 0);

  perform rls_harness.act_as(u_owner);
  select count(*) into n from audit_logs;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('audit_logs', 'owner',
    'can read audit logs', n > 0);

  -- ==============================================================
  -- KIOSK PINS — no client access at all
  -- ==============================================================
  perform rls_harness.act_as(u_owner);
  begin
    select count(*) into n from kiosk_credentials;
    ok := false;   -- reaching this line at all is a failure
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('kiosk_credentials', 'owner',
    'cannot read PIN hashes from the client', ok);

  -- ==============================================================
  -- PUSH SUBSCRIPTIONS — strictly per user
  -- ==============================================================
  perform rls_harness.act_as_harness();
  insert into push_subscriptions (organisation_id, user_id, endpoint, p256dh, auth_key)
  values (org_id, u_staff1, 'https://push.example/endpoint-1', 'key', 'auth');

  perform rls_harness.act_as(u_manager);
  select count(*) into n from push_subscriptions;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('push_subscriptions', 'manager',
    'cannot read another user''s push endpoints', n = 0);

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from push_subscriptions;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('push_subscriptions', 'staff',
    'can read their own push subscription', n = 1);

  -- ==============================================================
  -- DEACTIVATION REVOKES ACCESS IMMEDIATELY
  -- ==============================================================
  perform rls_harness.act_as_harness();
  update profiles set is_active = false where id = u_staff1;

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from shifts;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('deactivation', 'disabled staff',
    'loses access to shifts immediately', n = 0);

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from employment_details;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('deactivation', 'disabled staff',
    'loses access to their employment record', n = 0);

  update profiles set is_active = true where id = u_staff1;

  -- Archiving must behave the same way as deactivation.
  update profiles set archived_at = now() where id = u_staff1;
  perform rls_harness.act_as(u_staff1);
  select count(*) into n from shifts;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('archiving', 'archived staff',
    'loses access to shifts immediately', n = 0);
  update profiles set archived_at = null where id = u_staff1;


  -- ==============================================================
  -- HARDENING (migration 0005) — each of these was a CONFIRMED hole
  -- ==============================================================

  -- Forging audit entries via the SECURITY DEFINER RPC.
  perform rls_harness.act_as(u_staff1);
  begin
    perform write_audit_log(org_id, null, 'FORGED', 'forgery', null, null, null);
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('audit_logs', 'staff',
    'cannot forge entries via write_audit_log RPC', ok);

  -- Administrator demoting the owner by UPDATE (not just DELETE).
  perform rls_harness.act_as_harness();
  insert into user_roles (organisation_id, user_id, role)
  values (org_id, u_manager, 'administrator') on conflict do nothing;
  perform rls_harness.act_as(u_manager);
  begin
    update user_roles set role = 'staff'
      where user_id = u_owner and role = 'owner';
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  select count(*) into n from user_roles where user_id = u_owner and role = 'owner';
  perform rls_harness.record_check('user_roles', 'administrator',
    'cannot strip the owner role by UPDATE', ok and n = 1);
  delete from user_roles where user_id = u_manager and role = 'administrator';

  -- Manager reading pay rates outside their assigned properties.
  perform rls_harness.act_as_harness();
  delete from user_property_access
    where user_id = u_manager and property_id = lodge_id;
  perform rls_harness.act_as(u_manager);
  select count(*) into n from employment_details where user_id = u_staff3;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('employment_details', 'manager (Coastal only)',
    'cannot read pay rates for staff at another property', n = 0);

  perform rls_harness.act_as(u_manager);
  select count(*) into n from emergency_contacts where user_id = u_staff3;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('emergency_contacts', 'manager (Coastal only)',
    'cannot read emergency contacts for another property', n = 0);
  insert into user_property_access (organisation_id, user_id, property_id)
    values (org_id, u_manager, lodge_id) on conflict do nothing;

  -- Staff relocating their own timesheet to another organisation.
  perform rls_harness.act_as_harness();
  insert into organisations (id, name) values (rival_org, 'Rival Motels')
    on conflict (id) do nothing;
  insert into timesheets (id, organisation_id, property_id, user_id, work_date, status)
  values (rival_ts, org_id, coastal_id, u_staff1, current_date - 3, 'draft')
    on conflict (id) do nothing;
  perform rls_harness.act_as(u_staff1);
  begin
    update timesheets set organisation_id = rival_org where id = rival_ts;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  select count(*) into n from timesheets
    where id = rival_ts and organisation_id = org_id;
  perform rls_harness.record_check('timesheets', 'staff',
    'cannot move their timesheet to another organisation', ok and n = 1);

  -- Staff self-joining a team to inherit its access.
  perform rls_harness.act_as(u_staff1);
  begin
    update profiles set team_id = team_mgmt where id = u_staff1;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  select count(*) into n from profiles where id = u_staff1 and team_id = team_mgmt;
  perform rls_harness.record_check('profiles', 'staff',
    'cannot change their own team', ok and n = 0);

  -- Staff may still update the two fields that ARE theirs.
  perform rls_harness.act_as(u_staff1);
  begin
    update profiles set preferred_name = 'Ro', mobile_number = '0400 555 666'
      where id = u_staff1;
    get diagnostics n = row_count;
    ok := (n = 1);
  exception when others then
    ok := false;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('profiles', 'staff',
    'can still update preferred name and mobile', ok);

  -- Cross-tenant role injection.
  perform rls_harness.act_as_harness();
  insert into user_roles (organisation_id, user_id, role)
    values (org_id, u_manager, 'administrator') on conflict do nothing;
  perform rls_harness.act_as(u_manager);
  begin
    insert into user_roles (organisation_id, user_id, role)
    values (org_id, rival_user, 'administrator');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('user_roles', 'administrator',
    'cannot grant a role to a user in another organisation', ok);
  delete from user_roles where user_id = u_manager and role = 'administrator';

  -- Manager approving their own timesheet.
  perform rls_harness.act_as_harness();
  insert into timesheets (id, organisation_id, property_id, user_id, work_date, status)
  values (mgr_ts, org_id, coastal_id, u_manager, current_date - 1, 'submitted')
    on conflict (id) do nothing;
  perform rls_harness.act_as(u_manager);
  begin
    update timesheets set status = 'approved', approved_by = u_manager,
                          approved_at = now()
      where id = mgr_ts;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'manager',
    'cannot approve their own timesheet', ok);

  -- Editing a locked timesheet.
  perform rls_harness.act_as_harness();
  update timesheets set status = 'exported', locked_at = now() where id = mgr_ts;
  perform rls_harness.act_as(u_manager);
  begin
    update timesheets set paid_hours = 99 where id = mgr_ts;
    get diagnostics n = row_count;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'manager',
    'cannot edit a LOCKED timesheet', ok);

  -- ==============================================================
  -- ANONYMOUS ACCESS
  -- ==============================================================
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from profiles;
    ok := (n = 0);
  exception when others then
    ok := true;   -- permission denied is the ideal outcome
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('anon', 'unauthenticated',
    'cannot read staff profiles', ok);

  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from shifts;
    ok := (n = 0);
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('anon', 'unauthenticated',
    'cannot read shifts', ok);

  perform rls_harness.act_as_harness();
end $$;

-- Remove the harness before reporting, so nothing is left behind even if
-- the run ends here.
drop schema rls_harness cascade;
reset search_path;

-- ---------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------
\echo ''
\echo '================ StayFlow Staff — RLS test results ================'
select seq, area, actor, expectation, outcome
from rls_results order by seq;

select
  count(*) filter (where outcome = 'PASS') as passed,
  count(*) filter (where outcome = 'FAIL') as failed,
  count(*)                                  as total
from rls_results;

-- Fail the whole run if anything did not pass.
do $$
declare failures integer;
begin
  select count(*) into failures from rls_results where outcome = 'FAIL';
  if failures > 0 then
    raise exception '% RLS check(s) FAILED', failures;
  end if;
  raise notice 'All RLS checks passed.';
end $$;
