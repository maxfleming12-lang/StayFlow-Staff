-- =====================================================================
-- StayFlow Staff — 0005 security hardening
--
-- Fixes issues found by an adversarial audit of 0001–0004 and confirmed
-- by executing the attacks against a live database. Each section names
-- the hole it closes; supabase/tests/rls_test.sql now asserts every one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SECURITY DEFINER functions were left with default PUBLIC EXECUTE
--
-- CONFIRMED: a staff member could call write_audit_log() and forge an
-- audit entry. The function bypasses RLS by design, and PostgREST
-- exposes public functions as callable RPC, so audit_logs having no
-- INSERT policy achieved nothing.
--
-- The read-only predicate helpers MUST keep EXECUTE: policy expressions
-- are evaluated with the invoking user's privileges, so revoking them
-- makes every policy raise "permission denied" instead of filtering.
-- They are safe to expose — each only reveals facts about the caller.
-- ---------------------------------------------------------------------
revoke execute on function write_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- Trigger functions cannot be usefully invoked directly, but there is no
-- reason for a client to hold EXECUTE on them.
revoke execute on function audit_row()                     from public, anon, authenticated;
revoke execute on function audit_pay_rate_change()         from public, anon, authenticated;
revoke execute on function guard_profile_self_update()     from public, anon, authenticated;
revoke execute on function guard_role_change()             from public, anon, authenticated;
revoke execute on function guard_timesheet_staff_update()  from public, anon, authenticated;
revoke execute on function guard_task_verification()       from public, anon, authenticated;
revoke execute on function guard_open_shift_approval()     from public, anon, authenticated;
revoke execute on function set_updated_at()                from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. An administrator could strip the owner by UPDATE
--
-- CONFIRMED: the old guard only tested `tg_op = 'DELETE'`, so
-- `update user_roles set role='staff' where role='owner'` sailed past.
-- The owner-role test also used coalesce(new.role, old.role), which on
-- an UPDATE returns the NEW role — so demoting an owner never even
-- looked at the fact that the OLD role was owner.
-- ---------------------------------------------------------------------
create or replace function guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
begin
  -- Trusted server-side provisioning is not a privilege-escalation risk.
  if is_service_context() then
    return coalesce(new, old);
  end if;

  if target_user = auth.uid() then
    raise exception 'You may not change your own roles.';
  end if;

  -- Any statement that touches an owner row, in either direction, needs
  -- owner privilege. Checking BOTH old and new closes the demote path.
  if (tg_op in ('UPDATE','DELETE') and old.role = 'owner')
     or (tg_op in ('INSERT','UPDATE') and new.role = 'owner')
  then
    if not has_role_at_least('owner') then
      raise exception
        'Only an owner may grant, remove or alter the owner role.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Cross-tenant injection via user_roles and user_property_access
--
-- CONFIRMED-BY-INSPECTION: the write policies checked only that the ROW's
-- organisation_id equalled the caller's. Nothing tied the target user or
-- the target property to that organisation, so an administrator could
-- insert a row naming a user (or property) belonging to another tenant.
-- ---------------------------------------------------------------------
create or replace function guard_role_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles p
    where p.id = new.user_id
      and p.organisation_id = new.organisation_id
  ) then
    raise exception
      'The target user does not belong to that organisation.';
  end if;
  return new;
end;
$$;

create trigger user_roles_guard_tenancy
  before insert or update on user_roles
  for each row execute function guard_role_tenancy();

create or replace function guard_property_access_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles p
    where p.id = new.user_id
      and p.organisation_id = new.organisation_id
  ) then
    raise exception 'The target user does not belong to that organisation.';
  end if;

  if not exists (
    select 1 from properties pr
    where pr.id = new.property_id
      and pr.organisation_id = new.organisation_id
  ) then
    raise exception 'That property does not belong to that organisation.';
  end if;

  return new;
end;
$$;

create trigger upa_guard_tenancy
  before insert or update on user_property_access
  for each row execute function guard_property_access_tenancy();

revoke execute on function guard_role_tenancy()            from public, anon, authenticated;
revoke execute on function guard_property_access_tenancy() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Confidential employment data was organisation-wide for any manager
--
-- CONFIRMED: a manager assigned only to Coastal Comfort could read pay
-- rates and payroll references for Holiday Lodge staff. "Managers can
-- access records only for properties assigned to them" was not met.
--
-- Administrators and owners keep organisation-wide access, which is the
-- documented intent; managers are now scoped by shared property.
-- ---------------------------------------------------------------------
drop policy if exists employment_select_management on employment_details;
create policy employment_select_management on employment_details
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      has_role_at_least('administrator')
      or (has_role_at_least('manager') and manages_user(user_id))
    )
  );

drop policy if exists emergency_select_management on emergency_contacts;
create policy emergency_select_management on emergency_contacts
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      has_role_at_least('administrator')
      or (has_role_at_least('manager') and manages_user(user_id))
    )
  );

-- Leave approval had the same shape: a FOR ALL organisation-wide policy
-- that overrode the property-scoped SELECT.
drop policy if exists leave_manage on leave_requests;
create policy leave_manage on leave_requests
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      has_role_at_least('administrator')
      or (has_role_at_least('manager') and manages_user(user_id))
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and (
      has_role_at_least('administrator')
      or (has_role_at_least('manager') and manages_user(user_id))
    )
  );

-- ---------------------------------------------------------------------
-- 5. Staff could relocate their own rows to another organisation
--
-- CONFIRMED: a staff member updated their own timesheet's
-- organisation_id to a rival organisation, removing it from their
-- management chain's view entirely. The guard enumerated only a subset
-- of columns, so anything unlisted was writable.
--
-- Inverted: staff may now change ONLY the two columns that are theirs.
-- A new column added later is protected by default rather than exposed.
-- ---------------------------------------------------------------------
create or replace function guard_timesheet_staff_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if auth.uid() = new.user_id and not has_role_at_least('manager') then
    -- Allow-list rather than deny-list: rebuild the OLD row with only the
    -- staff-writable fields replaced, and require it to equal the NEW row.
    if to_jsonb(new) is distinct from (
         to_jsonb(old)
         || jsonb_build_object(
              'staff_note', to_jsonb(new) -> 'staff_note',
              'staff_acknowledged_at', to_jsonb(new) -> 'staff_acknowledged_at',
              'updated_at', to_jsonb(new) -> 'updated_at')
       )
    then
      raise exception
        'Staff may change only their own note and acknowledgement. Raise a timesheet correction request instead.';
    end if;
  end if;

  return new;
end;
$$;

-- Same inversion for the profile guard, which also missed team_id:
-- CONFIRMED a staff member could self-join the Management team and
-- inherit that team's task visibility.
create or replace function guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if auth.uid() = new.id and not has_role_at_least('administrator') then
    if to_jsonb(new) is distinct from (
         to_jsonb(old)
         || jsonb_build_object(
              'preferred_name', to_jsonb(new) -> 'preferred_name',
              'mobile_number',  to_jsonb(new) -> 'mobile_number',
              'updated_at',     to_jsonb(new) -> 'updated_at')
       )
    then
      raise exception
        'You may update only your preferred name and mobile number. Ask your manager to change anything else.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function guard_timesheet_staff_update() from public, anon, authenticated;
revoke execute on function guard_profile_self_update()    from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Open shifts and offers leaked across organisations
--
-- can_access_property() alone was the only predicate, and it does not
-- pin the organisation. Adding the organisation check costs nothing and
-- removes a whole class of multi-tenant mistake.
-- ---------------------------------------------------------------------
drop policy if exists shifts_select_open on shifts;
create policy shifts_select_open on shifts
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and is_open_shift
    and status = 'published'
    and user_id is null
    and can_access_property(property_id)
  );

drop policy if exists open_offers_select on open_shift_offers;
create policy open_offers_select on open_shift_offers
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      offered_to_user_id = active_uid()
      or claimed_by = active_uid()
      or (
        offered_to_user_id is null
        and exists (
          select 1 from shifts s
          where s.id = open_shift_offers.shift_id
            and can_access_property(s.property_id)
        )
      )
      or has_role_at_least('manager')
    )
  );

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
            and can_access_property(s.property_id)
        )
      )
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and claimed_by = active_uid()
  );

-- ---------------------------------------------------------------------
-- 7. tasks_update_assigned had a WITH CHECK far weaker than its USING
--
-- Assigned staff could re-point a task at a property they cannot access,
-- or move it to another organisation, because the check only tested
-- organisation_id.
-- ---------------------------------------------------------------------
drop policy if exists tasks_update_assigned on tasks;
create policy tasks_update_assigned on tasks
  for update to authenticated
  using (
    organisation_id = current_organisation_id()
    and exists (
      select 1 from task_assignments ta
      where ta.task_id = tasks.id
        and (
          ta.user_id = active_uid()
          or ta.team_id in (
            select team_id from profiles
            where id = active_uid() and team_id is not null
          )
        )
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and can_access_property(property_id)
  );

/**
 * Staff may progress a task but not relocate it. Pairs with the policy
 * above, since WITH CHECK cannot compare against the previous row.
 */
create or replace function guard_task_relocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() or has_role_at_least('supervisor') then
    return new;
  end if;

  if new.organisation_id is distinct from old.organisation_id
     or new.property_id  is distinct from old.property_id
  then
    raise exception 'You may not move a task to another property or organisation.';
  end if;

  return new;
end;
$$;

create trigger tasks_guard_relocation
  before update on tasks
  for each row execute function guard_task_relocation();

revoke execute on function guard_task_relocation() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Timesheet integrity: self-approval, status regression, locked rows
--
-- A manager could approve their OWN timesheet, stamp approved_by with
-- somebody else's id, walk an exported timesheet back to draft, and edit
-- break rows on a locked timesheet.
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

  -- Approving your own hours is not a management action.
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.user_id = auth.uid()
     and not has_role_at_least('administrator')
  then
    raise exception 'You may not approve your own timesheet.';
  end if;

  -- approved_by must be the person actually doing it.
  if new.approved_by is distinct from old.approved_by
     and new.approved_by is not null
     and new.approved_by <> auth.uid()
  then
    raise exception 'approved_by must be the approving user.';
  end if;

  -- A locked timesheet has gone to payroll. Only an administrator may
  -- reopen it, and only by clearing locked_at deliberately.
  if old.locked_at is not null and not has_role_at_least('administrator') then
    raise exception 'This timesheet is locked. Ask an administrator to reopen it.';
  end if;

  -- Do not let an exported timesheet silently regress to an earlier state.
  if old.exported_at is not null
     and new.status in ('draft','staff_review_requested','submitted')
     and not has_role_at_least('administrator')
  then
    raise exception 'An exported timesheet cannot be returned to an earlier status.';
  end if;

  return new;
end;
$$;

create trigger timesheets_guard_management
  before update on timesheets
  for each row execute function guard_timesheet_management();

revoke execute on function guard_timesheet_management() from public, anon, authenticated;

-- Break rows follow the parent timesheet's property scope and lock state.
drop policy if exists timesheet_breaks_write_manager on timesheet_breaks;
create policy timesheet_breaks_write_manager on timesheet_breaks
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and exists (
      select 1 from timesheets t
      where t.id = timesheet_breaks.timesheet_id
        and can_access_property(t.property_id)
        and (t.locked_at is null or has_role_at_least('administrator'))
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and exists (
      select 1 from timesheets t
      where t.id = timesheet_breaks.timesheet_id
        and can_access_property(t.property_id)
        and (t.locked_at is null or has_role_at_least('administrator'))
    )
  );

-- ---------------------------------------------------------------------
-- 9. Duplicate timesheets when shift_id is NULL
--
-- `unique (user_id, work_date, shift_id)` does not constrain NULLs, so
-- unlimited ad-hoc timesheets could stack on one date. A partial index
-- covers the NULL case.
-- ---------------------------------------------------------------------
create unique index if not exists timesheets_user_date_no_shift_uniq
  on timesheets(user_id, work_date)
  where shift_id is null;

-- ---------------------------------------------------------------------
-- 10. Revoke the TRIGGER privilege on confidential tables
--
-- A supervisor holding TRIGGER on employment_details could attach their
-- own trigger function and read pay rates as it fires. TRIGGER is not
-- included in the explicit grants, but revoke defensively in case a
-- future grant is written as ALL.
-- ---------------------------------------------------------------------
revoke trigger on employment_details, emergency_contacts, timesheets,
                  clock_events, audit_logs, kiosk_credentials
  from anon, authenticated;
