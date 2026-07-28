-- =====================================================================
-- StayFlow Staff — 0006 close remaining audit findings
--
-- Completes the triage of the adversarial audit. 0005 fixed the nine
-- confirmed criticals/highs; this migration closes the rest, including
-- one that turned out to be more severe than its original rating.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TRUNCATE — the append-only guarantee was never real
--
-- CONFIRMED: a plain staff member could run `truncate audit_logs` and
-- destroy the entire tamper-evidence trail. TRUNCATE is NOT subject to
-- Row Level Security, so FORCE RLS and the deliberate absence of a
-- DELETE policy did nothing. The same applied to clock_events, negating
-- its append-only property, and to every confidential table as a
-- destruction vector.
--
-- Root cause: the migrations granted the four intended privileges but
-- never revoked Supabase's stock default ACL from `authenticated`.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, trigger, references on %I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- Future tables inherit the same restriction rather than relying on
-- someone remembering to revoke.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. clock_events — the server must own the server clock
--
-- CONFIRMED: server_time, received_at, was_offline and is_flagged were
-- all client-supplied, so a staff member could insert a clock_in dated
-- 30 days ago with is_flagged=false and it would look authentic in an
-- append-only table nobody can correct.
--
-- client_time is retained exactly as sent — that is the point of an
-- offline queue — but it can no longer masquerade as the server clock.
-- ---------------------------------------------------------------------
create or replace function guard_clock_event_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  skew interval := interval '15 minutes';
begin
  if is_service_context() then
    return new;
  end if;

  -- The server clock is not negotiable.
  new.server_time := now();
  new.received_at := now();

  -- A client may not mark its own event clean; the reconciliation flag
  -- is derived, not asserted.
  if new.client_time is not null
     and (new.client_time > now() + skew or new.client_time < now() - skew)
  then
    new.was_offline := true;
    new.is_flagged  := true;
    new.flag_reason := coalesce(
      new.flag_reason,
      'Device clock differs from server time by more than 15 minutes.');
  end if;

  -- An event queued offline is always worth a manager's eye.
  if new.was_offline then
    new.is_flagged := true;
    new.flag_reason := coalesce(new.flag_reason, 'Recorded while offline.');
  end if;

  return new;
end;
$$;

create trigger clock_events_guard_times
  before insert on clock_events
  for each row execute function guard_clock_event_times();

-- Duplicate suppression was voluntary because idempotency_key was
-- optional. Clients must now supply one; server-side inserts need not.
drop policy if exists clock_events_insert_self on clock_events;
create policy clock_events_insert_self on clock_events
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and can_access_property(property_id)
    and source <> 'manager_entry'
    and entered_by is null
    and idempotency_key is not null
  );

-- ---------------------------------------------------------------------
-- 3. The organisation owner must not be disabled by an administrator
--
-- CONFIRMED: guard_role_change() protects the owner's ROLE, but nothing
-- protected their PROFILE. Setting is_active = false on the owner makes
-- active_uid(), current_organisation_id() and has_role_at_least() all
-- return nothing for them — revoking every ounce of access instantly,
-- which is precisely the mechanism the schema advertises as a feature.
-- ---------------------------------------------------------------------
create or replace function guard_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if exists (
       select 1 from user_roles ur
       where ur.user_id = new.id and ur.role = 'owner'
     )
     and (new.is_active = false or new.archived_at is not null)
     and (old.is_active = true and old.archived_at is null)
     and not has_role_at_least('owner')
  then
    raise exception
      'Only an owner may deactivate or archive the organisation owner.';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_owner
  before update on profiles
  for each row execute function guard_owner_profile();

-- ---------------------------------------------------------------------
-- 4. `FOR ALL` management policies were looser than the scoped SELECT
--
-- A permissive FOR ALL policy's USING clause also covers SELECT, and
-- permissive policies are OR-ed together. Every one of these silently
-- re-opened organisation-wide reads that the dedicated SELECT policy
-- had carefully scoped to the manager's properties.
--
-- CONFIRMED for staff_availability: a Coastal-only manager could read
-- and approve a Holiday Lodge availability submission.
-- ---------------------------------------------------------------------
drop policy if exists availability_manage on staff_availability;
create policy availability_manage on staff_availability
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and (has_role_at_least('administrator')
         or (has_role_at_least('manager') and manages_user(user_id)))
  )
  with check (
    organisation_id = current_organisation_id()
    and (has_role_at_least('administrator')
         or (has_role_at_least('manager') and manages_user(user_id)))
  );

drop policy if exists adjustment_write_manager on timesheet_adjustment_requests;
create policy adjustment_write_manager on timesheet_adjustment_requests
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and (has_role_at_least('administrator')
         or (has_role_at_least('manager') and manages_user(user_id)))
  )
  with check (
    organisation_id = current_organisation_id()
    and (has_role_at_least('administrator')
         or (has_role_at_least('manager') and manages_user(user_id)))
  );

drop policy if exists shift_ack_write_manager on shift_acknowledgements;
create policy shift_ack_write_manager on shift_acknowledgements
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and exists (
      select 1 from shifts s
      where s.id = shift_acknowledgements.shift_id
        and can_access_property(s.property_id)
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and exists (
      select 1 from shifts s
      where s.id = shift_acknowledgements.shift_id
        and can_access_property(s.property_id)
    )
  );

drop policy if exists task_assignments_select on task_assignments;
create policy task_assignments_select on task_assignments
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      user_id = active_uid()
      or team_id in (
        select team_id from profiles
        where id = active_uid() and team_id is not null
      )
      or exists (
        select 1 from tasks t
        where t.id = task_assignments.task_id
          and has_role_at_least('supervisor')
          and can_access_property(t.property_id)
      )
    )
  );

drop policy if exists task_assignments_write on task_assignments;
create policy task_assignments_write on task_assignments
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and exists (
      select 1 from tasks t
      where t.id = task_assignments.task_id
        and has_role_at_least('supervisor')
        and can_access_property(t.property_id)
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and exists (
      select 1 from tasks t
      where t.id = task_assignments.task_id
        and has_role_at_least('supervisor')
        and can_access_property(t.property_id)
    )
  );

-- roster_select's `or has_role_at_least('manager')` discarded the
-- property check entirely for the manager tier.
drop policy if exists roster_select on roster_periods;
create policy roster_select on roster_periods
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (can_access_property(property_id) or has_role_at_least('administrator'))
  );

-- Announcements and documents: organisation-wide items stay editable by
-- any manager; property-scoped items require the grant.
drop policy if exists announcements_write_manager on announcements;
create policy announcements_write_manager on announcements
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and (property_id is null or can_access_property(property_id))
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and (property_id is null or can_access_property(property_id))
  );

drop policy if exists documents_write_manager on documents;
create policy documents_write_manager on documents
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and (property_id is null or can_access_property(property_id))
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and (property_id is null or can_access_property(property_id))
  );

-- A supervisor read every replacement request in the organisation,
-- including the free-text reason, for properties they cannot see.
drop policy if exists replacement_select on shift_replacement_requests;
create policy replacement_select on shift_replacement_requests
  for select to authenticated
  using (
    requested_by = active_uid()
    or replacement_user_id = active_uid()
    or (
      organisation_id = current_organisation_id()
      and has_role_at_least('supervisor')
      and manages_user(requested_by)
    )
  );

-- Teams scoped to one property were enumerable organisation-wide.
drop policy if exists teams_select on teams;
create policy teams_select on teams
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      property_id is null
      or can_access_property(property_id)
      or has_role_at_least('administrator')
    )
  );

-- ---------------------------------------------------------------------
-- 5. Self-approval of leave
--
-- 0005 barred a manager from approving their own timesheet, but leave
-- had the same gap. manages_user(self) returns true for a manager
-- (they share a property with themselves), so leave_manage let them
-- approve their own request.
-- ---------------------------------------------------------------------
create or replace function guard_leave_self_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if new.user_id = auth.uid()
     and new.status in ('approved', 'declined')
     and old.status is distinct from new.status
     and not has_role_at_least('administrator')
  then
    raise exception 'You may not decide your own leave request.';
  end if;

  return new;
end;
$$;

create trigger leave_requests_guard_self_approval
  before update on leave_requests
  for each row execute function guard_leave_self_approval();

-- ---------------------------------------------------------------------
-- 6. Timesheet integrity: INSERT path and status regression
--
-- 0005's management guard was BEFORE UPDATE only, so a manager could
-- INSERT a row already marked approved, naming somebody else as the
-- approver. It also only blocked regression once exported_at was set,
-- leaving approved -> draft open.
-- ---------------------------------------------------------------------
create or replace function guard_timesheet_management()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  -- Applies to INSERT and UPDATE alike.
  if new.status in ('approved', 'exported', 'locked')
     and new.user_id = auth.uid()
     and not has_role_at_least('administrator')
  then
    raise exception 'You may not approve your own timesheet.';
  end if;

  if new.approved_by is not null and new.approved_by <> auth.uid()
     and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by)
  then
    raise exception 'approved_by must be the approving user.';
  end if;

  if tg_op = 'UPDATE' then
    -- A locked timesheet has gone to payroll.
    if old.locked_at is not null and not has_role_at_least('administrator') then
      raise exception
        'This timesheet is locked. Ask an administrator to reopen it.';
    end if;

    -- Do not let an approved or exported timesheet quietly regress, or
    -- have its approval and export stamps erased.
    if (old.status in ('approved','exported') or old.exported_at is not null)
       and not has_role_at_least('administrator')
    then
      if new.status in ('draft','staff_review_requested','submitted')
         or new.approved_at is distinct from old.approved_at
         or new.exported_at is distinct from old.exported_at
      then
        raise exception
          'Only an administrator may reopen an approved or exported timesheet.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists timesheets_guard_management on timesheets;
create trigger timesheets_guard_management
  before insert or update on timesheets
  for each row execute function guard_timesheet_management();

-- ---------------------------------------------------------------------
-- 7. Open shift claims could be re-pointed at an invisible shift
--
-- The WITH CHECK pinned only claimed_by and organisation, so a staff
-- member holding one offer could rewrite its shift_id to a draft shift
-- at a property they hold no grant for.
-- ---------------------------------------------------------------------
drop policy if exists open_offers_update_claim on open_shift_offers;
create policy open_offers_update_claim on open_shift_offers
  for update to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      offered_to_user_id = active_uid()
      or (
        offered_to_user_id is null
        and exists (
          select 1 from shifts s
          where s.id = open_shift_offers.shift_id
            and s.organisation_id = current_organisation_id()
            and can_access_property(s.property_id)
        )
      )
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and claimed_by = active_uid()
    and exists (
      select 1 from shifts s
      where s.id = open_shift_offers.shift_id
        and s.organisation_id = current_organisation_id()
        and s.status = 'published'
        and s.is_open_shift
        and can_access_property(s.property_id)
    )
  );

/** A claimant may not re-point an offer at a different shift. */
create or replace function guard_offer_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() or has_role_at_least('manager') then
    return new;
  end if;

  if new.shift_id is distinct from old.shift_id
     or new.offered_to_user_id is distinct from old.offered_to_user_id
     or new.organisation_id is distinct from old.organisation_id
  then
    raise exception 'You may only claim an offer, not change what it is for.';
  end if;

  return new;
end;
$$;

create trigger open_shift_offers_guard_immutability
  before update on open_shift_offers
  for each row execute function guard_offer_immutability();

-- ---------------------------------------------------------------------
-- 8. Comments on tasks the author cannot see
-- ---------------------------------------------------------------------
drop policy if exists task_comments_insert_self on task_comments;
create policy task_comments_insert_self on task_comments
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and t.organisation_id = current_organisation_id()
        and (
          can_access_property(t.property_id)
          or exists (
            select 1 from task_assignments ta
            where ta.task_id = t.id
              and (
                ta.user_id = active_uid()
                or ta.team_id in (
                  select team_id from profiles
                  where id = active_uid() and team_id is not null
                )
              )
          )
        )
    )
  );

-- ---------------------------------------------------------------------
-- Revoke EXECUTE on the new trigger functions, per the 0005 rule.
-- ---------------------------------------------------------------------
revoke execute on function guard_clock_event_times()    from public, anon, authenticated;
revoke execute on function guard_owner_profile()        from public, anon, authenticated;
revoke execute on function guard_leave_self_approval()  from public, anon, authenticated;
revoke execute on function guard_timesheet_management() from public, anon, authenticated;
revoke execute on function guard_offer_immutability()   from public, anon, authenticated;
