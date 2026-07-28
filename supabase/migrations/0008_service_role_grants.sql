-- =====================================================================
-- StayFlow Staff — 0008 service-role grants
--
-- The grants blocks in 0001 and 0003 enumerated `anon` and
-- `authenticated` and never mentioned `service_role`. Combined with the
-- blanket `revoke all ... from anon`, that left service_role with no
-- privileges on any of the 36 application tables — verified: 0 of 36 had
-- INSERT.
--
-- This is not cosmetic. Several features are deliberately impossible for
-- a client and MUST be performed by trusted server-side code:
--   * writing notifications (no INSERT policy, so they cannot be forged)
--   * verifying kiosk PINs (no policies at all)
--   * resolving an iCalendar token for a calendar client that cannot
--     authenticate as the user
--   * sending Web Push on behalf of the system
--
-- It surfaced as "permission denied for table notifications" when
-- publishing a roster tried to tell staff about it. Every other
-- server-side write would have failed the same way.
--
-- service_role already bypasses RLS (rolbypassrls = true), so these
-- grants do not widen what a *client* can reach: the service key is
-- server-only, has no NEXT_PUBLIC_ prefix, and createServiceRoleClient()
-- throws if it is ever called in a browser.
-- =====================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'grant select, insert, update, delete on %I to service_role', t.tablename);
  end loop;
end $$;

-- Sequences too, or an insert into a table with a serial column fails
-- with a permission error that names the sequence rather than the table.
grant usage, select on all sequences in schema public to service_role;

-- Future tables and sequences inherit these, so a later migration cannot
-- silently reintroduce the same gap.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- kiosk_credentials stays unreachable from any CLIENT role, but the
-- server must be able to write and verify PIN hashes.
grant select, insert, update, delete on kiosk_credentials to service_role;

-- audit_logs: the server may append. It still may not UPDATE or DELETE,
-- so the append-only guarantee holds even for trusted code.
revoke update, delete on audit_logs from service_role;

comment on table audit_logs is
  'Append-only record of significant events. No UPDATE or DELETE policy
   exists for clients, and UPDATE/DELETE are revoked even from
   service_role, so history cannot be rewritten by any application path.';
