# Stockroom — invitation-only office inventory

For release commands, production configuration, private hosting, and rollback, see [DEPLOYMENT.md](DEPLOYMENT.md).

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

1. Use a dedicated project for this office. Apply **all seven** migrations in order: `001_inventory.sql`, `002_invitation_access.sql`, `003_item_management.sql`, `004_transactions.sql`, `005_inventory_snapshot.sql`, `006_dashboard_alerts.sql`, and `007_physical_counts.sql`, or run `supabase db push` against a linked project. For an existing installation, apply only migrations not yet recorded in its migration history. Do not reapply the original migration or reset a populated database.
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
npm run test:inventory
npm run test:dashboard
npm run test:realtime
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

## Item management and archive lifecycle

The third migration adds optional barcode, supplier, private image path, active/archived status, updated timestamp, and archive timestamp. Existing records remain active. SKU is required and unique case-insensitively; barcodes are optional, unique when present, and preserve leading zeros. Empty optional inputs become NULL. Archived items retain their identifiers, balances, images, and ledger rows, so identifiers cannot be reused. Required category/unit/name/SKU, nonnegative integer thresholds and quantities, and finite nonnegative unit costs are enforced by PostgreSQL constraints.

Admins can create, edit metadata, archive, and restore. The edit RPC has **no quantity, balance, timestamp, or lifecycle parameters**. It only updates a fixed metadata column list and checks the last observed `updated_at` to reject stale edits. Changing the default receiving location does not move stock. Opening quantities must be entered through receive movements per location; later receive/issue/transfer/count changes also use the movement ledger. Database triggers reject stock changes on archived items, with transactional rollback if attempted; restore re-enables operations without resetting balances. There is no item-delete operation.

The inventory table composes search (name, SKU, barcode, supplier, description), category, location, stock status, and lifecycle filters. By default it shows active items. A selected location displays its own quantity/value/status; all-locations mode displays aggregate stock. A location includes an item when it has a balance row (including zero) or is its default location. Unassociated items are not reported as empty at every office location. Low stock means greater than zero and at/below the item minimum; out of stock means zero. Needs restock includes both. The minimum is defined on the item and is used against the selected quantity scope. Reports retain archived stock value; restock alerts consider active items only.

### Private item images

`003_item_management.sql` creates a private `item-images` Storage bucket with a 5 MB limit and JPEG/PNG/WebP MIME allowlist. Uploads require an active admin; reads require active office membership, and non-admins only read images linked to item records. The app downloads images through authenticated Storage requests and renders local blob URLs; it never creates public or reusable signed download URLs. Images use immutable item-specific paths. Upload failures do not create item records. If a metadata save fails, the app attempts cleanup of the unlinked upload; Storage policy prevents deletion if the save actually committed. Replaced images are retained for owner-managed cleanup instead of deleting historical files automatically. The isolated demo keeps image blobs only in browser memory.

Run the third migration before deploying the new app against a populated Supabase project. If existing SKUs differ only in case or contain surrounding whitespace, the migration fails without partial changes: reconcile those identifiers as the trusted owner before retrying. Test the real Storage upload size/MIME limits and authenticated downloads after connecting Supabase; local SQL tests use Storage metadata test doubles and do not emulate object bytes or the Storage HTTP service.

Database tests additionally verify identifier uniqueness across archives, required/numeric constraints, protected quantities, opening ledger entries, separate location quantities, metadata timestamps, stale-edit conflicts, archive/restore/history retention, and image RLS. Four filter tests cover combined search/category/lifecycle filters, per-location quantities, zero balances, and low/out-of-stock distinctions.

## Atomic inventory transactions

Migration 004 introduces `post_movement`, the only browser-accessible stock write operation. It supports receive (`add`), issue/consume (`remove`), return, transfer, admin-only counted adjustments, and admin-only linked reversals. The ledger records item, actual quantity changed (or transferred), requested counted total for adjustments, source/destination, reason, optional notes, optional department/recipient for issues, server-derived actor, and database timestamp. CSV exports include these fields and reversal/request IDs.

Each call locks active membership, serializes the actor/request key, locks the item row, then reads current balances. The balance writes, aggregate update, and ledger append run in the same PostgreSQL transaction. Transfers move both location balances without changing the office total. Negative availability, invalid destinations, archived items, ledger-insert failures, and numeric overflow roll back the whole operation. Independent issues of the final unit serialize: one succeeds and the other fails after observing the depleted balance.

The browser creates a UUID for each posting attempt and keeps the same request/payload for retries. PostgreSQL enforces a unique `(actor_id, request_id)` and returns the original movement ID for identical retries; different details under the same key are rejected. The older non-idempotent RPCs no longer grant execution to browser users. A synchronous submission guard prevents duplicate handlers and all fields/buttons are disabled while saving. Pending production requests are retained in per-user browser sessionStorage until confirmed; the pending banner restores the saved details for a safe retry after reload. Do not enter a fresh transaction to retry an uncertain network outcome. A definite SQL error rolls back and unlocks the draft for correction; an uncertain transport error keeps its key and original payload. Demo transactions are isolated in memory and reset on reload.

Posted rows cannot be updated or deleted, enforced by grants and a database trigger. An admin can reverse a movement with a required reason. The database derives the inverse from the original row, applies inverse deltas to the current balances (preserving later activity), and appends a row with `reverses_id`. Only one reversal per original is allowed, reversals cannot themselves be reversed, and insufficient stock prevents reversal. Archived items must be restored first. Legacy rows without recorded locations cannot be reversed safely; use a documented admin adjustment. To correct an amount or location, reverse the original and post the intended transaction with a reason referencing the original. No posted record is rewritten.

The database suite also exercises all transaction types, same-key retries and mismatched payloads, exact reversal effects, recipient/notes attribution, retired endpoint denial, immutable ledger rows, and forced ledger failure after stock updates. Two independent PostgreSQL connections test concurrent final-unit issues and concurrent identical retries. These checks use the actual migration and do not send data to production. Apply migration 004 before enabling the updated UI against real Supabase data.

## Realtime inventory and connection recovery

Migration 005 provides `inventory_snapshot()`: one SQL statement returns items, location balances, dashboard inputs, movement activity, locations, members, role-filtered invitations, and a server `confirmed_at` timestamp. It uses SECURITY INVOKER and existing RLS. Anonymous callers cannot execute it; non-members and deactivated members receive no snapshot. Returning everything in one database snapshot prevents mixed totals/location balances/ledger views and avoids the REST API's default 1,000-row table pagination limit.

One realtime controller is owned by each authenticated route/session. It first verifies membership by fetching a snapshot, subscribes to items/balances/movements/locations/members, waits for the server's Postgres Changes readiness acknowledgement (`postgres_changes_options.wait`), and performs a catch-up fetch after every successful join or rejoin. Events only schedule authoritative snapshots; they never overwrite quantities with optimistic math or independently merge rows. Bursts are debounced, fetches serialize, and a dirty event during a fetch schedules another pass. Inventory, item details, totals, and activity update together from the same response.

The header displays connection status and the last successfully confirmed server refresh time. Offline browsers stop their subscription and display a reconnect banner. Transient network failures retain the last confirmed data as read-only with a warning; genuine authentication/membership denial clears office data. Recovery uses online events, focus refresh, periodic checks, and an explicit Reconnect control. Route changes, logout, and unmount remove owned channels/listeners/timers and invalidate late callbacks. Active search, category, location, stock/lifecycle filters, and the selected inventory sort criterion are independent of fetched data and remain selected during updates.

Stock posting requires browser connectivity, an acknowledged realtime subscription, and a successful catch-up snapshot. Every posting also fetches current data immediately before sending its RPC. Receive/issue/return/transfer/adjust/reversal buttons are disabled while disconnected or recovering, and the submit handler checks the controller again. There is no offline queue or automatic replay of stock transactions. A previously in-flight request whose outcome is uncertain retains its idempotency key for a manual retry after reconnect; this is separate from allowing an offline transaction.

### Verification status and two-session test

Local checks passed: five controller tests (two independent simulated sessions, interruption, missed-event recovery, failed/stale fetches, membership denial, callback cleanup, and event coalescing), snapshot RLS/coherence checks against real temporary PostgreSQL, and simultaneous final-unit withdrawal/idempotent retry tests using two independent database connections. The simulated controller tests do not constitute live Supabase Auth/websocket or browser UI verification.

The checkout still has no Supabase project configuration or two provisioned test sessions. An email address alone does not enable that verification. `npm run verify:live` explicitly exits with setup required instead of reporting a pass when credentials are missing.

To run the ready-made real-service verification, configure a **disposable** Supabase project with all migrations, provision an admin and staff member, and supply these values in the ignored `.env.local` or trusted process environment:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
STOCKROOM_TEST_ADMIN_EMAIL
STOCKROOM_TEST_ADMIN_PASSWORD
STOCKROOM_TEST_STAFF_EMAIL
STOCKROOM_TEST_STAFF_PASSWORD
STOCKROOM_TEST_ALLOW_WRITES=disposable-project
```

Then run `npm run verify:live`. It creates separate authenticated clients, verifies all stock transaction types and coherent quantities/activity across both, races two withdrawals against the final unit, disconnects one subscription while the other posts, reconnects and fetches missed data, and checks subscription cleanup. It archives its test item afterward; immutable test ledger records and any test locations remain in that disposable project. It never uses a service-role key and does not print passwords/tokens. The disconnection test removes/recreates the real client's subscription and tests the controller's offline gate; separately test browser Network Offline and throttling in two browser profiles/tabs to verify the rendered UI, filter/sort retention, status, and disabled buttons.

## Operational dashboard

The dashboard uses the confirmed inventory snapshot. Metrics count active items only: low stock is strictly positive and at or below the minimum; out of stock is zero. Restocking includes both conditions. Estimated value sums each active item's aggregate current quantity times its current unit cost and is displayed in USD. This is an estimate at current costs, not historical purchase valuation. Archived stock remains stored but is excluded from these operational metrics. Quantities of different units are never combined into a total stock number; location and report summaries show item/balance counts instead.

Issue rankings support rolling 7-, 30-, and 90-day periods, rank by issue transaction frequency, and show quantities separately with each item's unit. Reversed issues are excluded. Recent movements retain the complete posted history. Dashboard Receive, Issue, and Transfer actions are available to staff/admins, require confirmed online stock, and open the relevant movement type. Add Item is admin-only; existing database authorization remains enforced.

Migration 006 stores stock alerts in `stock_alerts`, protected by membership RLS. A partial unique index permits at most one unresolved alert per item. Item quantity, minimum, and lifecycle changes synchronize alerts within the same transaction as the stock operation. Remaining below the threshold preserves the alert ID; replenishment above the minimum or archiving resolves it. Transitioning between positive low stock and zero resolves the old condition and opens the corresponding new condition. Resolved alert history is retained. The realtime snapshot includes unresolved alerts with direct item-detail links. The demo derives isolated sample alerts; real persistent alerts require the migration.

Two dashboard tests validate active/zero/low boundaries, value, mixed-unit handling, and period/reversal-aware issue frequency. PostgreSQL tests validate stable unresolved alert identity, replenishment and zero/archive transitions, retained history, snapshot inclusion, and role restrictions. Supabase remains unconfigured in the current checkout; the dashboard cannot show real office records until that setup is completed.

## Physical stock counts

The **Physical counts** page supports draft, in-progress, awaiting-approval, and completed location counts. An admin creates a draft and starts it to snapshot all active items associated with that location (a default location or an existing balance, including zero). Each line retains the original expected quantity, item name/SKU/unit, and movement revision. Only one open count per location is permitted. Staff/admins enter nonnegative physical quantities; viewers can only inspect. Saving a measurement changes no inventory quantity. Entry versions reject concurrent overwrites, and every measurement/recount is retained in immutable count-entry history.

Original expected quantities never change. A separate reconciliation baseline starts equal to that snapshot. Any subsequently posted movement of the item increments a database-owned revision, including zero-delta adjustments, transfers, reversals, and offsetting moves. Movement at another location also conservatively flags that item. The UI shows expected-at-start, latest baseline, counted quantity, variance against that baseline, and a recount-required badge. Unit changes and archived items also invalidate approval. Stock movements remain available during counting.

An admin must refresh a flagged baseline with a reason. This preserves the original expected quantity, records the new baseline in history, clears the obsolete measurement, and returns the count to in-progress so staff must physically recount. New items that appear at the location after the initial snapshot must also be added through this reconciliation action and counted. Archived items must be restored before recount/approval; count lines cannot be silently dropped. Submit requires all lines to have counted quantities; approval independently rejects unresolved conflicts, missing new items, or incomplete lines.

Approval is admin-only and requires a reason. It briefly obtains an exclusive item-writer lock before locking the count header, revalidates every baseline, and calls the existing atomic/idempotent movement RPC for each line. All lines post auditable adjustments, including zero-variance records; per-location balances and office aggregates change through those transactions only. Ledger notes identify the count, line, original expected quantity, baseline, physical count, and approval reason. Each line stores its resulting movement ID. Approval and completion commit as one transaction; a failure on any line rolls back the entire batch. Already completed approvals return the same count ID without posting again, including simultaneous approvals by different admins. Reads can continue during the short writer lock; it is not held while staff physically count.

Migration 007 adds the movement revision trigger, count/header/line/entry tables, RLS and guarded RPCs, realtime publication, and count data in the coherent inventory snapshot. Apply it before using production counts. The in-memory demo supports the same visible workflow but resets on browser reload and is not shared between sessions.

Temporary PostgreSQL tests cover all four states, staff entry versus admin approval, immutable original expectations, stale entry versions, net-zero movement conflicts, recount history, newly associated location items, auditable adjustment links, completed approval retries, batch rollback after a forced ledger failure, and two independent admin connections racing one approval. Live Supabase authentication/websocket/browser testing still requires the configured project described above.


## CSV imports and inventory reports

Apply `008_csv_reports.sql` after the seven earlier migrations. Costs move to the admin-only `item_costs` table: staff and viewers cannot read costs through table queries, either snapshot RPC, or shared-item realtime payloads. Admin create/edit operations maintain costs atomically. Financial columns, valuation reports and dashboard values are admin-only.

Admins can open **CSV import**, download separate new-item and opening-stock templates, select a file, review parsed rows and row-specific errors, and explicitly confirm. Item imports create zero stock and reject existing SKUs/barcodes, including archived identifiers. Opening imports require an existing active SKU, unambiguous location name, positive integer quantity and reason. A location with stock history must use Receive Stock instead. One item can have opening stock at multiple locations; repeated SKU/location pairs are rejected. Files are limited to 1 MB and 1,000 rows. Images can be uploaded after import.

The database revalidates under locks, commits the whole file atomically, records the server-derived actor and original payload/result in immutable `inventory_imports`, and records opening stock through `post_movement`. Retrying with the same request ID returns the original result; changing its payload is rejected. Concurrent new requests cannot add the same opening stock again. No rows are silently skipped or existing records overwritten. Demo imports affect only in-memory fixtures.

Reports include current stock by item/location, positive low stock and separate zero stock, movement history, usage by recorded department/recipient, and admin valuation. Filters cover item/search/category/location, stock status, movement date/user/type, and department/recipient. Date filters use the browser's local timezone and include the whole selected end date. Usage groups non-reversed gross issues by department/recipient and item, preserving units; returns remain in movement history and are not allocated back to departments. Current stock preserves archived records; restock and valuation use active items. Exports use the displayed filtered rows. CSV encoding quotes fields, escapes embedded quotes, and neutralizes formula prefixes even after leading whitespace/control characters.

Run `npm run test:csv` for parser, injection, validation and report checks. Database tests cover real migration/RLS, atomic imports, confirmation, retry safety, opening movement audit records, and admin-only cost access. Supabase HTTP/realtime verification still requires a configured project; the local PostgreSQL tests do not claim to verify hosted services.


## Office readiness

**Not production-ready:** hosted Supabase configuration and live/mobile/accessibility/managed-restore verification are still outstanding. The deployment remains a private demo. [OPERATIONS.md](OPERATIONS.md) documents setup, first admin, staff invitations, location/item imports, monitoring, encrypted backups, recovery and VPN/network requirements. [VERIFICATION.md](VERIFICATION.md) separates local passing checks from pending hosted/manual gates. Invitation-only membership and private hosting do not establish office-network-only access.

Migration 009 stores fixed-code diagnostics with server actor/timestamp, admin-only reads and a ten-per-minute member rate limit. Client logging and error boundaries omit raw exceptions, personal input and URLs. Run `npm run verify:office` only in a disposable project with four provisioned role/nonmember test identities; run `npm run verify:live` for two-session realtime testing. Missing configuration yields NOT RUN. The database suite also performs an actual local dump/restore and compares complete application/Auth/Storage metadata and restored permissions; hosted recovery and object bytes require the runbook drill.
