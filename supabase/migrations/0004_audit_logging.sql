-- =====================================================================
-- StayFlow Staff — 0004 audit logging
--
-- Records significant events with before/after values. Authentication
-- secrets are never captured: the trigger operates on application tables
-- only, and password hashes live in auth.users, which is not audited here.
-- =====================================================================

/**
 * Write one audit entry.
 *
 * SECURITY DEFINER because audit_logs has no INSERT policy — the whole
 * point is that a client cannot forge or suppress entries. Only triggers
 * and trusted server-side code reach this function.
 */
create or replace function write_audit_log(
  p_organisation_id uuid,
  p_property_id     uuid,
  p_action          text,
  p_entity_type     text,
  p_entity_id       uuid,
  p_before          jsonb,
  p_after           jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_logs (
    organisation_id, property_id, actor_id, action,
    entity_type, entity_id, before_value, after_value
  )
  values (
    p_organisation_id, p_property_id, auth.uid(), p_action,
    p_entity_type, p_entity_id, p_before, p_after
  );
end;
$$;

comment on function write_audit_log is
  'Append one audit entry as the current user. SECURITY DEFINER so that
   audit_logs can stay INSERT-less for every client role.';

/**
 * Columns never copied into an audit entry.
 *
 * Pay rate IS audited — a change to it is exactly the kind of event that
 * must be reviewable — but tokens and hashes never are.
 */
create or replace function redact_sensitive(payload jsonb)
returns jsonb
language sql
immutable
as $$
  select payload
    - 'pin_hash'
    - 'token'
    - 'p256dh'
    - 'auth_key'
    - 'encrypted_password'
    - 'password';
$$;

comment on function redact_sensitive(jsonb) is
  'Strips credentials and push keys from an audit payload. Pay rates are
   deliberately retained — they are the point of auditing.';

/**
 * Generic audit trigger.
 *
 * Attach with a per-table action prefix, e.g.
 *   create trigger shifts_audit after insert or update or delete on shifts
 *     for each row execute function audit_row('shift');
 */
create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entity      text := tg_argv[0];
  org_id      uuid;
  prop_id     uuid;
  before_val  jsonb;
  after_val   jsonb;
  action_name text;
  rec         record;
begin
  if tg_op = 'DELETE' then
    rec := old;
    before_val := redact_sensitive(to_jsonb(old));
    after_val := null;
    action_name := entity || '.deleted';
  elsif tg_op = 'INSERT' then
    rec := new;
    before_val := null;
    after_val := redact_sensitive(to_jsonb(new));
    action_name := entity || '.created';
  else
    rec := new;
    before_val := redact_sensitive(to_jsonb(old));
    after_val := redact_sensitive(to_jsonb(new));
    action_name := entity || '.updated';
    -- Nothing actually changed; do not create noise.
    if before_val = after_val then
      return coalesce(new, old);
    end if;
  end if;

  org_id := (to_jsonb(rec) ->> 'organisation_id')::uuid;
  -- Not every audited table is property-scoped.
  begin
    prop_id := (to_jsonb(rec) ->> 'property_id')::uuid;
  exception when others then
    prop_id := null;
  end;

  if org_id is not null then
    perform write_audit_log(
      org_id, prop_id, action_name, entity,
      (to_jsonb(rec) ->> 'id')::uuid, before_val, after_val
    );
  end if;

  return coalesce(new, old);
end;
$$;

comment on function audit_row() is
  'Generic AFTER trigger writing a before/after audit entry. Pass the
   entity name as the first trigger argument.';

-- ---------------------------------------------------------------------
-- Attach to the tables whose changes matter
-- ---------------------------------------------------------------------
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function audit_row('staff_profile');

create trigger user_roles_audit
  after insert or update or delete on user_roles
  for each row execute function audit_row('role');

create trigger user_property_access_audit
  after insert or update or delete on user_property_access
  for each row execute function audit_row('property_access');

create trigger employment_details_audit
  after insert or update or delete on employment_details
  for each row execute function audit_row('employment');

create trigger shifts_audit
  after insert or update or delete on shifts
  for each row execute function audit_row('shift');

create trigger roster_periods_audit
  after insert or update or delete on roster_periods
  for each row execute function audit_row('roster');

create trigger leave_requests_audit
  after insert or update or delete on leave_requests
  for each row execute function audit_row('leave_request');

create trigger timesheets_audit
  after insert or update or delete on timesheets
  for each row execute function audit_row('timesheet');

create trigger announcements_audit
  after insert or update or delete on announcements
  for each row execute function audit_row('announcement');

create trigger documents_audit
  after insert or update or delete on documents
  for each row execute function audit_row('document');

create trigger organisation_settings_audit
  after insert or update or delete on organisation_settings
  for each row execute function audit_row('settings');

create trigger notifications_audit
  after insert on notifications
  for each row execute function audit_row('notification');

/**
 * Pay-rate changes deserve their own entry so they can be found without
 * trawling every employment update.
 */
create or replace function audit_pay_rate_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hourly_rate is distinct from old.hourly_rate then
    perform write_audit_log(
      new.organisation_id, null, 'employment.pay_rate_changed', 'employment',
      new.id,
      jsonb_build_object('hourly_rate', old.hourly_rate),
      jsonb_build_object('hourly_rate', new.hourly_rate)
    );
  end if;
  return new;
end;
$$;

create trigger employment_details_pay_rate_audit
  after update on employment_details
  for each row execute function audit_pay_rate_change();
