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
update this row but not that column". Four trigger guards cover the gap:

| Guard | Prevents |
| --- | --- |
| `guard_profile_self_update` | Staff changing their own `is_active`, `archived_at`, organisation or primary property |
| `guard_role_change` | Anyone editing their own roles; administrators minting or removing an owner |
| `guard_timesheet_staff_update` | Staff rewriting hours, breaks, status or approval fields |
| `guard_task_verification` | Staff marking their own work verified |
| `guard_open_shift_approval` | Staff approving their own shift claim |

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
the API by anyone. Corrections happen on the timesheet, with a reason and an
audit entry, leaving the original events intact.

`audit_logs` also has no INSERT policy: entries are written exclusively by
`SECURITY DEFINER` triggers, so a client can neither forge nor suppress them.

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

## Test results

Run against a fresh local stack:

```bash
npm run db:test
```

All 27 checks pass. Each impersonates a real seeded user by setting the
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

Checks 23–25 failed on first run and drove the `active_uid()` change described
above.

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
  self-testing, not an independent assessment.

Labour hours and costs anywhere in StayFlow are **estimates for planning
only**. They are not award-interpreted payroll and must not be relied on for
wage compliance until professionally verified.

---

## Reporting a problem

This is an internal system for two motels. Report suspected security problems
directly to the organisation owner rather than filing them in a tracker.
