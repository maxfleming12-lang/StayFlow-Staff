-- Resolve a six-digit kiosk code without displaying a staff list.
--
-- The bcrypt hashes stay inside Postgres. Only the service role may call
-- this function, and the result is limited to active staff assigned to the
-- kiosk's property.
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

  if exists (
    select 1
    from kiosk_credentials k
    join user_property_access existing_access
      on existing_access.user_id = k.user_id
    join user_property_access target_access
      on target_access.user_id = p_user
     and target_access.property_id = existing_access.property_id
    where k.user_id <> p_user
      and k.pin_hash = crypt(p_pin, k.pin_hash)
  ) then
    raise exception 'That code is already used by staff at this property.';
  end if;

  insert into kiosk_credentials (
    organisation_id, user_id, pin_hash, failed_attempts, locked_until
  )
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

create or replace function resolve_kiosk_user(p_property uuid, p_pin text)
returns uuid
language sql
security definer
set search_path = public, extensions
stable
as $$
  select p.id
  from profiles p
  join user_property_access a
    on a.user_id = p.id
   and a.property_id = p_property
  join kiosk_credentials k on k.user_id = p.id
  where p.is_active = true
    and p.archived_at is null
    and p_pin ~ '^[0-9]{6}$'
    and k.pin_hash = crypt(p_pin, k.pin_hash)
  limit 1;
$$;

revoke execute on function resolve_kiosk_user(uuid, text)
  from public, anon, authenticated;
grant execute on function resolve_kiosk_user(uuid, text) to service_role;

comment on function resolve_kiosk_user(uuid, text) is
  'Resolves an active property staff member from a six-digit kiosk PIN while keeping bcrypt hashes inside Postgres.';
