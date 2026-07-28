-- =====================================================================
-- StayFlow Staff — development seed data
--
--   ############################################################
--   #  DEVELOPMENT ONLY.  DO NOT RUN AGAINST PRODUCTION.       #
--   #  Every account below uses a shared, publicly known        #
--   #  password and is marked with is_demo_account = true.      #
--   ############################################################
--
-- Applied automatically by `supabase db reset` on a local stack.
-- Production owners are created by the procedure in README.md instead.
-- =====================================================================

-- A column that makes demo accounts trivially identifiable, so a
-- production safety check can refuse to run while any exist.
alter table profiles add column if not exists is_demo_account boolean not null default false;
comment on column profiles.is_demo_account is
  'True only for seeded development accounts. Production data must never
   have this set — deployment checks look for it.';

do $$
declare
  org_id       uuid := '00000000-0000-4000-8000-000000000001';
  coastal_id   uuid := '00000000-0000-4000-8000-000000000010';
  lodge_id     uuid := '00000000-0000-4000-8000-000000000011';
  team_mgmt    uuid := '00000000-0000-4000-8000-000000000020';
  team_house   uuid := '00000000-0000-4000-8000-000000000021';
  team_maint   uuid := '00000000-0000-4000-8000-000000000022';

  -- Shared demo password for every seeded account: StayFlowDemo!2026
  demo_password text := 'StayFlowDemo!2026';

  u_owner      uuid := '00000000-0000-4000-8000-000000000100';
  u_manager    uuid := '00000000-0000-4000-8000-000000000101';
  u_supervisor uuid := '00000000-0000-4000-8000-000000000102';
  u_staff1     uuid := '00000000-0000-4000-8000-000000000103';
  u_staff2     uuid := '00000000-0000-4000-8000-000000000104';
  u_staff3     uuid := '00000000-0000-4000-8000-000000000105';
  u_staff4     uuid := '00000000-0000-4000-8000-000000000106';

  seed_users   jsonb;
  entry        jsonb;
begin
  -- -------------------------------------------------------------
  -- Organisation, properties, teams
  -- -------------------------------------------------------------
  insert into organisations (id, name, legal_name, timezone)
  values (org_id, 'StayFlow Demo Motels', 'StayFlow Demo Motels Pty Ltd', 'Australia/Sydney')
  on conflict (id) do nothing;

  insert into properties (id, organisation_id, name, short_code, address, colour)
  values
    (coastal_id, org_id, 'Coastal Comfort Motel', 'CCM',
     '123 Princes Highway, Narooma NSW 2546', '#0e7490'),
    (lodge_id, org_id, 'Holiday Lodge', 'HL',
     '45 Beach Road, Narooma NSW 2546', '#b45309')
  on conflict (id) do nothing;

  insert into teams (id, organisation_id, property_id, name, description)
  values
    (team_mgmt,  org_id, null,       'Management',   'Owners, administrators and duty managers.'),
    (team_house, org_id, coastal_id, 'Housekeeping', 'Room servicing, linen and laundry.'),
    (team_maint, org_id, null,       'Maintenance',  'Repairs, grounds and safety checks.')
  on conflict (id) do nothing;

  insert into organisation_settings (organisation_id, pay_period, clocking_mode)
  values (org_id, 'fortnightly', 'any_device')
  on conflict (organisation_id) do nothing;

  -- -------------------------------------------------------------
  -- Accounts
  --
  -- auth.users is written directly because there is no Auth API call
  -- available from a SQL seed. crypt() with gen_salt('bf') produces the
  -- same bcrypt hash format GoTrue expects.
  -- -------------------------------------------------------------
  seed_users := jsonb_build_array(
    jsonb_build_object('id', u_owner,      'email', 'owner@stayflow.test',
      'first', 'Maxwell', 'last', 'Fleming',  'preferred', 'Max',
      'role', 'owner',         'team', team_mgmt,  'title', 'Owner'),
    jsonb_build_object('id', u_manager,    'email', 'manager@stayflow.test',
      'first', 'Priya',   'last', 'Sharma',   'preferred', 'Priya',
      'role', 'manager',       'team', team_mgmt,  'title', 'Duty Manager'),
    jsonb_build_object('id', u_supervisor, 'email', 'supervisor@stayflow.test',
      'first', 'Daniel',  'last', 'Okafor',   'preferred', 'Dan',
      'role', 'supervisor',    'team', team_house, 'title', 'Housekeeping Supervisor'),
    jsonb_build_object('id', u_staff1,     'email', 'staff1@stayflow.test',
      'first', 'Aroha',   'last', 'Wilson',   'preferred', 'Aroha',
      'role', 'staff',         'team', team_house, 'title', 'Room Attendant'),
    jsonb_build_object('id', u_staff2,     'email', 'staff2@stayflow.test',
      'first', 'Liam',    'last', 'Nguyen',   'preferred', 'Liam',
      'role', 'staff',         'team', team_house, 'title', 'Room Attendant'),
    jsonb_build_object('id', u_staff3,     'email', 'staff3@stayflow.test',
      'first', 'Sofia',   'last', 'Rossi',    'preferred', 'Sofia',
      'role', 'staff',         'team', team_maint, 'title', 'Maintenance Officer'),
    jsonb_build_object('id', u_staff4,     'email', 'staff4@stayflow.test',
      'first', 'Jack',    'last', 'Thompson', 'preferred', 'Jacko',
      'role', 'staff',         'team', team_maint, 'title', 'Groundskeeper')
  );

  for entry in select * from jsonb_array_elements(seed_users)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      -- GoTrue scans these into non-nullable strings. Leaving them NULL
      -- makes every sign-in fail with "Database error querying schema",
      -- which is the price of inserting into auth.users directly.
      confirmation_token, recovery_token,
      email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token,
      reauthentication_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      (entry->>'id')::uuid, 'authenticated', 'authenticated', entry->>'email',
      crypt(demo_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(),
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do nothing;

    -- GoTrue requires a matching identity row for email sign-in.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(), (entry->>'id')::uuid,
      jsonb_build_object('sub', entry->>'id', 'email', entry->>'email'),
      'email', entry->>'email', now(), now(), now()
    )
    on conflict do nothing;

    insert into profiles (
      id, organisation_id, preferred_name, legal_first_name, legal_last_name,
      email, mobile_number, job_title, primary_property_id, team_id,
      is_active, is_demo_account
    )
    values (
      (entry->>'id')::uuid, org_id, entry->>'preferred',
      entry->>'first', entry->>'last', entry->>'email',
      '0400 000 000', entry->>'title', coastal_id,
      (entry->>'team')::uuid, true, true
    )
    on conflict (id) do nothing;

    insert into user_roles (organisation_id, user_id, role)
    values (org_id, (entry->>'id')::uuid, (entry->>'role')::app_role)
    on conflict (user_id, role) do nothing;
  end loop;

  -- -------------------------------------------------------------
  -- Property access
  --
  -- The owner and manager cover both motels. The supervisor and staff
  -- are split across properties so that cross-property RLS boundaries
  -- are actually exercised by the test suite.
  -- -------------------------------------------------------------
  insert into user_property_access (organisation_id, user_id, property_id)
  values
    (org_id, u_owner,      coastal_id),
    (org_id, u_owner,      lodge_id),
    (org_id, u_manager,    coastal_id),
    (org_id, u_manager,    lodge_id),
    (org_id, u_supervisor, coastal_id),
    (org_id, u_staff1,     coastal_id),
    (org_id, u_staff2,     coastal_id),
    -- Sofia and Jack work only at Holiday Lodge.
    (org_id, u_staff3,     lodge_id),
    (org_id, u_staff4,     lodge_id)
  on conflict (user_id, property_id) do nothing;

  -- -------------------------------------------------------------
  -- Employment records (confidential — used to prove supervisors
  -- cannot read pay rates)
  -- -------------------------------------------------------------
  insert into employment_details (
    organisation_id, user_id, status, employment_type, start_date,
    job_title, hourly_rate, standard_weekly_hours, payroll_reference
  )
  values
    (org_id, u_owner,      'active', 'full_time', date '2019-03-04', 'Owner',                   0.00, 38, 'EMP-0001'),
    (org_id, u_manager,    'active', 'full_time', date '2021-07-12', 'Duty Manager',           42.50, 38, 'EMP-0002'),
    (org_id, u_supervisor, 'active', 'part_time', date '2023-01-16', 'Housekeeping Supervisor', 34.20, 24, 'EMP-0003'),
    (org_id, u_staff1,     'active', 'casual',    date '2024-09-02', 'Room Attendant',          31.80, 20, 'EMP-0004'),
    (org_id, u_staff2,     'active', 'casual',    date '2025-02-10', 'Room Attendant',          31.80, 16, 'EMP-0005'),
    (org_id, u_staff3,     'active', 'part_time', date '2022-11-21', 'Maintenance Officer',     36.90, 30, 'EMP-0006'),
    (org_id, u_staff4,     'active', 'casual',    date '2025-06-30', 'Groundskeeper',           30.40, 12, 'EMP-0007')
  on conflict (user_id) do nothing;

  insert into emergency_contacts (organisation_id, user_id, full_name, relationship, phone)
  values
    (org_id, u_staff1, 'Hine Wilson',    'Sister',  '0400 111 222'),
    (org_id, u_staff3, 'Marco Rossi',    'Partner', '0400 333 444')
  on conflict do nothing;

  raise notice 'Seeded % demo accounts. Password for all: %',
    jsonb_array_length(seed_users), demo_password;
end $$;
