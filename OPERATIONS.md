> **Neon migration:** Inventory, permissions, office sessions and private files now use Neon PostgreSQL. Supabase is retained only for staff authentication and invitation email. Follow [NEON-SETUP.md](./NEON-SETUP.md); older Supabase database/Storage and static hosting instructions below are historical.

> **Office access update:** This app now requires a Next.js Node server with HTTPS and migration `010_office_gate.sql`. Previous static `out/` / Sites deployment instructions below are historical and must not be used for the protected app. Follow [OFFICE-ACCESS.md](./OFFICE-ACCESS.md) for environment variables, deployment, password changes, session revocation, and verification.

# Office operations and release gate

**Status: not production-ready.** The private hosted release is an isolated demo. Supabase credentials and test accounts are absent. Local PostgreSQL, permission, concurrency, import and recovery tests are available; they do not verify hosted Auth, SMTP, Storage bytes, WebSockets or the rendered browser experience. No production database has been created, seeded or modified by these tests.

## Provision the real office

Use a separate Supabase project for production and another for disposable verification. Never run test SQL fixtures or `verify:live` / `verify:office` against production. There is no seed migration. Production loads database results, not demo fixture arrays. Before onboarding, confirm the production inventory is empty with `scripts/verify-empty-inventory.sql` through an owner connection.

1. Follow [DEPLOYMENT.md](DEPLOYMENT.md). Link the intended project with `supabase link --project-ref YOUR_PROJECT_REF`, inspect `supabase migration list`, then `supabase db push`. Apply migrations 001–009 in order, without resetting a populated database. Migration 009 creates protected diagnostics. `supabase/config.toml` disables signup locally; confirm these settings independently in hosted Auth.
2. In hosted Auth disable public/anonymous signup, require email confirmation and a 12-character password, configure production SMTP and the exact invitation/reset redirect URLs. Deploy `invite-user` and set `SITE_URL` to the HTTPS frontend origin in Edge Function secrets. The function validates the caller using Auth and membership even though gateway `verify_jwt` is false. Service credentials stay in Supabase, never the frontend.
3. Create and verify the first admin identity through the trusted owner's Auth dashboard. Copy that account's UUID, then run `scripts/bootstrap-admin.sql`. It requires verified email, locks membership and refuses a second bootstrap. With a private libpq service configured on the owner's machine and its password in a permission-0600 `.pgpass` file:

```sh
PGSERVICE=stockroom-owner psql -v admin_user_id='VERIFIED_AUTH_UUID' -v admin_name='Office Administrator' -f scripts/bootstrap-admin.sql
```

Do not commit connection files or passwords. PostgreSQL's `PGSERVICE` name is not a credential; no privileged URL needs to appear in the command.
4. Configure only the project URL and publishable/anon key in the frontend's build environment, using `.env.example`. Build with `npm run release:check`, which refuses missing configuration or privileged public keys. Static exports require a rebuild when those values change. Keep `.env.local` ignored. Supabase's project settings, SMTP and Edge secrets are separate from frontend hosting settings.
5. Deploy the exact pushed source/archive with private hosting access. The current Sites audience is owner-only, so office staff must receive hosting access as well as app invitations. Hosting sign-in and Supabase sign-in are separate. Invitation/reset callbacks must be reachable by the intended invited person.
6. Pass the live and manual verification gates below before entering operational data. Set up backups, complete a managed-project restore drill, record the operator and date, then authorize office rollout.

## Admin onboarding and daily work

- **Invite staff:** Team & settings → Invite user. Enter name, email and Admin/Staff/Viewer. The recipient accepts the email invitation and chooses a password. They cannot select their permissions. Delivery failure or uncertain delivery requires checking the invitation status before trying again. A trusted owner reconciles ambiguous sending records; do not grant membership from browser metadata.
- **Add locations:** Storage locations → Add location. Give each a clear, distinct name, such as Supply room or IT cabinet. Opening-stock CSV validation rejects ambiguous names. Locations should exist before import.
- **Import inventory:** CSV import → New items → Download template. Fill required name/SKU/category/unit/unit_cost/minimum; preserve barcode zeros; optional columns may be blank. Choose the UTF-8 CSV, review every preview/error and explicitly confirm. Items begin at zero. Then choose Opening stock by location and use its template with SKU/location/quantity/reason/optional notes. One item may have rows at different locations. Prior stock history requires Receive Stock. The entire file either commits or fails; retry an uncertain request unchanged. Existing SKUs/barcodes remain reserved after archive and are never overwritten.
- **Stock operations:** Use Receive, Issue, Return or Transfer with quantity, location and reason. An issue can record department/recipient. Wait for confirmed success and check movement history before correcting an uncertain result. Corrections use linked reversals or admin adjustments, preserving originals. Offline posting is disabled.
- **Physical counts:** Admin creates a location draft and starts it to take the snapshot. Staff enter actual quantities and submit. If stock moved after the snapshot, admin refreshes the affected baseline, staff recount, then admin approves. Approval posts adjustment movements; a completed count cannot post again.
- **Deactivate:** Admin manages the member in Team & settings. Existing JWTs lose database access immediately through active-membership policies. Their Auth identity and historical movements remain. Cached previously viewed data cannot be retroactively erased; the app clears it on its next access check. A password reset does not reactivate membership.

## Error logging and monitoring

`application_errors` stores only a random reference, server-derived member ID, fixed error code, fixed area and timestamp. No message, stack, URL, email, notes, CSV data or credentials are captured. Active members can submit structured diagnostics through a guarded RPC; only active admins can read them. The database caps submissions at ten per member per minute. Browser logging is best-effort and cannot block a stock operation. Signed-out failures and lost-network errors may exist only in the local console. These client reports are diagnostics, not trusted audit evidence; use immutable movements for audit.

Check Supabase's Auth, PostgreSQL, Realtime and Edge Function logs through the owner dashboard. Invitation backend failures log only a fixed event/status. Configure owner notifications for service downtime, backup failures and repeated invitation 5xx responses through your organization's monitoring service; no external alert destination has been configured here. Never send bearer tokens or inventory payloads to a log collector. Review diagnostics daily during rollout, then weekly. Owners can retain 30 days with a scheduled trusted job:

```sql
delete from public.application_errors where created_at < now() - interval '30 days';
```

Run the read-only `scripts/operational-check.sql` after migrations, restoration and incidents. It checks item/balance consistency, cost coverage, count audit links, member identities, RLS and protected-table write permissions. Passing it does not replace live access tests.

## Backup policy

Assign an owner before storing office data. Suggested initial targets: daily encrypted database and image backups, 30-day retention, a separate offsite copy, recovery point within 24 hours and recovery within one business day. These are proposed targets, not measured guarantees. Select and confirm hosted backup/PITR retention appropriate to the office's needs. A source Git commit or CSV export is not a database backup.

Database backups cover database records; uploaded item-image bytes need separate backup. Preserve Auth identities with their UUIDs because memberships and movements reference them. Also preserve migration history, private Storage policies, Realtime publications, Edge Function source/secrets, Auth/SMTP/redirect configuration and the frontend commit/build settings. See [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups).

For an owner-managed logical export, install the supported Supabase CLI/Docker prerequisites, link and inspect the correct project, and run:

```sh
STOCKROOM_BACKUP_PROJECT_REF=YOUR_PROJECT_REF sh scripts/backup-project.sh /secure-backups/stockroom-YYYY-MM-DD
```

The helper checks the linked reference, refuses overwrites, uses permission-restricted output and leaves `INCOMPLETE` on failure. It exports roles, schema, COPY data, migration history and managed-schema customizations, plus checksums. It is prepared but has **not** been run against hosted Supabase. Review customizations before restoring; diff-engine behavior can vary with CLI version. Stop office writes and image uploads during a logical export to keep its separately exported files and image copy consistent. Confirm the dump includes Auth identities and application tables. Copy all private `item-images` objects through an owner-authorized Storage/S3 transfer into a manifest of path, size and checksum; verify object counts and bytes. This helper does not copy images, Auth settings, service secrets or encryption keys. Keep the resulting exports encrypted with an organization-managed key and outside Git. Verify checksums after offsite transfer, alert on failures and perform a quarterly restore drill.

## Restore a backup

A restore may discard newer transactions and may restore previously deactivated users or revoked invitations. Record the intended recovery point, obtain the office owner's incident decision, stop writes, and make a current recovery backup first. Prefer a separate recovery project; avoid overwriting production while investigating.

1. Verify the backup's checksums, project reference, creation time and absence of `INCOMPLETE`. Decrypt only on a trusted owner machine. Confirm the database, image bytes and service configuration belong to the same recovery point.
2. For a same-project managed backup/PITR restore, use the owner dashboard and its supported restore operation. For a new-project logical restore, follow the current [Supabase CLI restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), prepare its managed schemas/extensions, and review roles/schema/customizations. With `PGSERVICE=stockroom-recovery` pointing to the fresh recovery project, the reviewed core import is:

```sh
PGSERVICE=stockroom-recovery psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql
PGSERVICE=stockroom-recovery psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file history-schema.sql --file history-data.sql
```

Run from the decrypted backup directory. This is a privileged recovery session only: disabling triggers prevents ledger/count/import guards and stock-alert triggers from generating duplicate changes while restoring data. The connection closes afterward; do not disable triggers in normal office operation. Managed roles/schema ownership can require the documented owner adjustments. If Vault or column encryption is in use, follow the provider's key-restoration steps; keys cannot be recovered from ordinary SQL alone.
3. Reapply reviewed private Storage policy customizations and restore actual image bytes through supported Storage APIs. Confirm every item image path downloads under an active member and denies an uninvited user. Re-enable the expected Realtime publication tables. Do not blindly replay migration 001 on a restored schema; preserve history and apply only later unapplied versions.
4. Restore Auth/SMTP/redirect settings and Edge Function configuration/secrets. Verify member UUIDs still match Auth users. Reapply deactivations, role changes and invitation revocations recorded after the recovery point before allowing access. Revoke old sessions where appropriate; inspect pending invitations.
5. Run `scripts/operational-check.sql`, compare row counts/checksums, examine recent movement records, and verify location totals, archived history and completed-count adjustment links. Perform the live/manual release gates in the recovery environment. A local full-database restore test compares all app records and Auth/Storage metadata and checks restored RLS; it does not validate managed Supabase restoration or object bytes.
6. Rebuild the frontend for a new project URL/key and deploy its exact archive privately. Test callbacks and sign-in, then switch office traffic and restart writes only after reconciliation. Document lost transactions between the recovery point and incident and correct them through auditable movements. Record actual restore duration and recovered timestamp against the targets.

## Invitation-only versus office-network-only

Invitation-only means authenticated active office members with admin-assigned roles. It does **not** require being on office Wi-Fi or VPN. Current Sites owner-private hosting controls who can load the frontend; it is not a configured office-IP restriction. A valid Supabase member can use its HTTPS services from outside the office.

If office-network-only access is required, use a trusted network design covering the frontend **and** Auth, REST/RPC, Realtime WebSockets, Storage and the invitation endpoint. Options include self-hosting the frontend and Supabase behind a VPN/private reverse proxy, or routing through an access gateway with office/VPN IP restrictions while ensuring the original API origins cannot bypass it. Restricting only the frontend leaves direct API access possible. A managed Supabase direct-browser integration like this one needs an architectural change to enforce that full network boundary; it has not been implemented. Supabase's database IP restrictions cover PostgreSQL/pooler traffic, not its HTTPS APIs. See [the documented scope](https://supabase.com/docs/guides/platform/network-restrictions). Keep role checks and RLS even when traffic is inside the VPN.

Verify access from an office connection, approved VPN and unapproved cellular/home connection, including direct API and WebSocket attempts. Retest after VPN/IP changes and restoration. Do not describe the current deployment as office-network-only.

## Release verification record

Use [VERIFICATION.md](VERIFICATION.md) to record evidence, test date, operator, release SHA and environment. Office rollout remains blocked until hosted verification, browser usability/accessibility and a hosted restore drill pass. The release artifact is build-ready, not proof of operational readiness.
