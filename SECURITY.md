# Security

How StayFlow Staff protects staff data, and the evidence that it does.

---

## Threat model

StayFlow Staff holds pay rates, home contact details, emergency next-of-kin
records and attendance history for a small motel workforce. The realistic
threats are not sophisticated attackers — they are:

1. A curious staff member reading a colleague's pay rate.
2. A departed or dismissed staff member whose access was not revoked.
3. A shared kiosk tablet showing one person's roster to the next person.
4. A staff member editing their own recorded hours.
5. A supervisor seeing employment records they have no business seeing.

The design targets these directly, and the test suite asserts each one.

---

## Enforcement layers

Authorisation is enforced in three layers, and **only the innermost is
trusted**:

| Layer | Mechanism | Trust |
| --- | --- | --- |
| Navigation | `navItemsFor(role)` hides sections | None — cosmetic |
| Request | `src/proxy.ts` refreshes the session, redirects anonymous users | None — optimistic |
| Server + database | `requireUser()` / `requireRole()` in Server Components, plus Postgres RLS | **Authoritative** |

The Next.js documentation is explicit that proxy (formerly middleware) must
not be used as a full authorisation solution, so it is used only to keep the
session fresh and to save an obvious round trip.

Every one of the 36 application tables has RLS both **enabled** and
**forced**. `FORCE` matters: without it, policies are skipped for the table
owner, so a single mistake in a server-side connection could silently bypass
everything.

---

## Key decisions

### Deactivation must revoke access instantly, not at token expiry

This was a real bug, caught by the test suite rather than by review.

The original self-scoped policies read:

```sql
using (user_id = auth.uid())
```

That predicate never consults the profile's status. A staff member disabled
thirty seconds ago still holds a valid JWT for up to an hour, so they could
keep reading their own roster, timesheets and employment record directly from
the REST API — even though the user interface correctly locked them out.

The fix is a helper that returns the caller's id **only while active**:

```sql
create or replace function active_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.id = auth.uid() and p.is_active and p.archived_at is null;
$$;
```

Every policy now compares against `active_uid()`. For a disabled user the
function returns NULL, `user_id = NULL` evaluates to NULL, and the row is
filtered out. Failure is closed by construction rather than by remembering to
add a check.

Trigger functions deliberately still use `auth.uid()`, because they ask a
different question ("who is acting?", not "may they still act?").

### RLS helpers must be SECURITY DEFINER

`current_organisation_id()`, `has_role_at_least()`, `can_access_property()`,
`manages_user()` and `active_uid()` are all `SECURITY DEFINER` with a pinned
`search_path = public`.

This is required, not stylistic: a policy on `user_roles` that itself queried
`user_roles` would recurse infinitely. Pinning `search_path` prevents
search-path hijacking, which is the standard attack against a definer
function.

### RLS filters rows; triggers guard columns

RLS decides *which rows* a statement may touch — it cannot say "you may
update this row but not that column". Trigger guards cover the gap:

| Guard | Prevents |
| --- | --- |
| `guard_profile_self_update` | Staff changing anything on their own profile except preferred name and mobile number |
| `guard_role_change` | Anyone editing their own roles; anyone but an owner granting, removing **or demoting** an owner |
| `guard_role_tenancy` | Granting a role to a user in another organisation |
| `guard_property_access_tenancy` | Granting access to a property in another organisation |
| `guard_timesheet_staff_update` | Staff changing anything on their own timesheet except their note and acknowledgement |
| `guard_timesheet_management` | Managers approving their own timesheet, stamping someone else's `approved_by`, editing locked rows, or regressing an exported timesheet |
| `guard_task_verification` | Staff marking their own work verified |
| `guard_task_relocation` | Staff moving a task to another property or organisation |
| `guard_open_shift_approval` | Staff approving their own shift claim |

The two self-update guards are **allow-lists**, not deny-lists: the new row
must equal the old row with only the permitted fields substituted. Both began
as deny-lists and both leaked — a column the list forgot stayed writable. An
allow-list protects columns added in future migrations without anyone
remembering to.

Each guard exits early when `is_service_context()` is true — that is, when
there is no end-user JWT, meaning trusted server-side code. A browser always
presents a JWT, and `anon` holds no grants on any application table, so this
bypass is not reachable from a client. Without it, legitimate provisioning
(creating the first owner, running an invite server-side) would be blocked by
the very guards meant to restrain users.

### Append-only tables

`audit_logs` and `clock_events` have **no UPDATE or DELETE policy at all**.
Not a restrictive one — none. A table with RLS enabled and no policy for an
operation denies that operation to every client role, including owners.

Attendance history and the audit trail therefore cannot be rewritten through
the API by anyone. Note that this required **two** further fixes to be true:
revoking EXECUTE on `write_audit_log()` (reachable as a PostgREST RPC) and
revoking `TRUNCATE` from `authenticated` (not subject to RLS at all). "No
DELETE policy" alone was never sufficient. Corrections happen on the timesheet, with a reason and an
audit entry, leaving the original events intact.

`audit_logs` also has no INSERT policy: entries are written exclusively by
`SECURITY DEFINER` triggers. Note that this alone was **not** sufficient —
`write_audit_log()` was reachable as a PostgREST RPC until its EXECUTE grant
was revoked. See the adversarial audit below.

### Confidential employment data is a separate table

Pay rate, payroll reference and employment dates live in
`employment_details`, not on `profiles`. Emergency contacts live in
`emergency_contacts`. This is deliberate: supervisors legitimately need to
read colleague *profiles* to run a shift, but must never see pay or
next-of-kin details. Separate tables mean separate policies rather than
column-level gymnastics.

Supervisors are excluded at the database level, not just in the UI.

### Kiosk PINs are unreachable from any client

`kiosk_credentials` has RLS enabled and **zero policies**, and its grants are
revoked from both `anon` and `authenticated`. No client can read a PIN hash
under any role, including owner. Verification happens only in server-side code
holding the service-role key.

PINs are stored as bcrypt hashes via `pgcrypto`, never plaintext.

### Push subscriptions are strictly per-user

`push_subscriptions` has no management read policy. A manager has no
operational reason to read another person's device endpoints, and those keys
can be used to send that person notifications. Only the owning user can read,
update or delete their own subscriptions.

### Notification text is lock-screen safe

`notifications.body` is documented as free of sensitive detail, because that
text can appear on a locked phone in a public area. Templates say "Open
StayFlow to review it" rather than naming times, pay or people.

### Open redirects

`safeRedirectPath()` (`src/lib/safe-redirect.ts`) constrains every
caller-supplied `next` parameter to a same-origin path, rejecting absolute
URLs, protocol-relative `//host` forms, backslash escapes that some browsers
normalise, embedded schemes and control characters. It is applied at both
sign-in and the `/auth/callback` PKCE exchange — the latter being the most
damaging place for an open redirect, since it fires immediately after a valid
session is established.

Covered by 7 unit tests.

### Account enumeration

Sign-in failures return one generic message regardless of cause. The password
reset screen always reports success, whether or not the address exists.
Reporting "no such account" would disclose who works here.

Users who authenticate successfully but are inactive, archived or have no
profile are signed straight back out.

### Secret handling

`SUPABASE_SECRET_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js will not inline
it into the browser bundle. `createServiceRoleClient()` additionally throws if
`typeof window !== "undefined"`, converting a catastrophic mistake into an
immediate, loud failure.

`anon` is granted nothing on any application table.


---

## Adversarial audit

After the schema was written and the first 27 tests passed, four independent
reviewers were run against the live database with distinct lenses (privilege
escalation, cross-tenant leakage, confidential-data exposure, immutability).
They were instructed to demonstrate every claim with an executed query rather
than reason about the SQL.

They produced 36 findings. **The automated verification stage did not run** —
it failed on an account spend limit — so the findings were triaged and
verified by hand instead. Nine were confirmed by re-executing the attack:

| # | Severity | Confirmed hole | Evidence before fix |
| --- | --- | --- | --- |
| 1 | Critical | `write_audit_log()` is `SECURITY DEFINER` and was left with default PUBLIC EXECUTE, and PostgREST exposes public functions as RPC. Any staff member — or `anon` — could forge audit entries. `audit_logs` having no INSERT policy achieved nothing. | staff inserted a forged row |
| 2 | Critical | `guard_role_change()` only tested `tg_op = 'DELETE'`, so an administrator could demote the owner with an UPDATE. The owner test also used `coalesce(new.role, old.role)`, which returns the *new* role, so a demotion never examined the old one. | owner rows remaining: 0 |
| 3 | Critical | `user_roles` / `user_property_access` write policies checked only the row's own `organisation_id`. Nothing tied the target user or property to that organisation, permitting cross-tenant injection. | confirmed by inspection, now blocked |
| 4 | High | `employment_select_management` and `emergency_select_management` granted any manager organisation-wide access. A Coastal-only manager could read Holiday Lodge pay rates and next-of-kin details, breaking "managers access only their assigned properties". | 2 pay rates exposed |
| 5 | High | `guard_timesheet_staff_update()` enumerated columns as a deny-list, so anything unlisted stayed writable. A staff member could move their own timesheet into another organisation, hiding it from their management chain. | timesheet relocated |
| 6 | High | `guard_profile_self_update()` did not cover `team_id`. A staff member could self-join the Management team and inherit its task visibility. | team changed |
| 7 | High | `shifts_select_open` and the open-shift offer policies had no organisation predicate, relying on `can_access_property()` alone. | cross-org readability |
| 8 | High | `tasks_update_assigned` had a `WITH CHECK` far weaker than its `USING`, letting assigned staff re-point a task at an inaccessible property. | confirmed by inspection |
| 9 | High | Managers could approve their own timesheet, stamp `approved_by` with another user's id, edit locked rows, and walk an exported timesheet back to draft. | confirmed by inspection |

Migration `0005_security_hardening.sql` closes all nine. Two structural
lessons drove the fixes:

**Deny-lists rot.** Both column guards enumerated what staff *may not*
change, so every column added later was writable by default. They are now
allow-lists: the new row must equal the old row with only the permitted
fields substituted. A column added in a future migration is protected
without anyone remembering to protect it.

**`SECURITY DEFINER` plus default grants is a hole, not a helper.** A definer
function bypasses RLS by design; leaving PUBLIC EXECUTE on it hands that
bypass to every client. `write_audit_log()` and all trigger functions now
have EXECUTE revoked from `public`, `anon` and `authenticated`.

The read-only predicate helpers (`active_uid`, `has_role_at_least`,
`can_access_property`, `current_organisation_id`, `manages_user`,
`manages_property`, `shares_organisation`) deliberately **keep** EXECUTE.
Policy expressions are evaluated with the invoking user's privileges, so
revoking them makes every policy raise "permission denied" rather than
filter — verified experimentally. They are safe to expose because each only
reveals facts about the caller themselves.

### Full triage

All 36 findings have now been triaged by hand. None were dismissed without
being read; those marked "not a defect" were checked against the schema.

| Outcome | Count |
| --- | --- |
| Confirmed and fixed in `0005_security_hardening.sql` | 17 |
| Confirmed and fixed in `0006_close_audit_findings.sql` | 17 |
| Duplicate of another finding | 2 |

Four findings triaged in the second pass were **verified by executing the
attack** before fixing:

| Severity | Hole | Evidence before fix |
| --- | --- | --- |
| Critical | `authenticated` retained `TRUNCATE` on every table. TRUNCATE is **not subject to RLS**, so `FORCE` and the deliberate absence of a DELETE policy protected nothing — a plain staff member could destroy the entire audit trail in one statement. The same applied to `clock_events`. | `truncate audit_logs` succeeded as staff |
| High | `clock_events.server_time` and `received_at` were client-supplied, and a client could set `is_flagged = false` itself. A staff member could write a permanently backdated attendance record into an append-only table nobody can correct. | event dated 30 days ago accepted |
| Medium | The owner-protection invariant existed only on `user_roles`. An administrator could set `is_active = false` on the owner's *profile*, revoking all their access instantly through the very mechanism documented as a feature. | owner deactivated |
| Medium | Every `FOR ALL` management policy re-opened organisation-wide reads. A permissive `FOR ALL` policy's `USING` clause also covers SELECT, and permissive policies are OR-ed — so each one silently overrode the carefully property-scoped SELECT beside it. | Coastal-only manager read Holiday Lodge availability |

The `FOR ALL` pattern was the most instructive: it appeared on
`leave_manage`, `availability_manage`, `adjustment_write_manager`,
`shift_ack_write_manager`, `task_assignments_write`, `announcements_write_manager`,
`documents_write_manager` and `timesheet_breaks_write_manager`. Writing a
scoped SELECT policy next to a loose `FOR ALL` write policy does not scope
reads — it just adds a second, wider door.

### Defects found after the audit

Four more were found while building the roster, each only because a result
was checked rather than a success response trusted:

| Defect | Consequence |
| --- | --- |
| `service_role` had no grants on any of the 36 tables | Every server-side write failed. Broke roster publishing; would have broken kiosk PIN verification, iCalendar tokens and Web Push identically. Fixed in `0008`. |
| Only one of four roster queries checked its error | A failed staff query rendered as an empty roster, indistinguishable from having no staff. |
| `employment_details` referenced `auth.users`, not `profiles` | PostgREST could not infer the relationship, so the embed failed and the roster showed no staff. Fixed in `0007`. |
| The shift form reset on the conflict re-render | A manager acknowledging a warning about one shift would have saved a different one — an unassigned shift on the wrong day, carrying an override reason documenting a decision they never made. |

Stated plainly: **a successful-looking response is not evidence of a correct
result.** Every one of these returned without error.

### What the audit still does NOT establish

- One of the five reviewers (coverage/correctness) died on a spend limit
  before returning, so that lens was never applied. There may be defects in
  the class it was meant to find.
- The automated verification stage never ran; confirmation was done by hand.
- No independent penetration test has been performed.
- Storage bucket policies remain unwritten and therefore unaudited.

---

## Test results

Run against a fresh local stack:

```bash
npm run db:test
```

All 48 checks pass. Each impersonates a real seeded user by setting the
`authenticated` role and the JWT claims Supabase derives `auth.uid()` from —
the same path a real request takes, so these exercise the actual policies
rather than a mock.

| # | Area | Actor | Expectation | Result |
| --- | --- | --- | --- | --- |
| 1 | employment_details | supervisor | cannot read colleagues' pay rates | PASS |
| 2 | emergency_contacts | supervisor | cannot read colleagues' emergency contacts | PASS |
| 3 | employment_details | manager | can read pay rates across the organisation | PASS |
| 4 | employment_details | staff | sees own employment record only | PASS |
| 5 | employment_details | staff | cannot edit own pay rate | PASS |
| 6 | shifts | staff (Holiday Lodge) | cannot see Coastal Comfort shifts | PASS |
| 7 | shifts | staff (Coastal) | can see own published shift | PASS |
| 8 | shifts | staff | cannot see an unpublished draft shift | PASS |
| 9 | timesheets | staff | cannot alter an APPROVED timesheet | PASS |
| 10 | timesheets | staff | cannot rewrite hours on an open timesheet | PASS |
| 11 | timesheets | staff | can acknowledge hours and add a note | PASS |
| 12 | user_roles | staff | cannot grant themselves the owner role | PASS |
| 13 | user_roles | manager | cannot promote themselves to administrator | PASS |
| 14 | profiles | staff | cannot change their own active status | PASS |
| 15 | clock_events | staff | cannot rewrite an attendance event | PASS |
| 16 | clock_events | owner | cannot delete attendance events either | PASS |
| 17 | audit_logs | owner | cannot delete audit entries | PASS |
| 18 | audit_logs | manager | cannot read audit logs (owner only) | PASS |
| 19 | audit_logs | owner | can read audit logs | PASS |
| 20 | kiosk_credentials | owner | cannot read PIN hashes from the client | PASS |
| 21 | push_subscriptions | manager | cannot read another user's push endpoints | PASS |
| 22 | push_subscriptions | staff | can read their own push subscription | PASS |
| 23 | deactivation | disabled staff | loses access to shifts immediately | PASS |
| 24 | deactivation | disabled staff | loses access to their employment record | PASS |
| 25 | archiving | archived staff | loses access to shifts immediately | PASS |
| 26 | anon | unauthenticated | cannot read staff profiles | PASS |
| 27 | anon | unauthenticated | cannot read shifts | PASS |
| 28 | audit_logs | staff | cannot forge entries via `write_audit_log` RPC | PASS |
| 29 | user_roles | administrator | cannot strip the owner role by UPDATE | PASS |
| 30 | employment_details | manager (Coastal only) | cannot read pay rates for another property | PASS |
| 31 | emergency_contacts | manager (Coastal only) | cannot read emergency contacts for another property | PASS |
| 32 | timesheets | staff | cannot move their timesheet to another organisation | PASS |
| 33 | profiles | staff | cannot change their own team | PASS |
| 34 | profiles | staff | can still update preferred name and mobile | PASS |
| 35 | user_roles | administrator | cannot grant a role to a user in another organisation | PASS |
| 36 | timesheets | manager | cannot approve their own timesheet | PASS |
| 37 | timesheets | manager | cannot edit a LOCKED timesheet | PASS |
| 38 | audit_logs | staff | cannot TRUNCATE the audit log | PASS |
| 39 | clock_events | staff | cannot TRUNCATE attendance history | PASS |
| 40 | clock_events | staff | cannot backdate an attendance event | PASS |
| 41 | clock_events | staff | must supply an idempotency key | PASS |
| 42 | profiles | administrator | cannot deactivate the organisation owner | PASS |
| 43 | staff_availability | manager (Coastal only) | cannot see availability for another property | PASS |
| 44 | roster_periods | manager (Coastal only) | cannot see rosters for another property | PASS |
| 45 | teams | staff (Coastal) | cannot enumerate another property's teams | PASS |
| 46 | leave_requests | manager | cannot approve their own leave | PASS |
| 47 | timesheets | manager | cannot insert a pre-approved timesheet for themselves | PASS |
| 48 | task_comments | staff | cannot comment on a task at an inaccessible property | PASS |

Checks 23–25 failed on first run and drove the `active_uid()` change described
above. Checks 28–37 correspond to the nine holes found by the adversarial
audit; each was demonstrated working before the fix and rejected after it.

The test harness is created in a throwaway `rls_harness` schema and dropped at
the end of the run. This matters: `act_as()` sets JWT claims, and leaving it in
a real database would be an impersonation primitive.

---

## Audit logging

The generic `audit_row()` trigger records before and after values for:

staff profiles · roles · property access · employment records (including a
dedicated `employment.pay_rate_changed` entry) · shifts · rosters · leave
requests · timesheets · announcements · documents · organisation settings ·
notifications sent.

`redact_sensitive()` strips `pin_hash`, `token`, `p256dh`, `auth_key` and any
password field before writing. Pay rates are deliberately **retained** —
a pay change is precisely the kind of event that must be reviewable.

No-op updates are skipped so the log records real changes rather than noise.

---

## Known gaps

These are not yet implemented and must not be assumed:

- **Storage bucket policies.** `documents.storage_path` and
  `leave_requests.attachment_path` point at Supabase Storage, but the bucket
  policies and signed-URL issuance are not written yet. Until then, do not
  upload real documents.
- **Rate limiting.** Kiosk PIN attempt limits are modelled in
  `organisation_settings` and `kiosk_credentials.failed_attempts`, but no
  server-side enforcement exists yet.
- **File upload validation.** No MIME/size checking is implemented.
- **Session expiry policy.** Supabase defaults are in force; no explicit
  idle-timeout has been configured.
- **Penetration testing.** None performed. The evidence above is
  self-testing plus one adversarial review round, not an independent
  assessment.


Labour hours and costs anywhere in StayFlow are **estimates for planning
only**. They are not award-interpreted payroll and must not be relied on for
wage compliance until professionally verified.

---

## Reporting a problem

This is an internal system for two motels. Report suspected security problems
directly to the organisation owner rather than filing them in a tracker.
