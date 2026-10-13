# Stockroom — invitation-only office inventory

Next.js App Router, TypeScript, Tailwind CSS, and Supabase Auth/PostgreSQL/Realtime. The UI is a static export; privileged Auth operations run separately in a Supabase Edge Function. No signup page, storefront, checkout, or billing.

## Implemented access model

| Operation | Admin | Staff | Viewer |
| --- | --- | --- | --- |
| Read inventory, locations, history and reports | Yes | Yes | Yes |
| Receive and issue stock | Yes | Yes | No |
| Transfer stock between locations | Yes | Yes | No |
| Create inventory items and locations | Yes | No | No |
| Adjust physical stock counts | Yes | No | No |
| Invite users, revoke invitations, change roles, deactivate accounts | Yes | No | No |

Roles come exclusively from active database membership. JWT role claims, signup metadata, URL parameters, and browser controls cannot assign office permissions. All protected mutations enforce current membership in PostgreSQL; direct quantity, balance, ledger, membership, and invitation writes are denied to browser users. Admins can update existing members but cannot enroll arbitrary Auth UUIDs through the membership RPC or change their own membership.

## Incremental delivery

1. **Database access:** `002_invitation_access.sql` tightens the original migration, restricts item creation and count adjustments to admins, adds invitations and per-location balances, and preserves existing stock. Stock mutations lock the membership and item rows to serialize concurrent changes. Transfers preserve the office total and write an actor-attributed immutable ledger row.
2. **Invitations and accounts:** admin-only email invitations through the `invite-user` Edge Function, acceptance with password setup, login, logout, password reset, role changes, invitation revocation, and account deactivation. New users have no inventory access until a verified, unexpired invitation bound to their Auth UUID is accepted. Acceptance takes no client-supplied permissions.
3. **Client access lifecycle:** membership verified before inventory queries and realtime subscription. Sign-out/account switches clear cached data and invalidate pending refreshes. Disabled membership immediately blocks future database operations and RLS-authorized stock realtime events with the same existing JWT. The UI polls every 15 seconds and on focus; the next failed access check clears data and removes the subscription. Previously delivered/downloaded data cannot be retracted.
4. **Deployment setup:** the privately hosted UI is available, but real login, email delivery, invitation acceptance, and realtime require a configured Supabase project. The separate demo uses only in-memory fixtures; it never seeds production or sends invitation emails.

## Local development

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Without a Supabase URL/key the app runs a clearly labeled isolated demo. `/login/` and auth callback routes explain that authentication is unconfigured. Production never falls back to demo after authentication or query errors.

## Connect Supabase securely

1. Use a dedicated project for this office. Apply **both** `supabase/migrations/001_inventory.sql` and `002_invitation_access.sql` in order, or run `supabase db push` against a linked project. For an existing installation, apply only the new migration after verifying migration history. Do not reapply the original migration or reset a populated database.
2. In Supabase Authentication, **disable Allow new users to sign up** and anonymous sign-ins. Keep email confirmation enabled. The checked-in `supabase/config.toml` uses these settings for CLI/local Auth; verify them explicitly in the hosted project's dashboard. They are not automatically applied by deploying the UI or Edge Function.
3. Set a minimum password length of 12 in Auth settings, and configure production SMTP. Use short Auth email-link expiry (for example 1 hour); the separate database invitation expires after 7 days and is also revocable. Supabase applies rate limits to recovery emails; the invitation RPC limits each admin to 20 attempts/hour.
4. Set the Auth Site URL to the app's exact origin and allow these exact redirects:

```text
https://office-inventory-noam.fuzzyflame3.chatgpt.site/auth/accept-invite/
https://office-inventory-noam.fuzzyflame3.chatgpt.site/auth/reset-password/
```

For development, add the corresponding exact `http://localhost:3000` URLs. Avoid wildcard or user-controlled redirects. Keep the standard Supabase invitation/reset email verification links (`{{ .ConfirmationURL }}`); the browser callback uses the verified implicit-flow session. Do not put role fields into an invitation form or rely on user metadata.
5. Copy `.env.example` to `.env.local` and supply only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a publishable key works). Build/development preflight rejects secret keys, legacy service-role keys, and public-prefixed privileged variables. No service credential is bundled into the frontend.
6. Deploy the backend with a trusted owner's Supabase CLI:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy invite-user
supabase secrets set SITE_URL=https://office-inventory-noam.fuzzyflame3.chatgpt.site
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the hosted Edge Function environment. Never copy the service-role key into `.env.local`, a `NEXT_PUBLIC_` variable, source code, browser storage, or a client response. CLI Auth/project-owner credentials remain local to the trusted owner and are not part of the build.

The function has `verify_jwt=false` for compatibility with current Auth signing keys, **but it is not unauthenticated**: its code requires a Bearer token, calls `auth.getUser(token)` to validate it, checks current database membership, and calls the admin-checked invitation RPC. Only then does it initialize the privileged client. CORS permits only the configured origin; authorization remains mandatory for non-browser callers too.
7. Create the first admin using the process below. Then rebuild (`npm run build`) and deploy `out/` after setting the public Supabase configuration. Static public configuration is baked into each build; setting hosting runtime variables alone does not update it.
8. The existing Sites hosting audience remains private. Configure the hosting allowlist separately for office colleagues; Supabase membership does not automatically grant access through the hosting layer. Invitees must be able to reach the private callback pages. Do not make the inventory public to bypass this layer.

## First admin — trusted owner bootstrap only

There is no public bootstrap API, automatic "first user becomes admin" behavior, or browser-accessible bootstrap function.

1. Using the trusted project owner's Supabase Auth dashboard, create the intended admin's account and verify that person's identity/email. Use a securely delivered password; keep public signups disabled. Copy the Auth UUID.
2. Run the owner-only script with a trusted PostgreSQL connection, using an existing securely supplied `DATABASE_URL` (never a `NEXT_PUBLIC_` variable):

```sh
psql "$DATABASE_URL" -v admin_user_id='VERIFIED_AUTH_UUID' -v admin_name='Office Administrator' -f scripts/bootstrap-admin.sql
```

The script holds an exclusive membership-table lock, requires a verified Auth account, rejects execution when an active admin already exists, and inserts exactly one membership in a transaction. Ordinary browser users lack the required table/Auth privileges. It does not read or grant permissions from the new user's request.
3. Sign in as that admin. Use **Team & settings → Invite user** for subsequent users. Only another active admin can change or deactivate an existing member. The UI and RPC disallow self-demotion/deactivation to avoid accidental loss of the final active admin.

## Invitations and deactivation

An active admin submits email/name/role. The Edge Function validates the caller through Auth and database membership, creates an admin-authorized invitation record, sends the Auth invitation to a server-owned redirect, and binds the returned Auth UUID using a service-only RPC. Opening the link verifies the email. The invited user chooses a password; `accept_invitation()` matches their verified Auth email/UUID against an unexpired pending invitation, confirms the issuer is still an active admin, and takes the role from that record. Acceptance is transactional and single-use. It cannot reactivate an existing deactivated member.

Admins see pending invitation history and can revoke it. Changing a member's access to **Deactivated** denies reads/writes and future stock realtime delivery using database membership immediately, without waiting for a JWT to expire. The Auth identity remains for ledger attribution and may still verify its password or recover it; a recovered password never restores office membership. Reactivation requires an active admin.

If delivery fails, the invitation becomes failed and grants no access. An uncertain network outcome stays in `sending` to prevent blind retries. If email was sent but UUID binding failed, the UI reports failure and no membership is granted. A trusted project owner should reconcile the row with the matching Auth UUID using `finish_invitation`, or revoke/delete the unaccepted Auth account and issue a fresh invitation. Never enable membership by modifying browser metadata. Existing Auth accounts without membership require owner reconciliation because Auth's invite endpoint may reject an already registered address.

## Validation

```sh
npm run typecheck
npm run test:access
npm run test:database
npm run build
```

- Database tests launch a temporary PostgreSQL cluster and apply the actual migrations, using test-only Supabase Auth roles/identity fields. They verify allow and deny paths for all roles, uninvited/forged metadata, anonymous access, invitation email/UUID verification, expiry, revocation, replay, admin-only enrollment/role changes, receive/issue/transfer, negative-stock prevention, atomic ledger writes, and deactivation with the existing JWT subject. They never connect to production.
- Invitation-handler tests execute the real Edge Function handler with mocked Auth/database clients. They verify token validation, current admin checks, CORS, invalid requests, revocation during a request, server-owned redirects, returned UUID binding, and fail-closed email/binding errors. They do not send email.
- Public-configuration checks reject privileged browser keys before development/build.

Real Supabase Auth email delivery and Realtime transport still need an end-to-end test with a connected project: sign in as each role; try unauthorized REST/RPC requests directly; accept, revoke, expire, and replay invitations; reset a password; deactivate a signed-in user; and verify a second active user's live stock updates. A local SQL test does not emulate the Supabase Realtime server.

## Data model

One office per Supabase project. Items hold aggregate quantity and a default location; `stock_balances` holds quantities per item/location. Receive/issue target one location; admin counts adjust one location; transfers atomically move units between two locations. Existing assigned quantities are migrated into balances. Legacy positive stock without a location is preserved in `Unassigned (migration)` for later assignment. No client can write quantities or ledger rows directly.

Sample fixtures are exclusively in `lib/data.ts`; production remains empty until admins create its records. CSV exports are read-only snapshots and escape spreadsheet formula prefixes.

Implementation follows Supabase's official [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [password recovery](https://supabase.com/docs/guides/auth/passwords), and [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) documentation.
