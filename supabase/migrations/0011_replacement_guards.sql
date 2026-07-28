-- =====================================================================
-- StayFlow Staff — 0011 replacement request guards
--
-- shift_replacement_requests had policies for SELECT, staff INSERT and
-- manager write, but no staff UPDATE at all. Two consequences:
--
--   1. A staff member could not withdraw a request they no longer needed.
--      They would ask for cover, sort it out privately, and leave a stale
--      item sitting in the manager's queue with no way to retract it.
--   2. Nothing encoded the state machine, so a manager could walk a
--      settled replacement backwards — reopening an approved swap after
--      the roster had already been rebuilt around it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profile relationships missed by 0009
--
-- 0009 swept every `user_id` column, but this table names its columns
-- `requested_by` and `replacement_user_id`, so both were skipped and a
-- staff name could not be embedded — the same PGRST200 failure that
-- silently emptied the management roster before 0007.
-- ---------------------------------------------------------------------
alter table shift_replacement_requests
  drop constraint if exists shift_replacement_requests_profile_fk;
alter table shift_replacement_requests
  add constraint shift_replacement_requests_profile_fk
  foreign key (requested_by) references profiles(id) on delete cascade;

alter table shift_replacement_requests
  drop constraint if exists shift_replacement_requests_replacement_profile_fk;
alter table shift_replacement_requests
  add constraint shift_replacement_requests_replacement_profile_fk
  foreign key (replacement_user_id) references profiles(id) on delete set null;

-- open_shift_offers has the same shape.
alter table open_shift_offers
  drop constraint if exists open_shift_offers_offered_profile_fk;
alter table open_shift_offers
  add constraint open_shift_offers_offered_profile_fk
  foreign key (offered_to_user_id) references profiles(id) on delete cascade;

-- ---------------------------------------------------------------------
-- Staff may withdraw their own request, and nothing else
-- ---------------------------------------------------------------------
create policy replacement_withdraw_self on shift_replacement_requests
  for update to authenticated
  using (
    requested_by = active_uid()
    and status in ('requested', 'offered')
  )
  with check (
    requested_by = active_uid()
    and status in ('requested', 'offered', 'withdrawn')
  );

/**
 * Staff may only move their own request to `withdrawn`.
 *
 * The policy above cannot express "you may change the status column, but
 * only to this one value" — RLS filters rows, not columns — so the guard
 * carries that rule. Without it the withdraw policy would also permit a
 * staff member to nominate their own replacement or mark it approved.
 */
create or replace function guard_replacement_staff_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() or has_role_at_least('manager') then
    return new;
  end if;

  if auth.uid() = old.requested_by then
    -- Allow-list, matching the pattern used for profiles and timesheets:
    -- the new row must equal the old one with only `status` changed, and
    -- only to 'withdrawn'.
    if new.status <> 'withdrawn' then
      raise exception
        'You may only withdraw your own replacement request.';
    end if;

    if to_jsonb(new) is distinct from (
         to_jsonb(old)
         || jsonb_build_object(
              'status', to_jsonb(new) -> 'status',
              'updated_at', to_jsonb(new) -> 'updated_at')
       )
    then
      raise exception
        'You may only withdraw your own replacement request.';
    end if;
  end if;

  return new;
end;
$$;

create trigger replacement_guard_staff_update
  before update on shift_replacement_requests
  for each row execute function guard_replacement_staff_update();

-- ---------------------------------------------------------------------
-- The state machine, enforced in the database
-- ---------------------------------------------------------------------
/**
 * Legal transitions:
 *   requested -> offered | rejected | withdrawn
 *   offered   -> claimed | rejected | withdrawn
 *   claimed   -> approved | rejected | offered   (re-offer a claim)
 *   approved / rejected / withdrawn -> terminal
 *
 * Mirrors canTransition() in src/lib/replacements/eligibility.ts. Encoded
 * in both places deliberately: the application gives a useful message, the
 * database guarantees the invariant regardless of caller.
 */
create or replace function guard_replacement_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_service_context() or new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'requested' and new.status in ('offered','rejected','withdrawn'))
    or (old.status = 'offered'  and new.status in ('claimed','rejected','withdrawn'))
    or (old.status = 'claimed'  and new.status in ('approved','rejected','offered'))
  ) then
    raise exception
      'A replacement cannot move from % to %.', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger replacement_guard_transition
  before update on shift_replacement_requests
  for each row execute function guard_replacement_transition();

revoke execute on function guard_replacement_staff_update() from public, anon, authenticated;
revoke execute on function guard_replacement_transition()   from public, anon, authenticated;

comment on table shift_replacement_requests is
  'A staff request to be replaced on a shift. Status transitions are
   enforced by guard_replacement_transition; staff may only withdraw their
   own request, enforced by guard_replacement_staff_update.';
