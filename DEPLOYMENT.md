# Deploy Stockroom

The frontend is a Next.js static export in `out/`; authentication, PostgreSQL, Storage, Realtime, and the invitation backend run in Supabase. Use Node.js 22 (`nvm use`). The existing Sites project stays private. Do not enable public signup or public inventory hosting.

## Current release state

Source and local permission/concurrency/realtime tests are ready. Supabase production credentials, migrations, Auth/SMTP settings, and the first admin still need configuration. The existing hosted version is a clearly labeled demo. It is not a production office database.

`npm run release:check` fails immediately when production configuration is missing or uses a privileged browser key. `npm run release:demo` explicitly builds a demo artifact for review. Both run type checks, access/filter/realtime tests, the actual migrations against temporary PostgreSQL, a production-dependency audit, route existence checks, and the build. Local PostgreSQL binaries and `rg` are required for the database tests; no production database is accessed by this check.

## Production setup

1. Create or choose the dedicated Supabase office project. Apply migrations 001–005 in order with `supabase db push` after linking the correct project, or through the SQL Editor. For an existing database, apply only unapplied migrations; never reset it. Migration 003 rejects conflicting legacy identifiers rather than rewriting them automatically. It also creates the private image bucket.
2. Disable public and anonymous signup in hosted Auth settings. Enable email confirmation, configure a minimum 12-character password and production SMTP, and set the Auth Site URL to the final private app origin. Allow the exact `/auth/accept-invite/` and `/auth/reset-password/` redirect URLs at that origin.
3. Deploy `supabase/functions/invite-user` using the trusted owner's CLI. Set its `SITE_URL` secret to the final origin. Hosted Supabase supplies the service-role credential to the Edge Function; never place it in browser variables or frontend source.
4. Create and verify the intended first admin in the Auth dashboard. Run `scripts/bootstrap-admin.sql` through a trusted owner's database connection, supplying their verified Auth UUID and name. There is no public first-admin endpoint. See the README for the exact command.
5. Create `.env.local` from `.env.example` locally, or set these variables in the frontend build environment:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_LEGACY_ANON_KEY
```

These two values are intentionally browser-visible; database policies protect the data. Keep owner database credentials, SMTP secrets, and service-role keys outside the frontend build. Static exports bake in these public values: rebuild after changing them. Runtime hosting variables alone cannot change the exported app.
6. Run:

```sh
npm ci
npm run release:check
```

This produces `release/stockroom-production.tar.gz` containing `out/` and the existing hosting manifest. For Sites, use its source workflow to push the exact source, package the build, and deploy the resulting version with owner-private access. For another static host, serve the contents of `out/` with directory-index/trailing-slash routes and retain private access controls. This export does not use `next start` or require a Node server in production.
7. Provision two test members in a disposable Supabase project and run `npm run verify:live` using the private environment variables described in the README. That opt-in test creates auditable fixture data and requires `STOCKROOM_TEST_ALLOW_WRITES=disposable-project`. Validate the rendered app in two separate browser sessions, including Network Offline, reconnect, search/sort retention, and concurrent withdrawals. Live Auth/websocket/browser checks have not been performed on the current unconfigured project.
8. Grant the intended team access through the private hosting allowlist, then invite them through the app. Supabase membership and private hosting access are separate checks; both must be configured so users can reach invitation/reset callbacks.

## Release and rollback

Deploy a saved version built from the pushed source commit. Keep the current private audience. Confirm the deployment reports success and gives its URL. Verify sign-in, a receive/issue transaction, invitation delivery, password recovery, and a second session's confirmed live quantity before office use.

Keep the previous known-good saved frontend version for rollback. Database migrations are forward changes; reverting frontend code does not revert data or migrations. Older clients using the retired stock RPCs will be denied after migration 004, so do not roll back to those clients. Correct posted stock mistakes through linked reversals or admin adjustments rather than editing/deleting ledger rows.

Enable the project's database backup/recovery facilities through its owner account before storing operational office data. Retain the deployment archive and exact source commit used for each release.
