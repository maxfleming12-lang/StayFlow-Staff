-- =====================================================================
-- StayFlow Staff — 0012 offer visibility
--
-- A manager could offer a shift for cover and NOBODY could see it.
--
-- open_offers_select gated its "offered to everyone" branch on:
--
--     exists (select 1 from shifts s
--             where s.id = open_shift_offers.shift_id
--               and can_access_property(s.property_id))
--
-- A subquery inside a policy is evaluated with the CALLER's row-level
-- security applied. A shift being handed over still belongs to the person
-- giving it away, so a colleague cannot read it — the EXISTS returned
-- false and the offer vanished. Confirmed: with an offer sitting in the
-- table, a staff member at the right property saw 0 offers and 0 shifts.
--
-- Fixing it needs care in both directions. Letting the shifts policy
-- consult open_shift_offers while the offers policy consults shifts would
-- be mutually recursive. Both sides therefore go through SECURITY DEFINER
-- helpers, which bypass RLS and cannot recurse.
-- =====================================================================

/**
 * The property a shift belongs to, ignoring RLS.
 *
 * Discloses nothing on its own: the caller must already hold the shift's
 * id, and the answer is only ever fed back into can_access_property().
 */
create or replace function shift_property_of(p_shift uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select property_id from shifts where id = p_shift;
$$;

/**
 * Does an open, unclaimed offer exist for this shift that this user may act
 * on — either directed at them personally, or open to everyone?
 */
create or replace function has_visible_offer(p_shift uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from open_shift_offers o
    where o.shift_id = p_shift
      and o.status in ('offered', 'claimed')
      and (o.offered_to_user_id = p_user or o.offered_to_user_id is null)
  );
$$;

-- ---------------------------------------------------------------------
-- Offers: resolve the property without reading the shifts table
-- ---------------------------------------------------------------------
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
        and can_access_property(shift_property_of(shift_id))
      )
      or has_role_at_least('manager')
    )
  );

drop policy if exists open_offers_update_claim on open_shift_offers;
create policy open_offers_update_claim on open_shift_offers
  for update to authenticated
  using (
    organisation_id = current_organisation_id()
    and status = 'offered'
    and (
      offered_to_user_id = active_uid()
      or (
        offered_to_user_id is null
        and can_access_property(shift_property_of(shift_id))
      )
    )
  )
  with check (
    organisation_id = current_organisation_id()
    and claimed_by = active_uid()
    and can_access_property(shift_property_of(shift_id))
  );

-- ---------------------------------------------------------------------
-- Shifts: readable when you hold an offer for them
--
-- Without this the offer is visible but the shift behind it is not, so the
-- screen can show that *something* needs cover while being unable to say
-- when, where, or for how long.
--
-- Scoped deliberately: only while an offer is live, and only for a shift
-- at a property the caller may work at. Once the offer is settled the
-- shift becomes invisible again unless it is now theirs.
-- ---------------------------------------------------------------------
create policy shifts_select_offered on shifts
  for select to authenticated
  using (
    organisation_id = current_organisation_id()
    and status = 'published'
    and can_access_property(property_id)
    and has_visible_offer(id, active_uid())
  );

-- Both are called from inside policy expressions, which are evaluated with
-- the INVOKING user's privileges — so `authenticated` must keep EXECUTE or
-- every policy using them raises "permission denied" instead of filtering.
-- Revoking from `public` alone would strip it, since authenticated inherits
-- from PUBLIC, so the grant is re-issued explicitly. Both are read-only and
-- disclose nothing the caller does not already hold an id for.
revoke execute on function shift_property_of(uuid) from public, anon;
revoke execute on function has_visible_offer(uuid, uuid) from public, anon;
grant execute on function shift_property_of(uuid) to authenticated;
grant execute on function has_visible_offer(uuid, uuid) to authenticated;

comment on function shift_property_of(uuid) is
  'SECURITY DEFINER lookup used inside RLS policies. A policy subquery is
   evaluated with the caller''s own RLS applied, so reading shifts directly
   from an offers policy hides offers for shifts the caller cannot see.';
