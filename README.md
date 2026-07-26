# StayFlow Staff

Mobile-first workforce management for small Australian motel operators.

StayFlow Staff handles rostering, attendance, timesheets, leave, tasks,
announcements and staff documents across one or many properties. It is an
original product, built for **Coastal Comfort Motel** and **Holiday Lodge**,
and designed so further properties can be added without schema changes.

It is a Progressive Web App: staff install it to their phone's home screen and
use it like a native app, including offline fallback and push notifications.

> **Not a property management system.** Reservations, rates and payments stay
> in the property's existing PMS. StayFlow Staff manages people, not bookings.

---

## Status

**Milestone 1 — foundation.** Complete and verified:

- Real Supabase email/password authentication with password reset
- Five-role model (Owner, Administrator, Manager, Supervisor, Staff)
- Row Level Security enabled and forced on every table from migration 0001
- Protected routing, role-based navigation, responsive application shell
- PWA manifest, installable icons, offline fallback, update prompt
- Australian English, Australia/Sydney timezone, AUD, `dd/mm/yyyy` dates

Rostering, the time clock, timesheets, notifications, dashboards and reporting
are scaffolded as routes with enforced access, and are built in later
milestones. The application says so on screen rather than showing fake data.

---

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22 or newer (Next.js 16 requires ≥ 20.9) |
| npm | 10 or newer |
| Supabase | a project on any plan |

---

## Local setup

**1. Install dependencies**

```bash
npm install
```

**2. Create a Supabase project**

At [supabase.com/dashboard](https://supabase.com/dashboard), create a project.
Choose the **Sydney (ap-southeast-2)** region — it keeps staff data in
Australia and keeps latency low for both motels.

**3. Configure environment variables**

```bash
cp .env.example .env.local
```

Fill in the values from **Project Settings → API** (see the table below).

**4. Apply the database migrations**

Link the project, then push:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

Alternatively, paste `supabase/migrations/0001_identity_and_access.sql` into
the Supabase dashboard SQL editor and run it.

**5. Create the first owner**

This application has no public sign-up — accounts are created by management.
To bootstrap the very first account, add a user under **Authentication → Users
→ Add user** (tick *Auto Confirm User*), then run the following in the SQL
editor, substituting the email you used:

```sql
with org as (
  insert into organisations (name, legal_name)
  values ('StayFlow Motels', 'StayFlow Motels Pty Ltd')
  returning id
), props as (
  insert into properties (organisation_id, name, short_code, colour)
  select id, 'Coastal Comfort Motel', 'CCM', '#0e7490' from org
  union all
  select id, 'Holiday Lodge', 'HL', '#b45309' from org
  returning id
), me as (
  select id, email from auth.users where email = 'you@example.com.au'
), new_profile as (
  insert into profiles (id, organisation_id, legal_first_name, legal_last_name, email)
  select me.id, org.id, 'Your', 'Name', me.email from me, org
  returning id, organisation_id
)
insert into user_roles (organisation_id, user_id, role)
select organisation_id, id, 'owner' from new_profile;
```

**6. Start the development server**

```bash
npm run dev
```

Open <http://localhost:3000> and sign in.

---

## Environment variables

| Variable | Required | In browser bundle | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Publishable key. Safe to expose — it grants nothing on its own, because RLS governs every table. |
| `SUPABASE_SECRET_KEY` | Yes | **No** | Service-role key. **Bypasses RLS entirely.** Server-side only. |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Yes | Canonical origin for password-reset links. Falls back to the Vercel URL, then `localhost:3000`. |

Anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle. The
service-role key deliberately has no such prefix, and
`createServiceRoleClient()` throws if it is ever called from browser code.

Build metadata (`NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_BUILD_DATE`,
`NEXT_PUBLIC_COMMIT_SHA`, `NEXT_PUBLIC_BUILD_ENV`) is generated automatically
during the build by `next.config.ts` — never set these by hand.

---

## Commands

```bash
npm run dev
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

---

## Architecture

```
src/
  app/
    (auth)/        sign-in, forgot password, reset password
    (app)/         authenticated shell and every protected route
    auth/callback  PKCE code exchange for emailed links
    offline/       service-worker fallback
    manifest.ts    web app manifest
  components/
    ui/            button, field, alert primitives
    layout/        shell, navigation, brand mark
    pwa/           service worker registration and update prompt
  lib/
    auth/          roles, server-side session, auth server actions
    supabase/      browser, server and service-role clients
  proxy.ts         session refresh + optimistic redirect
supabase/migrations/
```

Note that Next.js 16 renamed the `middleware` convention to **`proxy`**, which
is why session refresh lives in `src/proxy.ts`.

### How access control works

Authorisation is enforced in three layers, and only the innermost is
trustworthy:

1. **Navigation** hides what a role cannot use. Cosmetic only.
2. **`proxy.ts`** refreshes the session and redirects anonymous visitors.
   Optimistic only — the Next.js documentation is explicit that proxy must not
   be used as a full authorisation solution.
3. **Server-side checks and Row Level Security.** `requireUser()` and
   `requireRole()` run in Server Components before anything renders, and
   Postgres policies independently decide which rows the caller may touch.

A user who defeats layers 1 and 2 in the browser still cannot read a row the
database will not release. Notable policy decisions:

- Supervisors cannot see pay rates, employment records or emergency contacts.
- Deactivating or archiving a profile revokes access immediately: the
  `has_role_at_least()` and `current_organisation_id()` helpers both return
  nothing for inactive users, so every policy depending on them fails shut.
- `audit_logs` has no `UPDATE` or `DELETE` policy at all, making it
  append-only through the client API.
- Triggers block privilege escalation that RLS alone cannot express: a staff
  member cannot alter their own `is_active` flag or organisation, nobody can
  edit their own roles, and only an owner can grant or revoke the owner role.
- The RLS helper functions are `SECURITY DEFINER` with a pinned `search_path`.
  This is required, not incidental: a policy on `user_roles` that itself
  queried `user_roles` would recurse infinitely.

### Progressive Web App

The service worker (`public/sw.js`) is deliberately conservative. It precaches
only the offline page and icons, serves content-hashed build output from cache,
and uses network-first for navigations. **It never caches `/api/*`, `/auth/*`
or any Supabase response** — a cached roster served to the wrong person on the
shared kiosk tablet would be a real privacy failure.

Updates never apply silently. A new version installs in the background and
waits behind a prompt, so the page cannot reload underneath someone who is
halfway through clocking in.

---

## Deployment (Vercel)

Import the repository at [vercel.com/new](https://vercel.com/new). Set the four
environment variables above for Production and Preview, with
`NEXT_PUBLIC_SITE_URL` pointing at the production domain so reset emails never
link to a preview deployment. Add the deployed origin to Supabase under
**Authentication → URL Configuration → Redirect URLs**.

Scope `SUPABASE_SECRET_KEY` to Production and Preview only.

---

## Known limitations

- The `Database` type in `src/types/database.ts` is hand-maintained for the
  0001 schema. Once the full schema lands, regenerate it with
  `npx supabase gen types typescript --linked`.
- `npm audit` reports one **development-only** advisory in `brace-expansion`,
  reached through the ESLint toolchain. Its only patched release is a major
  version that breaks `minimatch@3`, and it never reaches the production
  bundle — `npm audit --omit=dev` is clean. It is left unpatched deliberately
  rather than breaking linting to improve a cosmetic number.
- Labour hours and costs anywhere in StayFlow are **estimates for planning
  only**. They are not award-interpreted payroll figures and must not be
  treated as such until professionally verified.
