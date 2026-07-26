-- =====================================================================
-- StayFlow Staff — 0001 identity and access
--
-- Establishes the organisation/property/profile/role core that
-- authentication and role-based navigation depend on, with Row Level
-- Security enabled and enforced from the very first migration.
--
-- The operational tables (rosters, shifts, timesheets, leave, tasks,
-- documents, notifications, push subscriptions) follow in migration 0002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum
    ('staff', 'supervisor', 'manager', 'administrator', 'owner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_status as enum
    ('active', 'on_leave', 'suspended', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_type as enum
    ('full_time', 'part_time', 'casual', 'contractor');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Trigger function that stamps updated_at on every UPDATE.';

-- ---------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------
create table if not exists organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  legal_name   text,
  timezone     text not null default 'Australia/Sydney',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);

comment on table organisations is
  'Top-level tenant. Every operational record carries an organisation_id.';

create trigger organisations_set_updated_at
  before update on organisations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------
create table if not exists properties (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  short_code       text not null,
  address          text,
  timezone         text not null default 'Australia/Sydney',
  colour           text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  archived_at      timestamptz,
  unique (organisation_id, short_code)
);

comment on table properties is
  'A physical site, e.g. Coastal Comfort Motel. More may be added at any time.';
comment on column properties.colour is
  'Hex colour used to visually distinguish this property on the roster.';

create index if not exists properties_org_idx on properties(organisation_id);

create trigger properties_set_updated_at
  before update on properties
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  organisation_id      uuid not null references organisations(id) on delete cascade,
  preferred_name       text,
  legal_first_name     text not null default '',
  legal_last_name      text not null default '',
  email                text not null,
  mobile_number        text,
  job_title            text,
  primary_property_id  uuid references properties(id) on delete set null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) on delete set null,
  archived_at          timestamptz
);

comment on table profiles is
  'Staff profile, keyed to the Supabase auth user. Confidential employment
   detail (pay rate, payroll reference) lives in employment_details so that
   it can carry stricter policies.';
comment on column profiles.is_active is
  'Cleared to revoke access immediately without deleting history.';

create index if not exists profiles_org_idx on profiles(organisation_id);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------
create table if not exists user_roles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             app_role not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  unique (user_id, role)
);

comment on table user_roles is
  'Roles held by a user. Stored separately from profiles so that a role
   change is an explicit, auditable INSERT/DELETE rather than a column edit.';

create index if not exists user_roles_user_idx on user_roles(user_id);

-- ---------------------------------------------------------------------
-- user_property_access
-- ---------------------------------------------------------------------
create table if not exists user_property_access (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  property_id      uuid not null references properties(id) on delete cascade,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  unique (user_id, property_id)
);

comment on table user_property_access is
  'Which properties a user may work at or manage. Owners and administrators
   reach every property regardless of rows here.';

create index if not exists upa_user_idx on user_property_access(user_id);
create index if not exists upa_property_idx on user_property_access(property_id);

-- ---------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  property_id      uuid references properties(id) on delete set null,
  actor_id         uuid references auth.users(id) on delete set null,
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  before_value     jsonb,
  after_value      jsonb,
  created_at       timestamptz not null default now()
);

comment on table audit_logs is
  'Append-only record of significant events. No UPDATE or DELETE policy
   exists, so rows cannot be altered or removed through the client API.';

create index if not exists audit_logs_org_created_idx
  on audit_logs(organisation_id, created_at desc);

-- =====================================================================
-- Authorisation helper functions
--
-- These are SECURITY DEFINER and therefore run with the definer's rights,
-- bypassing RLS on the tables they read. That is essential: a policy on
-- user_roles that itself queried user_roles would recurse infinitely.
--
-- search_path is pinned to prevent search-path hijacking.
-- =====================================================================

create or replace function current_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id
  from profiles
  where id = auth.uid()
    and is_active
    and archived_at is null;
$$;

comment on function current_organisation_id() is
  'Organisation of the calling user, or NULL when they are inactive,
   archived or have no profile.';

create or replace function has_role_at_least(minimum app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from user_roles ur
    join profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and p.is_active
      and p.archived_at is null
      and case ur.role
            when 'staff'         then 10
            when 'supervisor'    then 20
            when 'manager'       then 30
            when 'administrator' then 40
            when 'owner'         then 50
          end
          >=
          case minimum
            when 'staff'         then 10
            when 'supervisor'    then 20
            when 'manager'       then 30
            when 'administrator' then 40
            when 'owner'         then 50
          end
  );
$$;

comment on function has_role_at_least(app_role) is
  'True when the caller holds a role at or above the given rank. Deactivated
   and archived users always return false, so disabling an account revokes
   access immediately.';

create or replace function can_access_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Administrators and owners reach every property in their organisation.
    (
      has_role_at_least('administrator')
      and exists (
        select 1 from properties pr
        where pr.id = target_property_id
          and pr.organisation_id = current_organisation_id()
      )
    )
    or
    -- Everyone else needs an explicit grant.
    exists (
      select 1
      from user_property_access upa
      join profiles p on p.id = upa.user_id
      where upa.user_id = auth.uid()
        and upa.property_id = target_property_id
        and p.is_active
        and p.archived_at is null
    );
$$;

comment on function can_access_property(uuid) is
  'True when the caller may access the given property, whether by
   organisation-wide role or by explicit grant.';

-- =====================================================================
-- Row Level Security
--
-- Enabled on every table. FORCE additionally applies policies to the
-- table owner, so a mistake elsewhere cannot quietly bypass them.
-- =====================================================================

alter table organisations        enable row level security;
alter table properties           enable row level security;
alter table profiles             enable row level security;
alter table user_roles           enable row level security;
alter table user_property_access enable row level security;
alter table audit_logs           enable row level security;

alter table organisations        force row level security;
alter table properties           force row level security;
alter table profiles             force row level security;
alter table user_roles           force row level security;
alter table user_property_access force row level security;
alter table audit_logs           force row level security;

-- --- organisations ---------------------------------------------------
create policy organisations_select_own on organisations
  for select to authenticated
  using (id = current_organisation_id());

create policy organisations_update_admin on organisations
  for update to authenticated
  using (id = current_organisation_id() and has_role_at_least('administrator'))
  with check (id = current_organisation_id() and has_role_at_least('administrator'));

-- --- properties ------------------------------------------------------
-- Staff see the properties they are assigned to; management sees all of
-- the organisation's properties.
create policy properties_select on properties
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and (has_role_at_least('manager') or can_access_property(id))
  );

create policy properties_write_admin on properties
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  );

-- --- profiles --------------------------------------------------------
-- A user always sees their own profile. Supervisors and above see
-- colleagues in the same organisation; confidential employment data is
-- deliberately not in this table.
create policy profiles_select_self on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_colleagues on profiles
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('supervisor')
  );

-- Staff may maintain their own contact details. organisation_id, is_active
-- and primary_property_id are protected by the trigger below, so a staff
-- member cannot move themselves between organisations or reactivate a
-- disabled account.
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on profiles
  for update to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  );

create policy profiles_insert_admin on profiles
  for insert to authenticated
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  );

/**
 * Prevent privilege-relevant self-edits.
 *
 * RLS decides *which rows* a user may update, not which columns. Without
 * this trigger, the profiles_update_self policy would let a staff member
 * flip their own is_active flag or change organisation.
 */
create or replace function guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and not has_role_at_least('administrator') then
    if new.organisation_id     is distinct from old.organisation_id
       or new.is_active        is distinct from old.is_active
       or new.archived_at      is distinct from old.archived_at
       or new.primary_property_id is distinct from old.primary_property_id
    then
      raise exception
        'You may not change your own organisation, status or primary property.';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function guard_profile_self_update();

-- --- user_roles ------------------------------------------------------
create policy user_roles_select_self on user_roles
  for select to authenticated
  using (user_id = auth.uid());

create policy user_roles_select_management on user_roles
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
  );

/**
 * Only administrators and owners may grant or revoke roles, and the
 * function below additionally prevents privilege escalation: an
 * administrator cannot mint an owner, and nobody may edit their own roles.
 */
create or replace function guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
  target_role app_role := coalesce(new.role, old.role);
begin
  if target_user = auth.uid() then
    raise exception 'You may not change your own roles.';
  end if;

  if target_role = 'owner' and not has_role_at_least('owner') then
    raise exception 'Only an owner may grant or revoke the owner role.';
  end if;

  -- The organisation owner cannot be stripped of the role by an
  -- administrator, satisfying "cannot remove the organisation owner".
  if tg_op = 'DELETE'
     and old.role = 'owner'
     and not has_role_at_least('owner') then
    raise exception 'Administrators may not remove the organisation owner.';
  end if;

  return coalesce(new, old);
end;
$$;

create policy user_roles_write_admin on user_roles
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  );

create trigger user_roles_guard
  before insert or update or delete on user_roles
  for each row execute function guard_role_change();

-- --- user_property_access -------------------------------------------
create policy upa_select_self on user_property_access
  for select to authenticated
  using (user_id = auth.uid());

create policy upa_select_management on user_property_access
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('manager')
  );

create policy upa_write_admin on user_property_access
  for all to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  )
  with check (
    organisation_id = current_organisation_id()
    and has_role_at_least('administrator')
  );

-- --- audit_logs ------------------------------------------------------
-- Readable by owners only. No INSERT policy: entries are written by
-- SECURITY DEFINER triggers and server-side service-role code, never
-- directly by a browser. No UPDATE/DELETE policy at all, which makes the
-- table append-only through the client API.
create policy audit_logs_select_owner on audit_logs
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and has_role_at_least('owner')
  );

-- =====================================================================
-- Grants
--
-- `anon` gets nothing: an unauthenticated visitor has no reason to read
-- any application table.
-- =====================================================================
revoke all on all tables in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  organisations, properties, profiles, user_roles, user_property_access
  to authenticated;
grant select on audit_logs to authenticated;
