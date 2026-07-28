-- =====================================================================
-- StayFlow Staff — 0013 kiosk sessions and PIN verification
--
-- A kiosk is a shared tablet at the front desk. It cannot be signed in as
-- a staff member: whoever picked it up would hold that person's whole
-- account. So a manager authorises the DEVICE once, and staff then
-- identify themselves with a PIN for the single purpose of clocking.
--
-- Two things are deliberately kept inside the database:
--
--   * The PIN hash never leaves Postgres. Verification happens in a
--     SECURITY DEFINER function, so no application code ever holds a
--     hash — not even briefly, not even in a variable it forgets to clear.
--   * Lockout is counted server-side in the same function, so a client
--     cannot reset its own attempt counter by reloading.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Device sessions
-- ---------------------------------------------------------------------
create table kiosk_sessions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  /** Random secret held by the tablet in an httpOnly cookie. */
  token           text not null unique,
  /** Human label so a manager can tell two tablets apart when revoking. */
  device_label    text,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  /**
   * Kiosk sessions expire. A tablet left authorised indefinitely is a
   * standing credential nobody remembers granting.
   */
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  updated_at      timestamptz not null default now()
);

create index kiosk_sessions_org_idx on kiosk_sessions(organisation_id);
create index kiosk_sessions_property_idx on kiosk_sessions(property_id);

alter table kiosk_sessions enable row level security;
alter table kiosk_sessions force row level security;

-- Managers may see and revoke the tablets at their own properties. The
-- token column is deliberately NOT excluded here — RLS cannot hide a
-- column — so the application must never select it for a client. Reading
-- it back is not useful anyway: it is shown once, when created.
create policy kiosk_sessions_manage on kiosk_sessions
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

revoke all on kiosk_sessions from anon;
grant select, insert, update, delete on kiosk_sessions to authenticated;
grant select, insert, update, delete on kiosk_sessions to service_role;
revoke truncate, trigger, references on kiosk_sessions from anon, authenticated;

create trigger kiosk_sessions_set_updated_at
  before update on kiosk_sessions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Setting a PIN
-- ---------------------------------------------------------------------
/**
 * Store a PIN as a bcrypt hash.
 *
 * Takes the PIN as plaintext and hashes it here, so the caller never
 * constructs or stores a hash itself. Resets any lockout, because setting
 * a new PIN is exactly what a locked-out person needs.
 */
create or replace function set_kiosk_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4,10}$' then
    raise exception 'A PIN must be 4 to 10 digits.';
  end if;

  insert into kiosk_credentials (organisation_id, user_id, pin_hash,
                                 failed_attempts, locked_until)
  select p.organisation_id, p.id, crypt(p_pin, gen_salt('bf')), 0, null
  from profiles p
  where p.id = p_user
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Verifying a PIN
-- ---------------------------------------------------------------------
/**
 * Check a PIN, counting failures and enforcing lockout.
 *
 * Returns a short status rather than a bare boolean so the caller can tell
 * "wrong PIN" from "locked out" without inspecting the table — the caller
 * has no access to it.
 *
 * The attempt counter and lockout window live here rather than in the
 * application because a client that could reset them could brute-force a
 * four-digit PIN in minutes.
 */
create or replace function verify_kiosk_pin(p_user uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cred        kiosk_credentials%rowtype;
  max_tries   integer;
  lock_mins   integer;
begin
  select * into cred from kiosk_credentials where user_id = p_user;

  -- No PIN set. Reported as such rather than as a wrong PIN, because the
  -- remedy is different: a manager must set one.
  if not found then
    return 'no_pin';
  end if;

  if cred.locked_until is not null and cred.locked_until > now() then
    return 'locked';
  end if;

  select coalesce(kiosk_pin_max_attempts, 5), coalesce(kiosk_lockout_minutes, 15)
    into max_tries, lock_mins
  from organisation_settings
  where organisation_id = cred.organisation_id;

  max_tries := coalesce(max_tries, 5);
  lock_mins := coalesce(lock_mins, 15);

  if cred.pin_hash = crypt(p_pin, cred.pin_hash) then
    update kiosk_credentials
       set failed_attempts = 0,
           locked_until = null,
           last_used_at = now(),
           updated_at = now()
     where user_id = p_user;
    return 'ok';
  end if;

  update kiosk_credentials
     set failed_attempts = failed_attempts + 1,
         locked_until = case
           when failed_attempts + 1 >= max_tries
             then now() + make_interval(mins => lock_mins)
           else locked_until
         end,
         updated_at = now()
   where user_id = p_user;

  -- Re-read so the caller is told about a lockout it just triggered.
  select * into cred from kiosk_credentials where user_id = p_user;
  if cred.locked_until is not null and cred.locked_until > now() then
    return 'locked';
  end if;

  return 'wrong';
end;
$$;

-- These handle PINs. Only trusted server-side code may call them; a client
-- holding either could set or brute-force somebody else's PIN.
revoke execute on function set_kiosk_pin(uuid, text) from public, anon, authenticated;
revoke execute on function verify_kiosk_pin(uuid, text) from public, anon, authenticated;
grant execute on function set_kiosk_pin(uuid, text) to service_role;
grant execute on function verify_kiosk_pin(uuid, text) to service_role;

comment on function verify_kiosk_pin(uuid, text) is
  'Verifies a kiosk PIN and enforces lockout entirely inside the database,
   so no application code ever holds a PIN hash and no client can reset its
   own attempt counter.';
