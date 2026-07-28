-- =====================================================================
-- StayFlow Staff — 0002 workforce core
--
-- Adds the operational schema: teams, employment records, availability,
-- leave, rostering, clocking, timesheets, announcements, tasks, documents,
-- notifications and organisation settings.
--
-- Conventions, consistent with 0001:
--   * uuid primary keys, gen_random_uuid()
--   * every operational row carries organisation_id
--   * property-specific rows also carry property_id
--   * created_at / updated_at everywhere, created_by where meaningful
--   * archived_at for soft deletion instead of destructive DELETE
--   * RLS ENABLEd and FORCEd on every table (policies in 0003)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin create type leave_status as enum
  ('pending','approved','declined','cancelled'); exception when duplicate_object then null; end $$;

do $$ begin create type leave_category as enum
  ('annual','personal','carers','unpaid','parental','compassionate',
   'long_service','community_service','other'); exception when duplicate_object then null; end $$;

do $$ begin create type availability_status as enum
  ('pending','approved','declined'); exception when duplicate_object then null; end $$;

do $$ begin create type roster_status as enum
  ('draft','published','archived'); exception when duplicate_object then null; end $$;

do $$ begin create type shift_status as enum
  ('draft','published','cancelled'); exception when duplicate_object then null; end $$;

do $$ begin create type acknowledgement_status as enum
  ('pending','viewed','accepted','declined'); exception when duplicate_object then null; end $$;

do $$ begin create type replacement_status as enum
  ('requested','offered','claimed','approved','rejected','withdrawn');
  exception when duplicate_object then null; end $$;

do $$ begin create type clock_event_type as enum
  ('clock_in','break_start','break_end','clock_out'); exception when duplicate_object then null; end $$;

do $$ begin create type clock_source as enum
  ('app','kiosk','manager_entry'); exception when duplicate_object then null; end $$;

do $$ begin create type timesheet_status as enum
  ('draft','staff_review_requested','submitted','manager_review',
   'approved','exported','locked'); exception when duplicate_object then null; end $$;

do $$ begin create type adjustment_status as enum
  ('open','approved','declined'); exception when duplicate_object then null; end $$;

do $$ begin create type announcement_category as enum
  ('general','policy','shift','safety','urgent'); exception when duplicate_object then null; end $$;

do $$ begin create type announcement_status as enum
  ('draft','scheduled','published','expired','withdrawn');
  exception when duplicate_object then null; end $$;

do $$ begin create type task_category as enum
  ('housekeeping','reception','maintenance','grounds','linen','stock',
   'safety','management','other'); exception when duplicate_object then null; end $$;

do $$ begin create type task_status as enum
  ('new','assigned','in_progress','waiting','completed','verified','cancelled');
  exception when duplicate_object then null; end $$;

do $$ begin create type task_priority as enum
  ('low','normal','high','urgent'); exception when duplicate_object then null; end $$;

do $$ begin create type notification_category as enum
  ('roster_published','shift_changed','shift_cancelled','shift_ack_reminder',
   'open_shift','replacement_update','leave_update','timesheet_correction',
   'timesheet_approval_reminder','announcement','urgent_notice',
   'task_assigned','task_due','document_ack'); exception when duplicate_object then null; end $$;

do $$ begin create type pay_period_type as enum
  ('weekly','fortnightly'); exception when duplicate_object then null; end $$;

do $$ begin create type clocking_mode as enum
  ('any_device','registered_devices','kiosk','geofence','manager_entry');
  exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------
create table if not exists teams (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  property_id     uuid references properties(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  archived_at     timestamptz
);
comment on table teams is
  'A working group such as Management, Housekeeping or Maintenance. A NULL
   property_id means the team spans every property.';
create index if not exists teams_org_idx on teams(organisation_id);
create trigger teams_set_updated_at before update on teams
  for each row execute function set_updated_at();

-- profiles gains a team reference now that teams exists.
alter table profiles add column if not exists team_id uuid references teams(id) on delete set null;
comment on column profiles.team_id is 'Primary team this staff member belongs to.';

-- ---------------------------------------------------------------------
-- employment_details  (confidential — pay rates live here, not on profiles)
-- ---------------------------------------------------------------------
create table if not exists employment_details (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references organisations(id) on delete cascade,
  user_id               uuid not null unique references auth.users(id) on delete cascade,
  status                employment_status not null default 'active',
  employment_type       employment_type not null default 'casual',
  start_date            date,
  end_date              date,
  job_title             text,
  hourly_rate           numeric(10,2) check (hourly_rate >= 0),
  standard_weekly_hours numeric(5,2) check (standard_weekly_hours >= 0),
  payroll_reference     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  archived_at           timestamptz,
  constraint employment_dates_ordered
    check (end_date is null or start_date is null or end_date >= start_date)
);
comment on table employment_details is
  'Confidential employment record. Deliberately separate from profiles so
   that pay rate and payroll reference can carry stricter RLS policies —
   supervisors may read a colleague profile but never this table.';
comment on column employment_details.hourly_rate is
  'AUD. Used for ESTIMATED labour cost only. Not award-interpreted payroll.';
create index if not exists employment_details_org_idx on employment_details(organisation_id);
create trigger employment_details_set_updated_at before update on employment_details
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- emergency_contacts  (confidential)
-- ---------------------------------------------------------------------
create table if not exists emergency_contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  full_name       text not null,
  relationship    text,
  phone           text not null,
  alternate_phone text,
  is_primary      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
comment on table emergency_contacts is
  'Next-of-kin details. Readable by the staff member and by management only.';
create index if not exists emergency_contacts_user_idx on emergency_contacts(user_id);
create trigger emergency_contacts_set_updated_at before update on emergency_contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- staff_availability
-- ---------------------------------------------------------------------
create table if not exists staff_availability (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Recurring weekly rule: day_of_week set, specific_date null.
  -- Date-specific rule:    specific_date set, day_of_week null.
  day_of_week     smallint check (day_of_week between 0 and 6),
  specific_date   date,
  start_time      time,
  end_time        time,
  is_available    boolean not null default true,
  note            text,
  status          availability_status not null default 'pending',
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  constraint availability_recurring_or_dated
    check (num_nonnulls(day_of_week, specific_date) = 1),
  constraint availability_times_ordered
    check (start_time is null or end_time is null or end_time > start_time)
);
comment on table staff_availability is
  'Recurring weekly availability (day_of_week) or a date-specific override
   (specific_date). Exactly one of the two is set, enforced by constraint.';
comment on column staff_availability.is_available is
  'false marks an unavailable period rather than an available one.';
create index if not exists availability_user_idx on staff_availability(user_id);
create trigger staff_availability_set_updated_at before update on staff_availability
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- leave_requests
-- ---------------------------------------------------------------------
create table if not exists leave_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  property_id      uuid references properties(id) on delete set null,
  user_id          uuid not null references auth.users(id) on delete cascade,
  category         leave_category not null,
  first_date       date not null,
  last_date        date not null,
  is_partial_day   boolean not null default false,
  start_time       time,
  end_time         time,
  total_hours      numeric(6,2) check (total_hours >= 0),
  note             text,
  attachment_path  text,
  status           leave_status not null default 'pending',
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  manager_note     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  archived_at      timestamptz,
  constraint leave_dates_ordered check (last_date >= first_date),
  -- Partial-day leave is meaningless without a time range.
  constraint leave_partial_needs_times
    check (not is_partial_day or (start_time is not null and end_time is not null)),
  constraint leave_times_ordered
    check (start_time is null or end_time is null or end_time > start_time)
);
comment on table leave_requests is
  'A staff leave request and its management decision.';
comment on column leave_requests.attachment_path is
  'Supabase Storage object path. Never a public URL — access is via a
   short-lived signed URL issued server-side.';
create index if not exists leave_user_idx on leave_requests(user_id);
create index if not exists leave_org_status_idx on leave_requests(organisation_id, status);
create index if not exists leave_dates_idx on leave_requests(first_date, last_date);
create trigger leave_requests_set_updated_at before update on leave_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- roster_periods
-- ---------------------------------------------------------------------
create table if not exists roster_periods (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  property_id      uuid not null references properties(id) on delete cascade,
  week_start_date  date not null,
  status           roster_status not null default 'draft',
  published_at     timestamptz,
  published_by     uuid references auth.users(id) on delete set null,
  publish_message  text,
  requires_ack     boolean not null default true,
  is_template      boolean not null default false,
  template_name    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  archived_at      timestamptz,
  -- A template is not tied to a calendar week, so uniqueness applies only
  -- to real roster weeks.
  constraint roster_template_named
    check (not is_template or template_name is not null)
);
comment on table roster_periods is
  'One week of roster for one property, or a reusable template when
   is_template is true.';
comment on column roster_periods.published_at is
  'Exact publication time. Together with published_by this records who
   published the roster and when.';
create unique index if not exists roster_periods_week_uniq
  on roster_periods(property_id, week_start_date)
  where is_template = false and archived_at is null;
create index if not exists roster_periods_org_idx on roster_periods(organisation_id);
create trigger roster_periods_set_updated_at before update on roster_periods
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------
create table if not exists shifts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  property_id       uuid not null references properties(id) on delete cascade,
  roster_period_id  uuid references roster_periods(id) on delete cascade,
  team_id           uuid references teams(id) on delete set null,
  -- NULL user_id is an unassigned open shift.
  user_id           uuid references auth.users(id) on delete set null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            shift_status not null default 'draft',
  required_role     text,
  required_skill    text,
  notes             text,
  is_open_shift     boolean not null default false,
  published_at      timestamptz,
  published_by      uuid references auth.users(id) on delete set null,
  -- Recorded when a manager knowingly publishes despite a warning.
  override_reason   text,
  overridden_by     uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  archived_at       timestamptz,
  constraint shift_times_ordered check (ends_at > starts_at)
);
comment on table shifts is
  'A rostered shift. Times are timestamptz so overnight shifts and the
   October/April daylight-saving transitions are handled correctly.';
comment on column shifts.override_reason is
  'Why a manager published this shift despite an overlap, leave, rest-break
   or cross-property warning. Warnings advise; they do not block.';
create index if not exists shifts_user_starts_idx on shifts(user_id, starts_at);
create index if not exists shifts_property_starts_idx on shifts(property_id, starts_at);
create index if not exists shifts_roster_idx on shifts(roster_period_id);
create trigger shifts_set_updated_at before update on shifts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- shift_breaks
-- ---------------------------------------------------------------------
create table if not exists shift_breaks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  shift_id        uuid not null references shifts(id) on delete cascade,
  starts_at       timestamptz,
  duration_minutes integer not null check (duration_minutes > 0),
  is_paid         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table shift_breaks is 'Planned breaks within a rostered shift.';
create index if not exists shift_breaks_shift_idx on shift_breaks(shift_id);
create trigger shift_breaks_set_updated_at before update on shift_breaks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- shift_acknowledgements
-- ---------------------------------------------------------------------
create table if not exists shift_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  shift_id        uuid not null references shifts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          acknowledgement_status not null default 'pending',
  viewed_at       timestamptz,
  responded_at    timestamptz,
  decline_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (shift_id, user_id),
  -- A decline must always carry a reason; it creates a manager review item
  -- rather than removing the shift.
  constraint decline_needs_reason
    check (status <> 'declined' or decline_reason is not null)
);
comment on table shift_acknowledgements is
  'Tracks who has viewed, accepted or declined a published shift. A decline
   never removes the shift — it raises a review item for the manager.';
create index if not exists shift_ack_user_idx on shift_acknowledgements(user_id);
create trigger shift_ack_set_updated_at before update on shift_acknowledgements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- open_shift_offers
-- ---------------------------------------------------------------------
create table if not exists open_shift_offers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  shift_id        uuid not null references shifts(id) on delete cascade,
  -- NULL offered_to_user_id means the shift was offered to all eligible staff.
  offered_to_user_id uuid references auth.users(id) on delete cascade,
  claimed_by      uuid references auth.users(id) on delete set null,
  claimed_at      timestamptz,
  approved_by     uuid references auth.users(id) on delete set null,
  approved_at     timestamptz,
  status          replacement_status not null default 'offered',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);
comment on table open_shift_offers is
  'Offers of an unassigned shift. A claim is provisional until a manager
   approves, unless organisation_settings.auto_approve_open_shifts is on.';
create index if not exists open_shift_offers_shift_idx on open_shift_offers(shift_id);
create trigger open_shift_offers_set_updated_at before update on open_shift_offers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- shift_replacement_requests
-- ---------------------------------------------------------------------
create table if not exists shift_replacement_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  shift_id          uuid not null references shifts(id) on delete cascade,
  requested_by      uuid not null references auth.users(id) on delete cascade,
  reason            text,
  status            replacement_status not null default 'requested',
  replacement_user_id uuid references auth.users(id) on delete set null,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  manager_note      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table shift_replacement_requests is
  'A staff request to be replaced on a shift, and its resolution.';
create index if not exists replacement_shift_idx on shift_replacement_requests(shift_id);
create trigger replacement_set_updated_at before update on shift_replacement_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- clock_events
-- ---------------------------------------------------------------------
create table if not exists clock_events (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations(id) on delete cascade,
  property_id        uuid not null references properties(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  shift_id           uuid references shifts(id) on delete set null,
  event_type         clock_event_type not null,
  -- Authoritative time, stamped by the database on receipt.
  server_time        timestamptz not null default now(),
  -- What the device believed the time was. Preserved for offline events.
  client_time        timestamptz,
  received_at        timestamptz not null default now(),
  source             clock_source not null default 'app',
  device_id          text,
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  location_accuracy  numeric(8,2),
  was_offline        boolean not null default false,
  is_flagged         boolean not null default false,
  flag_reason        text,
  -- Client-generated key that makes a replayed offline event a no-op.
  idempotency_key    text,
  entered_by         uuid references auth.users(id) on delete set null,
  entry_reason       text,
  created_at         timestamptz not null default now()
);
comment on table clock_events is
  'Immutable attendance events. server_time is authoritative; client_time is
   retained so an event queued offline keeps the moment it actually happened.
   Geolocation is optional, captured only with explicit permission, and is
   never treated as proof of identity.';
comment on column clock_events.idempotency_key is
  'Unique per user. Prevents a queued offline event from being recorded
   twice when the device retries on reconnect.';
create unique index if not exists clock_events_idempotency_uniq
  on clock_events(user_id, idempotency_key) where idempotency_key is not null;
create index if not exists clock_events_user_time_idx on clock_events(user_id, server_time desc);
create index if not exists clock_events_property_time_idx on clock_events(property_id, server_time desc);

-- ---------------------------------------------------------------------
-- timesheets
-- ---------------------------------------------------------------------
create table if not exists timesheets (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references properties(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  shift_id            uuid references shifts(id) on delete set null,
  work_date           date not null,
  rostered_start      timestamptz,
  rostered_end        timestamptz,
  actual_start        timestamptz,
  actual_end          timestamptz,
  break_minutes       integer not null default 0 check (break_minutes >= 0),
  paid_hours          numeric(6,2) check (paid_hours >= 0),
  variance_hours      numeric(6,2),
  status              timesheet_status not null default 'draft',
  staff_note          text,
  manager_note        text,
  is_no_show          boolean not null default false,
  staff_acknowledged_at timestamptz,
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  exported_at         timestamptz,
  locked_at           timestamptz,
  pay_period_start    date,
  pay_period_end      date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  constraint timesheet_times_ordered
    check (actual_end is null or actual_start is null or actual_end > actual_start),
  unique (user_id, work_date, shift_id)
);
comment on table timesheets is
  'Derived from clock_events, then reviewed. Staff never overwrite an
   approved timesheet — they raise a timesheet_adjustment_request instead.';
comment on column timesheets.paid_hours is
  'ESTIMATE. Not award-interpreted payroll; overtime and penalty rates are
   not calculated at this stage.';
create index if not exists timesheets_user_date_idx on timesheets(user_id, work_date desc);
create index if not exists timesheets_org_status_idx on timesheets(organisation_id, status);
create trigger timesheets_set_updated_at before update on timesheets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- timesheet_breaks
-- ---------------------------------------------------------------------
create table if not exists timesheet_breaks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  timesheet_id    uuid not null references timesheets(id) on delete cascade,
  starts_at       timestamptz,
  ends_at         timestamptz,
  duration_minutes integer check (duration_minutes >= 0),
  is_paid         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint timesheet_break_times_ordered
    check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
comment on table timesheet_breaks is 'Actual breaks taken during a shift.';
create index if not exists timesheet_breaks_ts_idx on timesheet_breaks(timesheet_id);
create trigger timesheet_breaks_set_updated_at before update on timesheet_breaks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- timesheet_adjustment_requests
-- ---------------------------------------------------------------------
create table if not exists timesheet_adjustment_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  timesheet_id      uuid references timesheets(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- Set when reporting time for a shift that has no timesheet at all.
  requested_date    date,
  requested_start   timestamptz,
  requested_end     timestamptz,
  requested_break_minutes integer check (requested_break_minutes >= 0),
  explanation       text not null,
  status            adjustment_status not null default 'open',
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  manager_note      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table timesheet_adjustment_requests is
  'A staff correction or missing-time request. The route by which staff
   change an approved timesheet, since they may never edit one directly.';
create index if not exists adjustment_ts_idx on timesheet_adjustment_requests(timesheet_id);
create index if not exists adjustment_user_idx on timesheet_adjustment_requests(user_id);
create trigger adjustment_set_updated_at before update on timesheet_adjustment_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------
create table if not exists announcements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  property_id     uuid references properties(id) on delete cascade,
  title           text not null check (length(trim(title)) > 0),
  body            text not null,
  category        announcement_category not null default 'general',
  is_urgent       boolean not null default false,
  status          announcement_status not null default 'draft',
  requires_ack    boolean not null default false,
  attachment_path text,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  published_by    uuid references auth.users(id) on delete set null,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  archived_at     timestamptz
);
comment on table announcements is
  'Notices from management. A NULL property_id targets every property.';
create index if not exists announcements_org_status_idx on announcements(organisation_id, status);
create trigger announcements_set_updated_at before update on announcements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- announcement_recipients / announcement_acknowledgements
-- ---------------------------------------------------------------------
create table if not exists announcement_recipients (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  announcement_id  uuid not null references announcements(id) on delete cascade,
  -- Exactly one targeting dimension is set per row.
  user_id          uuid references auth.users(id) on delete cascade,
  team_id          uuid references teams(id) on delete cascade,
  property_id      uuid references properties(id) on delete cascade,
  all_staff        boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint recipient_one_target
    check (num_nonnulls(user_id, team_id, property_id) + (all_staff)::int = 1)
);
comment on table announcement_recipients is
  'Targeting rules for an announcement: one person, a team, a property, or
   all active staff. Exactly one dimension per row.';
create index if not exists ann_recipients_ann_idx on announcement_recipients(announcement_id);

create table if not exists announcement_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (announcement_id, user_id)
);
comment on table announcement_acknowledgements is
  'Read receipts and explicit acknowledgements per staff member.';
create index if not exists ann_ack_user_idx on announcement_acknowledgements(user_id);

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
create table if not exists tasks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  property_id      uuid not null references properties(id) on delete cascade,
  team_id          uuid references teams(id) on delete set null,
  category         task_category not null default 'other',
  title            text not null check (length(trim(title)) > 0),
  description      text,
  location         text,
  priority         task_priority not null default 'normal',
  status           task_status not null default 'new',
  due_at           timestamptz,
  checklist        jsonb not null default '[]'::jsonb,
  before_photo_path     text,
  completion_photo_path text,
  completed_by     uuid references auth.users(id) on delete set null,
  completed_at     timestamptz,
  verified_by      uuid references auth.users(id) on delete set null,
  verified_at      timestamptz,
  recurrence_rule  text,
  parent_task_id   uuid references tasks(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  archived_at      timestamptz
);
comment on table tasks is
  'An operational job. location holds a room number or area description —
   StayFlow does not model rooms, that belongs to the PMS.';
comment on column tasks.recurrence_rule is
  'iCalendar RRULE string for recurring tasks, e.g. FREQ=DAILY.';
create index if not exists tasks_property_status_idx on tasks(property_id, status);
create index if not exists tasks_due_idx on tasks(due_at) where archived_at is null;
create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();

create table if not exists task_assignments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  task_id         uuid not null references tasks(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  team_id         uuid references teams(id) on delete cascade,
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid references auth.users(id) on delete set null,
  constraint assignment_one_target check (num_nonnulls(user_id, team_id) = 1)
);
comment on table task_assignments is
  'Who a task is assigned to — an individual or a whole team.';
create index if not exists task_assignments_task_idx on task_assignments(task_id);
create index if not exists task_assignments_user_idx on task_assignments(user_id);

create table if not exists task_comments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  task_id         uuid not null references tasks(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
comment on table task_comments is 'Discussion thread on a task.';
create index if not exists task_comments_task_idx on task_comments(task_id);
create trigger task_comments_set_updated_at before update on task_comments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------
create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  property_id      uuid references properties(id) on delete cascade,
  folder           text not null default 'Policies',
  title            text not null check (length(trim(title)) > 0),
  description      text,
  storage_path     text not null,
  mime_type        text,
  file_size_bytes  bigint check (file_size_bytes >= 0),
  version          integer not null default 1 check (version >= 1),
  supersedes_id    uuid references documents(id) on delete set null,
  requires_ack     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  archived_at      timestamptz
);
comment on table documents is
  'Staff document library. storage_path points at a PRIVATE Supabase Storage
   bucket; files are served through short-lived signed URLs issued
   server-side, never a permanently public link.';
comment on column documents.supersedes_id is
  'Previous version, retained so version history survives a replacement.';
create index if not exists documents_org_folder_idx on documents(organisation_id, folder);
create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();

create table if not exists document_permissions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  document_id     uuid not null references documents(id) on delete cascade,
  role            app_role,
  team_id         uuid references teams(id) on delete cascade,
  property_id     uuid references properties(id) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint document_permission_one_target
    check (num_nonnulls(role, team_id, property_id) = 1)
);
comment on table document_permissions is
  'Grants access to a document by role, team or property. A document with no
   permission rows is visible to management only.';
create index if not exists doc_permissions_doc_idx on document_permissions(document_id);

create table if not exists document_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  document_id     uuid not null references documents(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (document_id, user_id)
);
comment on table document_acknowledgements is
  'Who has read and acknowledged a document requiring acknowledgement.';

-- ---------------------------------------------------------------------
-- Notifications and push
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth_key        text not null,
  device_label    text,
  user_agent      text,
  last_used_at    timestamptz,
  failure_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table push_subscriptions is
  'One Web Push subscription per user per device. Belongs strictly to the
   authenticated user — no other staff member may read or delete it.';
comment on column push_subscriptions.failure_count is
  'Consecutive delivery failures. Used to retire expired subscriptions.';
create index if not exists push_subs_user_idx on push_subscriptions(user_id);
create trigger push_subs_set_updated_at before update on push_subscriptions
  for each row execute function set_updated_at();

create table if not exists notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  -- Categories the user has opted out of; everything else is enabled.
  muted_categories notification_category[] not null default '{}',
  quiet_hours_start time,
  quiet_hours_end   time,
  push_enabled    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table notification_preferences is
  'Per-user notification settings, including quiet hours. Urgent operational
   notices deliberately ignore quiet hours.';
create trigger notif_prefs_set_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

create table if not exists notifications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  property_id     uuid references properties(id) on delete set null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        notification_category not null,
  title           text not null,
  body            text not null,
  -- In-app destination, e.g. /roster/<id>. Same-origin path only.
  deep_link       text,
  is_urgent       boolean not null default false,
  read_at         timestamptz,
  push_sent_at    timestamptz,
  push_failed_at  timestamptz,
  push_error      text,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);
comment on table notifications is
  'In-app notification centre. Every push notification also lands here, so
   a missed or suppressed push is never lost.';
comment on column notifications.body is
  'Kept free of sensitive detail — this text can appear on a lock screen.';
create index if not exists notifications_user_created_idx
  on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications(user_id) where read_at is null and archived_at is null;

-- ---------------------------------------------------------------------
-- organisation_settings
-- ---------------------------------------------------------------------
create table if not exists organisation_settings (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null unique references organisations(id) on delete cascade,
  pay_period               pay_period_type not null default 'fortnightly',
  pay_period_anchor_date   date not null default current_date,
  clocking_mode            clocking_mode not null default 'any_device',
  geofence_radius_metres   integer check (geofence_radius_metres > 0),
  require_shift_ack        boolean not null default true,
  ack_reminder_hours       integer not null default 24 check (ack_reminder_hours > 0),
  auto_approve_open_shifts boolean not null default false,
  minimum_rest_hours       numeric(4,1) not null default 10 check (minimum_rest_hours >= 0),
  kiosk_pin_max_attempts   integer not null default 5 check (kiosk_pin_max_attempts > 0),
  kiosk_lockout_minutes    integer not null default 15 check (kiosk_lockout_minutes > 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id) on delete set null
);
comment on table organisation_settings is
  'Organisation-wide operational configuration. One row per organisation.';
comment on column organisation_settings.minimum_rest_hours is
  'Used to warn when a roster may breach minimum rest. Advisory only — it
   does not block, and it is not an award compliance determination.';
create trigger org_settings_set_updated_at before update on organisation_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- kiosk PIN storage  (hashed, never plaintext)
-- ---------------------------------------------------------------------
create table if not exists kiosk_credentials (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  pin_hash          text not null,
  failed_attempts   integer not null default 0,
  locked_until      timestamptz,
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table kiosk_credentials is
  'Kiosk PINs, stored as bcrypt hashes via pgcrypto — never plaintext, and
   never readable by the client. All verification happens server-side; this
   table has no SELECT policy for any role.';
create trigger kiosk_credentials_set_updated_at before update on kiosk_credentials
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- calendar_tokens  (private iCalendar subscription per staff member)
-- ---------------------------------------------------------------------
create table if not exists calendar_tokens (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  token           text not null unique,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
comment on table calendar_tokens is
  'Opaque token for a private iCalendar feed of one staff member''s roster.
   Revocable, and exposes nothing beyond that person''s own published shifts.';
create index if not exists calendar_tokens_user_idx on calendar_tokens(user_id);

-- =====================================================================
-- Enable and force RLS on every new table.
-- Policies are defined in 0003; a table with RLS enabled and no policy
-- denies everything, which is the correct default while that lands.
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
    'organisation_settings','kiosk_credentials','calendar_tokens'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
