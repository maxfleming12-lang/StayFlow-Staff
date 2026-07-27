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
  mgr_leave    uuid := '11111111-0000-4000-8000-000000000003';
  lodge_team   uuid := '11111111-0000-4000-8000-000000000004';
  lodge_task   uuid := '11111111-0000-4000-8000-000000000005';
  repl_shift   uuid := '11111111-0000-4000-8000-000000000006';
  repl_req     uuid := '11111111-0000-4000-8000-000000000007';
  repl_offer   uuid := '11111111-0000-4000-8000-000000000008';
  kiosk_sess   uuid := '11111111-0000-4000-8000-000000000009';
  u_staff2     uuid := '00000000-0000-4000-8000-000000000104';
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
  -- Restore the seeded value: a test that mutates shared fixtures and does
  -- not put them back makes later output confusing to read.
  update profiles set preferred_name = 'Aroha', mobile_number = '0400 000 000'
    where id = u_staff1;

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
  -- REMAINING AUDIT FINDINGS (migration 0006)
  -- ==============================================================

  -- TRUNCATE bypasses RLS entirely; it was the real hole in
  -- "audit_logs is append-only".
  perform rls_harness.act_as(u_staff1);
  begin
    truncate audit_logs;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('audit_logs', 'staff',
    'cannot TRUNCATE the audit log', ok);

  perform rls_harness.act_as(u_staff1);
  begin
    truncate clock_events;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('clock_events', 'staff',
    'cannot TRUNCATE attendance history', ok);

  -- The server owns the server clock.
  perform rls_harness.act_as(u_staff1);
  begin
    insert into clock_events (organisation_id, property_id, user_id, event_type,
                              server_time, was_offline, is_flagged, idempotency_key)
    values (org_id, coastal_id, u_staff1, 'clock_in',
            now() - interval '30 days', false, false, 'test-backdate-1');
    ok := true;
  exception when others then
    ok := false;
  end;
  perform rls_harness.act_as_harness();
  select count(*) into n from clock_events
    where idempotency_key = 'test-backdate-1'
      and server_time < now() - interval '1 day';
  perform rls_harness.record_check('clock_events', 'staff',
    'cannot backdate an attendance event', n = 0);

  -- A client must supply an idempotency key, so replayed offline events
  -- cannot silently duplicate.
  perform rls_harness.act_as(u_staff1);
  begin
    insert into clock_events (organisation_id, property_id, user_id, event_type)
    values (org_id, coastal_id, u_staff1, 'clock_in');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('clock_events', 'staff',
    'must supply an idempotency key', ok);

  -- The organisation owner cannot be locked out by an administrator.
  perform rls_harness.act_as_harness();
  insert into user_roles (organisation_id, user_id, role)
  values (org_id, u_manager, 'administrator') on conflict do nothing;
  perform rls_harness.act_as(u_manager);
  begin
    update profiles set is_active = false where id = u_owner;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  select count(*) into n from profiles where id = u_owner and is_active;
  perform rls_harness.record_check('profiles', 'administrator',
    'cannot deactivate the organisation owner', ok and n = 1);
  delete from user_roles where user_id = u_manager and role = 'administrator';

  -- FOR ALL management policies no longer re-open organisation-wide reads.
  perform rls_harness.act_as_harness();
  delete from user_property_access
    where user_id = u_manager and property_id = lodge_id;
  insert into staff_availability (organisation_id, user_id, day_of_week,
                                  is_available, status)
  values (org_id, u_staff3, 1, false, 'pending');
  perform rls_harness.act_as(u_manager);
  select count(*) into n from staff_availability where user_id = u_staff3;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('staff_availability', 'manager (Coastal only)',
    'cannot see availability for another property', n = 0);

  perform rls_harness.act_as_harness();
  insert into roster_periods (organisation_id, property_id, week_start_date)
  values (org_id, lodge_id, current_date) on conflict do nothing;
  perform rls_harness.act_as(u_manager);
  select count(*) into n from roster_periods where property_id = lodge_id;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('roster_periods', 'manager (Coastal only)',
    'cannot see rosters for another property', n = 0);
  insert into user_property_access (organisation_id, user_id, property_id)
    values (org_id, u_manager, lodge_id) on conflict do nothing;

  -- Teams scoped to one property are not enumerable organisation-wide.
  perform rls_harness.act_as_harness();
  insert into teams (id, organisation_id, property_id, name)
  values (lodge_team, org_id, lodge_id, 'Lodge Night Crew')
  on conflict (id) do nothing;
  perform rls_harness.act_as(u_staff1);   -- Coastal only
  select count(*) into n from teams where id = lodge_team;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('teams', 'staff (Coastal)',
    'cannot enumerate another property''s teams', n = 0);

  -- Self-approval of leave.
  perform rls_harness.act_as_harness();
  insert into leave_requests (id, organisation_id, user_id, category,
                              first_date, last_date, status)
  values (mgr_leave, org_id, u_manager, 'annual',
          current_date + 10, current_date + 12, 'pending')
  on conflict (id) do nothing;
  perform rls_harness.act_as(u_manager);
  begin
    update leave_requests set status = 'approved' where id = mgr_leave;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('leave_requests', 'manager',
    'cannot approve their own leave', ok);

  -- A manager cannot INSERT a timesheet that is already approved.
  perform rls_harness.act_as(u_manager);
  begin
    insert into timesheets (organisation_id, property_id, user_id, work_date,
                            status, approved_by, approved_at)
    values (org_id, coastal_id, u_manager, current_date - 20,
            'approved', u_manager, now());
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('timesheets', 'manager',
    'cannot insert a pre-approved timesheet for themselves', ok);

  -- Comments on tasks the author cannot see.
  perform rls_harness.act_as_harness();
  insert into tasks (id, organisation_id, property_id, title)
  values (lodge_task, org_id, lodge_id, 'Lodge boiler check')
  on conflict (id) do nothing;
  perform rls_harness.act_as(u_staff1);   -- Coastal only, unassigned
  begin
    insert into task_comments (organisation_id, task_id, user_id, body)
    values (org_id, lodge_task, u_staff1, 'injected');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('task_comments', 'staff',
    'cannot comment on a task at an inaccessible property', ok);

  -- Remove fixtures this suite created, so a developer inspecting the
  -- database afterwards is not misled by leftover test rows.
  perform rls_harness.act_as_harness();
  delete from leave_requests where id = mgr_leave;
  delete from timesheets where id in (rival_ts, mgr_ts, ts_id);
  delete from clock_events where user_id = u_staff1;
  delete from push_subscriptions where user_id = u_staff1;
  delete from shift_acknowledgements where shift_id = shift_ccm;
  delete from shifts where id = shift_ccm;
  delete from open_shift_offers where id = repl_offer;
  delete from shift_replacement_requests where id = repl_req;
  delete from shifts where id = repl_shift;
  delete from kiosk_sessions where id = kiosk_sess;
  delete from kiosk_credentials where user_id = u_staff1;
  delete from tasks where id = lodge_task;
  delete from teams where id = lodge_team;
  delete from organisations where id = rival_org;


  -- ==============================================================
  -- SHIFT REPLACEMENTS (migrations 0011, 0012)
  -- ==============================================================

  perform rls_harness.act_as_harness();
  insert into shifts (id, organisation_id, property_id, user_id,
                      starts_at, ends_at, status, published_at)
  values (repl_shift, org_id, coastal_id, u_staff1,
          now() + interval '6 days', now() + interval '6 days 8 hours',
          'published', now())
  on conflict (id) do nothing;

  insert into shift_replacement_requests (id, organisation_id, shift_id,
                                          requested_by, reason, status)
  values (repl_req, org_id, repl_shift, u_staff1, 'Family commitment', 'requested')
  on conflict (id) do nothing;

  -- Staff may not decide their own replacement request.
  perform rls_harness.act_as(u_staff1);
  begin
    update shift_replacement_requests set status = 'approved' where id = repl_req;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shift_replacement_requests', 'staff',
    'cannot approve their own replacement request', ok);

  -- Nor nominate a replacement while withdrawing.
  perform rls_harness.act_as(u_staff1);
  begin
    update shift_replacement_requests
      set status = 'withdrawn', replacement_user_id = u_staff2
      where id = repl_req;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shift_replacement_requests', 'staff',
    'cannot nominate a replacement while withdrawing', ok);

  -- The state machine refuses to skip straight to approved.
  perform rls_harness.act_as(u_manager);
  begin
    update shift_replacement_requests set status = 'approved' where id = repl_req;
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shift_replacement_requests', 'manager',
    'cannot skip requested straight to approved', ok);

  -- An offer to everyone must be VISIBLE to eligible staff. This failed
  -- before 0012: the policy read the shifts table through the caller's own
  -- RLS, and a colleague cannot see a shift that still belongs to someone
  -- else, so every offer silently vanished.
  perform rls_harness.act_as_harness();
  update shift_replacement_requests set status = 'offered' where id = repl_req;
  insert into open_shift_offers (id, organisation_id, shift_id,
                                 offered_to_user_id, status)
  values (repl_offer, org_id, repl_shift, null, 'offered')
  on conflict (id) do nothing;

  perform rls_harness.act_as(u_staff2);   -- Coastal, eligible
  select count(*) into n from open_shift_offers where id = repl_offer;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('open_shift_offers', 'staff (eligible)',
    'can see a shift offered to all eligible staff', n = 1);

  perform rls_harness.act_as(u_staff2);
  select count(*) into n from shifts where id = repl_shift;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shifts', 'staff (eligible)',
    'can read the shift behind an offer they may claim', n = 1);

  -- ...but not staff at another property.
  perform rls_harness.act_as(u_staff3);   -- Holiday Lodge only
  select count(*) into n from open_shift_offers where id = repl_offer;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('open_shift_offers', 'staff (other property)',
    'cannot see an offer for a property they cannot work at', n = 0);

  perform rls_harness.act_as(u_staff3);
  select count(*) into n from shifts where id = repl_shift;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('shifts', 'staff (other property)',
    'cannot read a shift behind an offer they cannot claim', n = 0);


  -- ==============================================================
  -- KIOSK (migration 0013)
  -- ==============================================================

  -- PIN hashes must be unreachable from every client role.
  perform rls_harness.act_as_harness();
  perform set_kiosk_pin(u_staff1, '4821');

  -- Not merely "returns no rows": the client roles hold no grant at all, so
  -- the table cannot even be queried.
  perform rls_harness.act_as(u_owner);
  begin
    select count(*) into n from kiosk_credentials;
    ok := false;
  exception when insufficient_privilege then
    ok := true;
  when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('kiosk_credentials', 'owner',
    'cannot even query the PIN table', ok);

  -- The PIN functions must be callable only by trusted server code.
  perform rls_harness.act_as(u_staff1);
  begin
    perform verify_kiosk_pin(u_staff1, '4821');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('verify_kiosk_pin', 'staff',
    'cannot call the PIN verifier directly', ok);

  perform rls_harness.act_as(u_manager);
  begin
    perform set_kiosk_pin(u_staff2, '1111');
    ok := false;
  exception when others then
    ok := true;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('set_kiosk_pin', 'manager',
    'cannot set a PIN without going through the server', ok);

  -- Lockout is enforced inside the database, so a client cannot reset it.
  perform rls_harness.act_as_harness();
  perform verify_kiosk_pin(u_staff1, '0000');
  perform verify_kiosk_pin(u_staff1, '0000');
  perform verify_kiosk_pin(u_staff1, '0000');
  perform verify_kiosk_pin(u_staff1, '0000');
  perform verify_kiosk_pin(u_staff1, '0000');
  perform rls_harness.record_check('verify_kiosk_pin', 'anyone',
    'locks out after the configured attempts',
    verify_kiosk_pin(u_staff1, '4821') = 'locked');

  -- A kiosk device token must not be readable by staff.
  perform rls_harness.act_as_harness();
  insert into kiosk_sessions (id, organisation_id, property_id, token,
                              created_by, expires_at)
  values (kiosk_sess, org_id, coastal_id, 'harness_token_0123456789abcdefghij',
          u_manager, now() + interval '30 days')
  on conflict (id) do nothing;

  perform rls_harness.act_as(u_staff1);
  select count(*) into n from kiosk_sessions;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('kiosk_sessions', 'staff',
    'cannot see authorised kiosk devices', n = 0);

  -- A manager CAN revoke a device. This failed before the updated_at column
  -- was added: the trigger raised and every revoke silently did nothing.
  perform rls_harness.act_as(u_manager);
  begin
    update kiosk_sessions set revoked_at = now() where id = kiosk_sess;
    get diagnostics n = row_count;
    ok := (n = 1);
  exception when others then
    ok := false;
  end;
  perform rls_harness.act_as_harness();
  perform rls_harness.record_check('kiosk_sessions', 'manager',
    'can revoke a device (updated_at trigger works)', ok);

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
