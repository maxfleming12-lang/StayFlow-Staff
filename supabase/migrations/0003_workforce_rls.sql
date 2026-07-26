-- =====================================================================
-- StayFlow Staff — 0003 Row Level Security for the workforce schema
--
-- Principles applied throughout:
--   * Staff see their own rows, and only their own.
--   * Managers and supervisors are scoped to properties granted to them
--     via user_property_access; administrators and owners see the whole
--     organisation.
--   * Confidential employment data (pay rates, emergency contacts) is
--     manager-and-above only. Supervisors are deliberately excluded.
--   * Approved, exported or locked timesheets cannot be edited by staff,
--     and cannot be edited by managers either once locked.
--   * Immutable tables (clock_events, audit_logs) have no UPDATE or
--     DELETE policy at all, so they are append-only via the client API.
--
-- Helper functions from 0001 (current_organisation_id, has_role_at_least,
-- can_access_property) are SECURITY DEFINER and return nothing for
-- deactivated or archived users, so disabling an account fails every
-- policy shut immediately.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Additional helpers
-- ---------------------------------------------------------------------

/**
 * True when the caller is management for the given property: a manager or
 * supervisor with an explicit grant, or an administrator/owner anywhere in
 * the organisation.
 */
create or replace function manages_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_role_at_least('supervisor') and can_access_property(target_property_id);
$$;

comment on function manages_property(uuid) is
  'Caller is supervisor-or-above AND may access this property.';

/**
 * True when the caller shares an organisation with the given user.
 * Used to scope colleague-visible data without exposing other tenants.
 */
create or replace function shares_organisation(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_user_id
      and p.organisation_id = current_organisation_id()
  );
$$;

comment on function shares_organisation(uuid) is
  'Caller and target user belong to the same organisation.';

/**
 * True when the caller may manage the roster/attendance of the given user,
 * i.e. is supervisor-or-above and shares at least one property with them.
 */
create or replace function manages_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    has_role_at_least('administrator') and shares_organisation(target_user_id)
    or (
      has_role_at_least('supervisor')
      and exists (
        select 1
        from user_property_access target
        join user_property_access mine
          on mine.property_id = target.property_id
        where target.user_id = target_user_id
          and mine.user_id = auth.uid()
      )
    );
$$;

comment on function manages_user(uuid) is
  'Caller supervises the target user through a shared property assignment.';

-- =====================================================================
-- teams
-- =====================================================================
create policy teams_select on teams
  for select to authenticated
  using (organisation_id = current_organisation_id());

create policy teams_write on teams
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- employment_details  — CONFIDENTIAL
-- Supervisors must never read this table.
-- =====================================================================
create policy employment_select_self on employment_details
  for select to authenticated
  using (user_id = active_uid());

create policy employment_select_management on employment_details
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
  );

create policy employment_write_admin on employment_details
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('administrator'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('administrator'));

/**
 * Staff may read their own employment record but must not edit it — a
 * self-service pay rise is not a feature. There is deliberately no
 * self-update policy; only administrators write here.
 */

-- =====================================================================
-- emergency_contacts — CONFIDENTIAL
-- =====================================================================
create policy emergency_select_self on emergency_contacts
  for select to authenticated
  using (user_id = active_uid());

create policy emergency_select_management on emergency_contacts
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
  );

-- Staff maintain their own next-of-kin details.
create policy emergency_write_self on emergency_contacts
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

create policy emergency_write_admin on emergency_contacts
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('administrator'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('administrator'));

-- =====================================================================
-- staff_availability
-- =====================================================================
create policy availability_select_self on staff_availability
  for select to authenticated
  using (user_id = active_uid());

create policy availability_select_management on staff_availability
  for select to authenticated
  using (organisation_id = current_organisation_id() and manages_user(user_id));

-- Staff create and amend their own availability while it is still pending.
create policy availability_insert_self on staff_availability
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and status = 'pending'
  );

create policy availability_update_self on staff_availability
  for update to authenticated
  using (user_id = active_uid() and status = 'pending')
  with check (user_id = active_uid() and status = 'pending');

create policy availability_manage on staff_availability
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- leave_requests
-- =====================================================================
create policy leave_select_self on leave_requests
  for select to authenticated
  using (user_id = active_uid());

create policy leave_select_management on leave_requests
  for select to authenticated
  using (organisation_id = current_organisation_id() and manages_user(user_id));

create policy leave_insert_self on leave_requests
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and status = 'pending'
  );

-- Staff may amend or withdraw a request only while it is pending; once a
-- manager has decided, the record is theirs.
create policy leave_update_self_pending on leave_requests
  for update to authenticated
  using (user_id = active_uid() and status = 'pending')
  with check (user_id = active_uid() and status in ('pending','cancelled'));

create policy leave_manage on leave_requests
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- roster_periods
-- =====================================================================
-- Staff may see that a roster exists for a property they work at, which is
-- what lets the app show "published on ...". Shift contents are governed
-- separately by the shifts policies.
create policy roster_select on roster_periods
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (can_access_property(property_id) or has_role_at_least('manager'))
  );

create policy roster_write_manager on roster_periods
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
  );

-- =====================================================================
-- shifts
-- =====================================================================
/**
 * Staff see their own shifts once published, plus published open shifts at
 * properties they are permitted to work at (so they can claim them).
 * Draft rosters stay invisible to staff — that is the whole point of a
 * draft.
 */
create policy shifts_select_self on shifts
  for select to authenticated
  using (
    user_id = active_uid()
    and status = 'published'
  );

create policy shifts_select_open on shifts
  for select to authenticated
  using (
    is_open_shift
    and status = 'published'
    and user_id is null
    and can_access_property(property_id)
  );

create policy shifts_select_management on shifts
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and manages_property(property_id)
  );

create policy shifts_write_manager on shifts
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
  );

-- =====================================================================
-- shift_breaks — visibility follows the parent shift
-- =====================================================================
create policy shift_breaks_select on shift_breaks
  for select to authenticated
  using (
    exists (
      select 1 from shifts s
      where s.id = shift_breaks.shift_id
        and (
          (s.user_id = active_uid() and s.status = 'published')
          or manages_property(s.property_id)
        )
    )
  );

create policy shift_breaks_write_manager on shift_breaks
  for all to authenticated
  using (
    exists (
      select 1 from shifts s
      where s.id = shift_breaks.shift_id
        and has_role_at_least('manager')
        and can_access_property(s.property_id)
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and exists (
      select 1 from shifts s
      where s.id = shift_breaks.shift_id
        and has_role_at_least('manager')
        and can_access_property(s.property_id)
    )
  );

-- =====================================================================
-- shift_acknowledgements
-- =====================================================================
create policy shift_ack_select_self on shift_acknowledgements
  for select to authenticated
  using (user_id = active_uid());

create policy shift_ack_select_management on shift_acknowledgements
  for select to authenticated
  using (organisation_id = current_organisation_id() and manages_user(user_id));

-- Staff accept or decline their own acknowledgement row. They cannot
-- create one — it is created with the shift.
create policy shift_ack_update_self on shift_acknowledgements
  for update to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid());

create policy shift_ack_write_manager on shift_acknowledgements
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- open_shift_offers
-- =====================================================================
create policy open_offers_select on open_shift_offers
  for select to authenticated
  using (
    offered_to_user_id = active_uid()
    or claimed_by = active_uid()
    -- An offer to everyone is visible to anyone who may work the property.
    or (
      offered_to_user_id is null
      and exists (
        select 1 from shifts s
        where s.id = open_shift_offers.shift_id
          and can_access_property(s.property_id)
      )
    )
    or (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  );

-- Staff may claim an offer directed at them, or an open one. Approval is
-- a manager action, enforced by the trigger below.
create policy open_offers_update_claim on open_shift_offers
  for update to authenticated
  using (
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
  with check (claimed_by = active_uid());

create policy open_offers_write_manager on open_shift_offers
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

/**
 * A staff member may claim a shift but never approve their own claim.
 * Without this, the claim UPDATE policy would also permit setting
 * approved_by/status, which is a self-approval hole.
 */
create or replace function guard_open_shift_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if not has_role_at_least('manager') then
    if new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or (new.status = 'approved' and old.status <> 'approved')
    then
      raise exception 'Only a manager may approve a shift claim.';
    end if;
  end if;
  return new;
end;
$$;

create trigger open_shift_offers_guard_approval
  before update on open_shift_offers
  for each row execute function guard_open_shift_approval();

-- =====================================================================
-- shift_replacement_requests
-- =====================================================================
create policy replacement_select on shift_replacement_requests
  for select to authenticated
  using (
    requested_by = active_uid()
    or replacement_user_id = active_uid()
    or (organisation_id = current_organisation_id() and has_role_at_least('supervisor'))
  );

create policy replacement_insert_self on shift_replacement_requests
  for insert to authenticated
  with check (
    requested_by = active_uid()
    and organisation_id = current_organisation_id()
    and status = 'requested'
    -- Only for a shift that is actually theirs.
    and exists (
      select 1 from shifts s
      where s.id = shift_id and s.user_id = active_uid()
    )
  );

create policy replacement_write_manager on shift_replacement_requests
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- clock_events — APPEND ONLY
-- No UPDATE or DELETE policy exists, so an attendance record cannot be
-- rewritten or erased through the client API by anyone, including owners.
-- Corrections are made on the timesheet, with a reason and an audit entry.
-- =====================================================================
create policy clock_events_select_self on clock_events
  for select to authenticated
  using (user_id = active_uid());

create policy clock_events_select_management on clock_events
  for select to authenticated
  using (organisation_id = current_organisation_id() and manages_property(property_id));

/**
 * Staff record their own events. Managers may record on behalf of someone
 * else (manager-entered attendance), which must be explicitly marked.
 */
create policy clock_events_insert_self on clock_events
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and can_access_property(property_id)
    and source <> 'manager_entry'
    and entered_by is null
  );

create policy clock_events_insert_manager on clock_events
  for insert to authenticated
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
    and source = 'manager_entry'
    and entered_by = active_uid()
    and entry_reason is not null
  );

-- =====================================================================
-- timesheets
-- =====================================================================
create policy timesheets_select_self on timesheets
  for select to authenticated
  using (user_id = active_uid());

create policy timesheets_select_management on timesheets
  for select to authenticated
  using (organisation_id = current_organisation_id() and manages_property(property_id));

/**
 * Staff may acknowledge their hours and add a note, but only while the
 * timesheet is still open. Once approved, exported or locked they have no
 * write path at all — they must raise a timesheet_adjustment_request.
 * Column-level restriction is enforced by the trigger below.
 */
create policy timesheets_update_self_open on timesheets
  for update to authenticated
  using (
    user_id = active_uid()
    and status in ('draft','staff_review_requested','submitted')
  )
  with check (
    user_id = active_uid()
    and status in ('draft','staff_review_requested','submitted')
  );

create policy timesheets_write_manager on timesheets
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
    -- A locked timesheet has been exported to payroll; reopening it is an
    -- administrator action, not a routine manager edit.
    and (locked_at is null or has_role_at_least('administrator'))
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
    and can_access_property(property_id)
  );

/**
 * Staff may touch only their own note and acknowledgement. Without this,
 * the update policy above would let them rewrite their own hours while a
 * timesheet sat in 'submitted'.
 */
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
    if new.actual_start   is distinct from old.actual_start
       or new.actual_end  is distinct from old.actual_end
       or new.break_minutes is distinct from old.break_minutes
       or new.paid_hours  is distinct from old.paid_hours
       or new.status      is distinct from old.status
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.locked_at   is distinct from old.locked_at
       or new.exported_at is distinct from old.exported_at
       or new.is_no_show  is distinct from old.is_no_show
       or new.manager_note is distinct from old.manager_note
    then
      raise exception
        'Staff may not change recorded hours or approval status. Raise a timesheet correction request instead.';
    end if;
  end if;
  return new;
end;
$$;

create trigger timesheets_guard_staff_update
  before update on timesheets
  for each row execute function guard_timesheet_staff_update();

-- =====================================================================
-- timesheet_breaks / timesheet_adjustment_requests
-- =====================================================================
create policy timesheet_breaks_select on timesheet_breaks
  for select to authenticated
  using (
    exists (
      select 1 from timesheets t
      where t.id = timesheet_breaks.timesheet_id
        and (t.user_id = active_uid() or manages_property(t.property_id))
    )
  );

create policy timesheet_breaks_write_manager on timesheet_breaks
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy adjustment_select on timesheet_adjustment_requests
  for select to authenticated
  using (
    user_id = active_uid()
    or (organisation_id = current_organisation_id() and manages_user(user_id))
  );

create policy adjustment_insert_self on timesheet_adjustment_requests
  for insert to authenticated
  with check (
    user_id = active_uid()
    and organisation_id = current_organisation_id()
    and status = 'open'
  );

create policy adjustment_write_manager on timesheet_adjustment_requests
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

-- =====================================================================
-- announcements
-- =====================================================================
/**
 * A published announcement is visible when it targets the reader: all
 * staff, their property, their team, or them personally. Drafts and
 * scheduled announcements stay with management until published.
 */
create policy announcements_select_targeted on announcements
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and status = 'published'
    and (expires_at is null or expires_at > now())
    and exists (
      select 1 from announcement_recipients r
      where r.announcement_id = announcements.id
        and (
          r.all_staff
          or r.user_id = active_uid()
          or r.property_id in (
            select property_id from user_property_access where user_id = active_uid()
          )
          or r.team_id in (
            select team_id from profiles where id = active_uid() and team_id is not null
          )
        )
    )
  );

create policy announcements_select_management on announcements
  for select to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy announcements_write_manager on announcements
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy ann_recipients_select on announcement_recipients
  for select to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy ann_recipients_write on announcement_recipients
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy ann_ack_select_self on announcement_acknowledgements
  for select to authenticated
  using (user_id = active_uid());

create policy ann_ack_select_management on announcement_acknowledgements
  for select to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy ann_ack_write_self on announcement_acknowledgements
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

-- =====================================================================
-- tasks
-- =====================================================================
create policy tasks_select on tasks
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (
      manages_property(property_id)
      -- Assigned to them directly, or to their team.
      or exists (
        select 1 from task_assignments ta
        where ta.task_id = tasks.id
          and (
            ta.user_id = active_uid()
            or ta.team_id in (
              select team_id from profiles where id = active_uid() and team_id is not null
            )
          )
      )
    )
  );

-- Staff progress their assigned tasks; verification stays with management
-- via the trigger below.
create policy tasks_update_assigned on tasks
  for update to authenticated
  using (
    exists (
      select 1 from task_assignments ta
      where ta.task_id = tasks.id
        and (
          ta.user_id = active_uid()
          or ta.team_id in (
            select team_id from profiles where id = active_uid() and team_id is not null
          )
        )
    )
  )
  with check (organisation_id = current_organisation_id());

create policy tasks_write_supervisor on tasks
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('supervisor')
    and can_access_property(property_id)
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('supervisor')
    and can_access_property(property_id)
  );

/**
 * Completing a task is a staff action; verifying it is a supervisor
 * action. Allowing both from one policy would let a staff member mark
 * their own work verified.
 */
create or replace function guard_task_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() then
    return new;
  end if;

  if not has_role_at_least('supervisor') then
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or (new.status = 'verified' and old.status <> 'verified')
    then
      raise exception 'Only a supervisor or above may verify a task.';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_guard_verification
  before update on tasks
  for each row execute function guard_task_verification();

create policy task_assignments_select on task_assignments
  for select to authenticated
  using (
    user_id = active_uid()
    or (organisation_id = current_organisation_id() and has_role_at_least('supervisor'))
    or team_id in (select team_id from profiles where id = active_uid() and team_id is not null)
  );

create policy task_assignments_write on task_assignments
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('supervisor'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('supervisor'));

create policy task_comments_select on task_comments
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and exists (select 1 from tasks t where t.id = task_comments.task_id)
  );

create policy task_comments_insert_self on task_comments
  for insert to authenticated
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

create policy task_comments_update_self on task_comments
  for update to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid());

-- =====================================================================
-- documents
-- =====================================================================
/**
 * A document is readable when a permission row matches the reader's role,
 * team or property. A document with no permission rows is management-only,
 * which is the safe default for an accidental upload.
 */
create policy documents_select on documents
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and archived_at is null
    and (
      has_role_at_least('manager')
      or exists (
        select 1 from document_permissions dp
        where dp.document_id = documents.id
          and (
            dp.property_id in (
              select property_id from user_property_access where user_id = active_uid()
            )
            or dp.team_id in (
              select team_id from profiles where id = active_uid() and team_id is not null
            )
            or (dp.role is not null and has_role_at_least(dp.role))
          )
      )
    )
  );

create policy documents_write_manager on documents
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy doc_permissions_select on document_permissions
  for select to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy doc_permissions_write on document_permissions
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy doc_ack_select_self on document_acknowledgements
  for select to authenticated
  using (user_id = active_uid());

create policy doc_ack_select_management on document_acknowledgements
  for select to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('manager'));

create policy doc_ack_write_self on document_acknowledgements
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

-- =====================================================================
-- push_subscriptions — strictly the authenticated user's own
-- No management read policy: a manager has no reason to read another
-- person's device endpoints, and those keys can send them notifications.
-- =====================================================================
create policy push_subs_all_self on push_subscriptions
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

-- =====================================================================
-- notification_preferences / notifications
-- =====================================================================
create policy notif_prefs_all_self on notification_preferences
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

create policy notifications_select_self on notifications
  for select to authenticated
  using (user_id = active_uid());

-- Recipients mark as read/archived. Notifications themselves are created
-- server-side, so there is no client INSERT policy.
create policy notifications_update_self on notifications
  for update to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid());

create policy notifications_delete_self on notifications
  for delete to authenticated
  using (user_id = active_uid());

-- =====================================================================
-- organisation_settings
-- =====================================================================
create policy org_settings_select on organisation_settings
  for select to authenticated
  using (organisation_id = current_organisation_id());

create policy org_settings_write_admin on organisation_settings
  for all to authenticated
  using (organisation_id = current_organisation_id() and has_role_at_least('administrator'))
  with check (organisation_id = current_organisation_id() and has_role_at_least('administrator'));

-- =====================================================================
-- kiosk_credentials — NO client policy of any kind.
-- RLS is enabled with zero policies, so every client read and write is
-- denied. PIN verification happens exclusively in server-side code using
-- the service-role key, which is the only way a hash should ever be
-- compared.
-- =====================================================================

-- =====================================================================
-- calendar_tokens
-- Readable and revocable by the owner. The feed endpoint itself resolves
-- the token server-side with the service-role key, since a calendar client
-- cannot authenticate as the user.
-- =====================================================================
create policy calendar_tokens_all_self on calendar_tokens
  for all to authenticated
  using (user_id = active_uid())
  with check (user_id = active_uid() and organisation_id = current_organisation_id());

-- =====================================================================
-- Grants
-- `anon` receives nothing anywhere.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'teams','employment_details','emergency_contacts','staff_availability',
    'leave_requests','roster_periods','shifts','shift_breaks',
    'shift_acknowledgements','open_shift_offers','shift_replacement_requests',
    'clock_events','timesheets','timesheet_breaks',
    'timesheet_adjustment_requests','announcements','announcement_recipients',
    'announcement_acknowledgements','tasks','task_assignments','task_comments',
    'documents','document_permissions','document_acknowledgements',
    'push_subscriptions','notification_preferences','notifications',
    'organisation_settings','calendar_tokens'
  ]
  loop
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;

  -- kiosk_credentials is server-side only: no grant to either role.
  execute 'revoke all on kiosk_credentials from anon, authenticated';
end $$;
