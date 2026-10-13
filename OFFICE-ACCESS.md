> **Neon migration:** Inventory, permissions, office sessions and private files now use Neon PostgreSQL. Supabase is retained only for staff authentication and invitation email. Follow [NEON-SETUP.md](./NEON-SETUP.md); older Supabase database/Storage and static hosting instructions below are historical.

# Office password protection

The app now requires a running Next.js Node server. Static Sites / `out/` hosting cannot enforce this gate. Remove any older public static deployment and do not publish `out/` or `.next/server` as static files. Existing Supabase staff logins, invite-only enrollment, role permissions, and audit identities remain required after the office password.

## Deploy

1. Apply Supabase migrations through `010_office_gate.sql`. This migration creates private session storage and a shared atomic login budget; installs a PostgREST pre-request guard; and adds restrictive policies to inventory tables and Storage. It immediately denies direct browser database and Storage access, including requests with valid staff JWTs. Plan a maintenance window to deploy the server and migration together.
2. Redeploy `supabase/functions/invite-user`; it now forwards office authorization into its caller-scoped database client. It still validates the individual staff identity and admin permission.
3. In your server's secret environment settings, set `OFFICE_PASSWORD` (at least 12 characters), `OFFICE_SESSION_SECRET` (at least 32 random characters), `SUPABASE_SERVICE_ROLE_KEY`, and `OFFICE_APP_ORIGIN` (the exact HTTPS origin, without a path). Set the existing public Supabase URL and anon/publishable key at build time. Do not paste real secrets into frontend configuration, Git, deployment archives, or chat. `.env.local` is ignored for local development.
4. Optionally set `OFFICE_SESSION_TTL_SECONDS`, default 28800 (8 hours), allowed range 60–604800. Expiration is absolute. Cookies always use `HttpOnly; Secure; SameSite=Strict; Path=/` and a `__Host-` name. Use `http://localhost` for local development; production must use HTTPS.
5. Run `npm ci`, `npm run build:production`, and `npm start` on Node 22. Configure your HTTPS reverse proxy to redirect HTTP to HTTPS, forward the correct protocol, strip client-supplied forwarding headers, and prevent direct public access to the internal Node HTTP port. Allow SSE streaming on `/api/office/events/` without buffering. Keep `.next/server` private. Never cache authenticated responses at the CDN.

The service-role key is used only for private office session management. Inventory, files, staff authentication, and invitations are proxied with the publishable key and the original staff bearer token; no inventory request gains service-role privileges. The proxy overwrites office headers, does not forward cookies upstream, does not create public/signed download URLs, and uses a fixed backend origin.

Realtime refresh now uses a server-checked SSE tick every five seconds followed by a fresh staff-authorized database snapshot. No inventory data is broadcast in the stream. Direct Supabase WebSockets cannot read protected tables. Revoked/expired office sessions close the stream at its next check and cannot fetch another snapshot. Staff deactivation remains enforced by live database membership.

## Change the office password and revoke access

Change `OFFICE_PASSWORD` in server secret settings and restart/redeploy **all** server instances together. Password-derived session generations reject previous sessions immediately on the new instances. Rotate `OFFICE_SESSION_SECRET` to a fresh random value at the same time, including when restoring a previously used password, to prevent old generations being reused. To forcibly remove every session immediately, execute this trusted-owner SQL:

```sql
delete from office_security.sessions;
```

The “Lock office / log out” button signs out the individual local staff session, deletes the server-side office session, and expires the cookie. Replaying a logged-out cookie does not restore access. Existing account logout also ends the office session.

The login budget allows 20 attempts across the whole office per 15-minute window, including successful attempts. This is intentionally independent of IP headers and shared across replicas. Requests over the budget return HTTP 429 with `Retry-After`. A deliberate flood can temporarily delay legitimate office logins; existing sessions continue working. An owner can reset the budget with `delete from office_security.login_budget;` after investigating.

## Verification

`npm run test:office` checks password validation, direct URL/API/download denial, proxy credential handling, cookie flags, origin checks, password rotation, logout, rate limiting and fail-closed database outages. `npm run test:database` includes real PostgreSQL tests of the migration, direct staff-JWT denial, Storage policies, preserved identities and viewer restrictions, expiration, rotation, revocation, and shared login budgeting. The existing database permissions and transaction suites still run. After building, `npm run verify:office-http` exercises the actual Next server over local HTTP with a disposable session backend, including direct RSC requests.

Before office rollout, repeat against the deployed HTTPS host:

- Without cookies, request `/inventory/`, `/reports/`, item URLs, and account routes. Expect only a redirect to the office password screen; `/api/backend/rest/v1/items`, private Storage paths, and `/api/office/events/` must return 401.
- Enter an incorrect password, then reach the budget and verify 429. Enter the correct password after resetting/waiting; inspect the cookie flags and verify that staff login is still required.
- With a staff JWT but without the office cookie, request the proxy and the Supabase REST/Storage URLs directly. Neither may reveal inventory/files. Direct RPC must fail, including `inventory_snapshot` and `accept_invitation`.
- With both logins, confirm staff/viewer/admin permissions, file upload/download, invitations, and updates in two browser sessions.
- Log out and replay the former cookie. Repeat after changing the password and restarting all replicas, and after session expiration. Confirm data requests fail and update streams stop.
- Check HTTPS redirect/enforcement, `X-Robots-Tag`, `/robots.txt`, HTML noindex metadata, and no caching of authenticated responses.

Local tests do not replace hosted Supabase Auth, Storage, proxy/TLS, and cross-browser verification. Search indexing is discouraged by robots headers and metadata; access protection is enforced independently on the server and database.
