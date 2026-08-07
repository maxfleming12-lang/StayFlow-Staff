-- =====================================================================
-- StayFlow Staff — 0017 throttle PIN guessing at the device
--
-- The hole this closes
-- --------------------
-- `verify_kiosk_pin` counts failures against a USER and locks that user
-- out. That protects the pick-your-name path, where the attacker has
-- already said who they are.
--
-- It protects nothing on the PIN-first path. `resolve_kiosk_user` is a
-- `stable sql` function: it either matches a hash or returns null, and a
-- miss costs the caller nothing at all — no counter, no record, no delay.
-- Nobody is targeted, so nobody's lockout ever applies.
--
-- So a six-digit space of 1,000,000 codes could be swept at whatever rate
-- the tablet could post. With twenty staff at a property, roughly one code
-- in fifty thousand hits, and the first hit clocks that person on with a
-- clean `failed_attempts` of zero — because nothing had been counting.
--
-- The fix is to count against the DEVICE, which is the only identity a
-- PIN-first attempt has. A tablet that produces a run of unrecognised
-- codes stops answering for a while.
--
-- Why the threshold is higher than a person's
-- -------------------------------------------
-- A shared tablet legitimately sees other people's mistakes all day, so
-- five would lock the front desk out over ordinary fumbling. Twenty
-- consecutive UNRECOGNISED codes is not fumbling — a real staff member's
-- wrong PIN is counted against them by `verify_kiosk_pin`, not here.
-- Any code that resolves clears the tally, so honest use never accumulates.
-- =====================================================================

alter table kiosk_sessions
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

comment on column kiosk_sessions.failed_attempts is
  'Consecutive unrecognised PINs entered at this device. Cleared by any code that resolves.';

alter table organisation_settings
  add column if not exists kiosk_device_max_attempts integer not null default 20
    check (kiosk_device_max_attempts > 0);

comment on column organisation_settings.kiosk_device_max_attempts is
  'Unrecognised PINs a kiosk device may produce before it is locked for kiosk_lockout_minutes.';

-- ---------------------------------------------------------------------
-- Counting a failure against the device
-- ---------------------------------------------------------------------
/**
 * Record one failed PIN attempt at a device, and lock it if that was the
 * last straw. Returns 'locked' or 'open'.
 *
 * Separate from the resolve below so the caller can also count a WRONG pin
 * on the pick-your-name path — otherwise an attacker who knows one user id
 * gets an unthrottled oracle for that user, bounded only by a per-user
 * lockout they can wait out.
 */
create or replace function kiosk_device_fail(p_session uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sess      kiosk_sessions%rowtype;
  max_tries integer;
  lock_mins integer;
begin
  select * into sess from kiosk_sessions where id = p_session;
  if not found then
    return 'open';
  end if;

  select coalesce(o.kiosk_device_max_attempts, 20),
         coalesce(o.kiosk_lockout_minutes, 15)
    into max_tries, lock_mins
  from organisation_settings o
  where o.organisation_id = sess.organisation_id;

  max_tries := coalesce(max_tries, 20);
  lock_mins := coalesce(lock_mins, 15);

  update kiosk_sessions
     set failed_attempts = failed_attempts + 1,
         locked_until = case
           when failed_attempts + 1 >= max_tries
             then now() + make_interval(mins => lock_mins)
           else locked_until
         end,
         updated_at = now()
   where id = p_session;

  select * into sess from kiosk_sessions where id = p_session;
  if sess.locked_until is not null and sess.locked_until > now() then
    return 'locked';
  end if;

  return 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- Resolving a PIN, with the device on the hook
-- ---------------------------------------------------------------------
/**
 * Resolve a six-digit code to a staff member at this device's property,
 * counting misses against the device.
 *
 * Replaces `resolve_kiosk_user`, which took the property from the caller
 * and could not write. The property now comes from the SESSION ROW, so a
 * caller cannot ask about a property the tablet is not authorised for.
 *
 * Statuses: 'ok' with a user, 'unknown', 'locked', 'no_device'.
 */
create or replace function resolve_kiosk_pin(p_session uuid, p_pin text)
returns table (status text, resolved_user uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sess kiosk_sessions%rowtype;
  hit  uuid;
begin
  select * into sess from kiosk_sessions where id = p_session;

  -- A revoked or expired tablet is answered the same as an unknown one.
  -- The application checks this too; repeated here because this function
  -- reads PIN hashes and must not depend on the caller having looked.
  if not found
     or sess.revoked_at is not null
     or sess.expires_at <= now() then
    return query select 'no_device'::text, null::uuid;
    return;
  end if;

  if sess.locked_until is not null and sess.locked_until > now() then
    return query select 'locked'::text, null::uuid;
    return;
  end if;

  select p.id into hit
  from profiles p
  join user_property_access a
    on a.user_id = p.id
   and a.property_id = sess.property_id
  join kiosk_credentials k on k.user_id = p.id
  where p.is_active = true
    and p.archived_at is null
    and p_pin ~ '^[0-9]{6}$'
    and k.pin_hash = crypt(p_pin, k.pin_hash)
  limit 1;

  if hit is null then
    if kiosk_device_fail(p_session) = 'locked' then
      return query select 'locked'::text, null::uuid;
    else
      return query select 'unknown'::text, null::uuid;
    end if;
    return;
  end if;

  -- A code that resolved. The run is broken, so the tally goes.
  if sess.failed_attempts > 0 or sess.locked_until is not null then
    update kiosk_sessions
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where id = p_session;
  end if;

  return query select 'ok'::text, hit;
end;
$$;

-- These read PIN hashes and move a lockout. Only trusted server-side code
-- may call them; a client holding either could brute-force a PIN or clear
-- the counter that stops it.
revoke execute on function kiosk_device_fail(uuid) from public, anon, authenticated;
revoke execute on function resolve_kiosk_pin(uuid, text) from public, anon, authenticated;
grant execute on function kiosk_device_fail(uuid) to service_role;
grant execute on function resolve_kiosk_pin(uuid, text) to service_role;

comment on function resolve_kiosk_pin(uuid, text) is
  'Resolves a six-digit kiosk PIN to a staff member at the device''s own
   property, counting unrecognised codes against the device so the PIN
   space cannot be swept. Supersedes resolve_kiosk_user.';

-- `resolve_kiosk_user` is left in place but taken away from everybody.
-- Dropping it outright would break a deployment still running the previous
-- application build for the minute or two between migrate and deploy;
-- revoking makes any such call fail loudly instead of silently offering an
-- unthrottled oracle.
revoke execute on function resolve_kiosk_user(uuid, text)
  from public, anon, authenticated, service_role;

comment on function resolve_kiosk_user(uuid, text) is
  'SUPERSEDED by resolve_kiosk_pin. Unthrottled: a miss cost the caller
   nothing, so the PIN space could be swept. Execute has been revoked from
   every role. Drop once no deployment calls it.';
